import { it, expect } from "vitest";
import { importPlace } from "../packages/core/src/import.js";
import { extractFacts } from "../packages/core/src/facts.js";
import { resolveInstances } from "../packages/core/src/resolve-instances.js";
import { resolveCalls } from "../packages/core/src/resolve-calls.js";
import { resolveEvents } from "../packages/core/src/resolve-events.js";
import { fixturePath } from "./support/fixtures.js";
import { hash } from "../packages/core/src/util.js";
import type { Snapshot } from "../packages/contracts/src/model.js";
async function setup(
  texts: Record<string, string>,
  edit?: (s: Snapshot) => void,
) {
  const snapshot = await importPlace(fixturePath("shop/place.rbxlx"));
  for (const [name, text] of Object.entries(texts)) {
    const instance = snapshot.instances.find((i) => i.name === name)!;
    const source = snapshot.sources.find((s) => s.scriptId === instance.id)!;
    source.text = text;
    source.sha256 = hash(text);
  }
  edit?.(snapshot);
  const facts = await extractFacts(snapshot),
    instances = resolveInstances(snapshot, facts),
    calls = resolveCalls(snapshot, facts, instances);
  return { snapshot, facts, instances, calls };
}
it("does not select the last of alternative module returns", async () => {
  const c = await setup({
    PurchaseService:
      "if true then return {TryPurchase=function() end} end\nreturn {TryPurchase=function() end}",
  });
  const targets = c.calls.nodes
    .filter(
      (n) =>
        n.ownerId ===
        c.snapshot.instances.find((i) => i.name === "PurchaseService")!.id,
    )
    .map((n) => n.id);
  expect(
    c.calls.relations.filter(
      (r) => r.type === "CALLS" && targets.includes(r.target),
    ),
  ).toHaveLength(0);
  expect(
    c.calls.sites.some(
      (s) => s.status === "unresolved" && s.reason?.includes("RETURN"),
    ),
  ).toBe(true);
});
it.each([
  'local M={TryPurchase=function() end};local k="TryPurchase";M[k]=function()end;return M',
  "local M={TryPurchase=function() end};local A=M;local k=unknown();A[k]=function()end;return M",
])("invalidates overwritten module methods: %s", async (text) => {
  const c = await setup({ PurchaseService: text });
  const service = c.snapshot.instances.find(
    (i) => i.name === "PurchaseService",
  )!;
  const original = c.calls.nodes.find(
    (n) =>
      n.ownerId === service.id &&
      n.attributes.span &&
      n.label.includes("TryPurchase"),
  )!;
  expect(
    c.calls.relations.some(
      (r) => r.type === "CALLS" && r.target === original.id,
    ),
  ).toBe(false);
});
it("invalidates shared exports written from a consuming script", async () => {
  const c = await setup({
    ShopServer:
      "local M=require(script.Parent.PurchaseService);M.TryPurchase=function()end;M.TryPurchase()",
  });
  const original = c.calls.nodes.find(
    (n) => n.label === "PurchaseService.TryPurchase",
  )!;
  expect(
    c.calls.relations.some(
      (r) => r.type === "CALLS" && r.target === original.id,
    ),
  ).toBe(false);
});
it("reserves inherited API properties before implicit child lookup", async () => {
  const c = await setup(
    {
      ShopServer:
        'local RS=game:GetService("ReplicatedStorage");require(RS.Archivable);require(RS:FindFirstChild("Archivable"))',
    },
    (s) => {
      const module = s.instances.find((i) => i.name === "ShopConfig")!;
      module.name = "Archivable";
      const storage = s.instances.find((i) => i.name === "ReplicatedStorage")!;
      delete storage.properties.Archivable;
      module.parentId = storage.id;
    },
  );
  expect(
    c.instances.relations.filter((r) => r.type === "REQUIRES"),
  ).toHaveLength(1);
  const requires = c.instances.relations.filter((r) => r.type === "REQUIRES");
  expect(
    c.instances.evidence.filter((e) =>
      requires.some((r) => r.id === e.relationId),
    ),
  ).toHaveLength(1);
  expect(
    c.instances.sites.some(
      (s) => s.status === "unresolved" && s.reason?.includes("API"),
    ),
  ).toBe(true);
});
it("never attributes a dot-style remote send to the wrong self", async () => {
  const c = await setup(
    {
      ShopClient:
        'local RS=game:GetService("ReplicatedStorage");local first=RS.Shop.Purchase;local second=RS.Shop.Other;first.FireServer(second,"Sword")',
    },
    (s) => {
      const original = s.instances.find((i) => i.name === "Purchase")!;
      s.instances.push({
        ...structuredClone(original),
        id: original.id + ":other",
        name: "Other",
        siblingOrdinal: 90,
      });
    },
  );
  const events = resolveEvents(c.snapshot, c.facts, c.instances, c.calls),
    first = c.snapshot.instances.find((i) => i.name === "Purchase")!;
  expect(
    events.relations.some(
      (r) => r.type === "SENDS_VIA" && r.target === first.id,
    ),
  ).toBe(false);
  expect(
    events.sites.some(
      (s) => s.status === "unresolved" && s.reason?.includes("DOT"),
    ),
  ).toBe(true);
});
it.each([
  "local x=1,require(script.Parent.PurchaseService)",
  "local y={[require(script.Parent.PurchaseService)]=true}",
  "local x;x=1,require(script.Parent.PurchaseService)",
])("keeps every evaluated expression: %s", async (text) => {
  const c = await setup({ ShopServer: text });
  const server = c.snapshot.instances.find((i) => i.name === "ShopServer")!;
  expect(
    c.instances.relations.filter(
      (r) => r.type === "REQUIRES" && r.source === server.id,
    ),
  ).toHaveLength(1);
});
it("records function-declaration callback registration", async () => {
  const c = await setup(
    {
      ShopServer:
        'local E=game:GetService("ReplicatedStorage").Shop.Purchase;function E.OnServerInvoke(player) return true end',
    },
    (s) => {
      s.instances.find((i) => i.name === "Purchase")!.className =
        "RemoteFunction";
    },
  );
  const events = resolveEvents(c.snapshot, c.facts, c.instances, c.calls);
  expect(events.relations.filter((r) => r.type === "HANDLES")).toHaveLength(1);
});
