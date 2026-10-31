import { it, expect } from "vitest";
import { extractFacts, lowerAst } from "../packages/core/src/facts.js";
import { importPlace } from "../packages/core/src/import.js";
import { parseSource } from "../packages/adapters/src/native.js";
import { fixturePath } from "./support/fixtures.js";
it("extracts scoped functions and exact call sites from real Luau ASTs", async () => {
  const snapshot = await importPlace(fixturePath("shop/place.rbxlx"));
  const facts = await extractFacts(snapshot);
  expect(facts.flatMap((f) => f.symbols.map((s) => s.name))).toEqual(
    expect.arrayContaining(["BuySword", "onPurchase", "TryPurchase"]),
  );
  const f = facts.find((f) => f.symbols.some((s) => s.name === "onPurchase"))!;
  const fn = f.symbols.find((s) => s.name === "onPurchase")!;
  expect(f.sites.some((s) => s.ownerId === fn.id && s.kind === "call")).toBe(
    true,
  );
});
it("distinguishes lexical shadows by declaration identity", async () => {
  const p = await parseSource({
    id: "s",
    scriptId: "i",
    text: "local x = 1\ndo local x = 2; print(x) end\nprint(x)",
    sha256: "hash",
    origin: { kind: "place" },
  });
  const f = lowerAst(p);
  const ids = f.bindings.filter((b) => b.name === "x").map((b) => b.id);
  expect(new Set(ids).size).toBe(2);
});
it("retains calls inside unsupported computed expressions", async () => {
  const p = await parseSource({
    id: "s",
    scriptId: "i",
    text: "local x = helper() + 1",
    sha256: "hash",
    origin: { kind: "place" },
  });
  expect(lowerAst(p).sites.filter((s) => s.kind === "call")).toHaveLength(1);
});
