import { it, expect } from "vitest";
import { shopCase } from "./support/cases.js";
import { resolveInstances } from "../packages/core/src/resolve-instances.js";
import { resolveCalls } from "../packages/core/src/resolve-calls.js";
import { resolveConfig } from "../packages/core/src/resolve-config.js";
const run = async (name?: string, text?: string, fixture?: string) => {
  const c = await shopCase(name, text, fixture);
  const i = resolveInstances(c.snapshot, c.facts);
  return {
    result: resolveConfig(
      c.snapshot,
      c.facts,
      i,
      resolveCalls(c.snapshot, c.facts, i),
    ),
    ...c,
  };
};
it("identifies the exact configuration leaf and initial value", async () => {
  const { result: r } = await run();
  const field = r.nodes.find((n) => n.label === "ShopConfig.Prices.Sword")!;
  expect(field.attributes.initializer).toBe(100);
  expect(
    r.relations.filter((r) => r.type === "READS" && r.target === field.id),
  ).toHaveLength(1);
  expect(
    r.relations.some(
      (e) =>
        r.nodes.find((n) => n.id === e.target)?.label ===
          "ShopConfig.Prices.Shield" && e.type === "READS",
    ),
  ).toBe(false);
});
it("retains a dynamic key as unresolved instead of choosing an item", async () => {
  const { result: r } = await run(
    undefined,
    undefined,
    "adversarial/dynamic.rbxlx",
  );
  expect(
    r.sites.some(
      (s) => s.reason === "DYNAMIC_CONFIG_KEY" && s.targetIds.length === 0,
    ),
  ).toBe(true);
});
it("links literal Attribute reads/writes and compound property access", async () => {
  const { result: r } = await run(
    "ShopServer",
    'local function update() local old=script:GetAttribute("Coins"); script:SetAttribute("Coins",old); script.Disabled = false end',
  );
  expect(
    r.relations
      .filter((r) => ["READS", "WRITES"].includes(r.type))
      .map((r) => r.type),
  ).toEqual(expect.arrayContaining(["READS", "WRITES"]));
  expect(r.nodes.some((n) => n.label.endsWith("Attribute.Coins"))).toBe(true);
});
it("retains field identity when a local configuration value is mutated", async () => {
  const { result: r } = await run(
    "ShopServer",
    "local C={Price=100}\nC.Price=200\nlocal result=C.Price",
  );
  const field = r.nodes.find((n) => n.label === "ShopServer.Price")!;
  expect(
    r.relations.filter((e) => e.target === field.id).map((e) => e.type),
  ).toEqual(expect.arrayContaining(["READS", "WRITES"]));
  expect(field.attributes.initializer).toBe(100);
});
