import { it, expect } from "vitest";
import { shopCase } from "./support/cases.js";
import { extractFacts } from "../packages/core/src/facts.js";
import { hash } from "../packages/core/src/util.js";
import { resolveInstances } from "../packages/core/src/resolve-instances.js";
import { resolveCalls } from "../packages/core/src/resolve-calls.js";
import { resolveEvents } from "../packages/core/src/resolve-events.js";
const ref = 'local E=game:GetService("ReplicatedStorage").Shop.Purchase\n';
const cases = [
  ["RemoteEvent", "FireServer", "OnServerEvent", "client"],
  ["RemoteEvent", "FireClient", "OnClientEvent", "server"],
  ["RemoteEvent", "FireAllClients", "OnClientEvent", "server"],
  ["RemoteFunction", "InvokeServer", "OnServerInvoke", "client"],
  ["RemoteFunction", "InvokeClient", "OnClientInvoke", "server"],
  ["BindableEvent", "Fire", "Event", "server"],
  ["BindableFunction", "Invoke", "OnInvoke", "server"],
];
it.each(cases)(
  "joins %s %s to %s through the exact channel",
  async (cls, send, receive, side) => {
    const c = await shopCase();
    const channel = c.snapshot.instances.find(
      (i) => i.originalReferent === "remote_shop",
    )!;
    channel.className = cls;
    let sender = ref + `local function send() E:${send}("Sword") end`,
      handler =
        ref +
        (receive.startsWith("On") && cls.endsWith("Function")
          ? `E.${receive}=function(...) return true end`
          : `E.${receive}:Connect(function(...) end)`);
    for (const name of ["ShopClient", "ShopServer"]) {
      const source = c.snapshot.sources.find(
        (s) =>
          s.scriptId === c.snapshot.instances.find((i) => i.name === name)!.id,
      )!;
      source.text = cls.startsWith("Bindable")
        ? name === "ShopServer"
          ? sender + "\n" + handler
          : "local x=1"
        : name === (side === "client" ? "ShopClient" : "ShopServer")
          ? sender
          : handler;
      source.sha256 = hash(source.text);
    }
    const facts = await extractFacts(c.snapshot),
      i = resolveInstances(c.snapshot, facts),
      r = resolveEvents(
        c.snapshot,
        facts,
        i,
        resolveCalls(c.snapshot, facts, i),
      );
    expect(
      r.relations.filter(
        (e) =>
          e.target === channel.id && ["SENDS_VIA", "HANDLES"].includes(e.type),
      ),
    ).toHaveLength(2);
    expect(r.evidence.map((e) => e.mechanism)).toEqual(
      expect.arrayContaining([`${cls}.${send}`, `${cls}.${receive}`]),
    );
  },
);
it("does not join duplicate remotes by name", async () => {
  const c = await shopCase(
    undefined,
    undefined,
    "adversarial/duplicates.rbxlx",
  );
  const i = resolveInstances(c.snapshot, c.facts),
    r = resolveEvents(
      c.snapshot,
      c.facts,
      i,
      resolveCalls(c.snapshot, c.facts, i),
    );
  expect(r.relations).toHaveLength(0);
  expect(r.sites.some((s) => s.status === "candidate")).toBe(true);
});
it("records ordinary signal callbacks and flags wrong execution contexts", async () => {
  const c = await shopCase(
    "ShopServer",
    ref + 'E.Changed:Connect(function()end)\nE:FireServer("invalid")',
  );
  const i = resolveInstances(c.snapshot, c.facts),
    r = resolveEvents(
      c.snapshot,
      c.facts,
      i,
      resolveCalls(c.snapshot, c.facts, i),
    );
  expect(r.relations.some((e) => e.type === "CONNECTS_SIGNAL")).toBe(true);
  expect(
    r.relations.some(
      (e) =>
        e.type === "SENDS_VIA" &&
        e.source ===
          c.snapshot.instances.find((i) => i.name === "ShopServer")!.id,
    ),
  ).toBe(false);
  expect(
    r.diagnostics.some((d) => d.code === "EXECUTION_CONTEXT_MISMATCH"),
  ).toBe(true);
});
