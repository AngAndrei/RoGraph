import { it, expect } from "vitest";
import { importPlace } from "../packages/core/src/import.js";
import { extractFacts } from "../packages/core/src/facts.js";
import { resolveInstances } from "../packages/core/src/resolve-instances.js";
import { resolveCalls } from "../packages/core/src/resolve-calls.js";
import { resolveConfig } from "../packages/core/src/resolve-config.js";
import { hash } from "../packages/core/src/util.js";
import { fixturePath } from "./support/fixtures.js";
it("preserves mixed table array indices and distinguishes numeric from string keys", async () => {
  const s = await importPlace(fixturePath("shop/place.rbxlx"));
  for (const source of s.sources) {
    const name = s.instances.find((i) => i.id === source.scriptId)!.name;
    if (name === "ShopConfig")
      source.text =
        'return {Items={Title="x",10,20},Codes={["1"]="string",[1]="number"}}';
    if (name === "PurchaseService")
      source.text =
        'local C=require(game:GetService("ReplicatedStorage").Shop.ShopConfig)\nlocal M={}\nfunction M.TryPurchase() return C.Codes[1],C.Codes["1"],C.Items[2] end\nreturn M';
    source.sha256 = hash(source.text);
  }
  const f = await extractFacts(s),
    i = resolveInstances(s, f),
    r = resolveConfig(s, f, i, resolveCalls(s, f, i));
  const number = r.nodes.find((n) => n.label === "ShopConfig.Codes[1]"),
    string = r.nodes.find((n) => n.label === 'ShopConfig.Codes["1"]');
  expect(number?.attributes.initializer).toBe("number");
  expect(string?.attributes.initializer).toBe("string");
  expect(number?.id).not.toBe(string?.id);
  expect(
    r.nodes.find((n) => n.label === "ShopConfig.Items[2]")?.attributes
      .initializer,
  ).toBe(20);
  for (const node of [number, string])
    expect(
      r.relations.some(
        (rel) => rel.type === "READS" && rel.target === node?.id,
      ),
    ).toBe(true);
});
