import { it, expect } from "vitest";
import { resolveFixture } from "./support/resolve.js";
import { validateGraph } from "../packages/contracts/src/model.js";
import { assembleGraph } from "../packages/core/src/assemble.js";
import { importPlace } from "../packages/core/src/import.js";
import { fixturePath } from "./support/fixtures.js";
it("assembles every saved object and occurrence into a valid evidence graph", async () => {
  const g = await resolveFixture("shop/place.rbxlx");
  expect(() => validateGraph(g)).not.toThrow();
  expect(g.nodes.some((n) => n.label === "ShopConfig.Prices.Sword")).toBe(true);
  expect(g.relations.some((r) => r.type === "SENDS_VIA")).toBe(true);
  expect(g.relations.some((r) => r.type === "HANDLES")).toBe(true);
  expect(g.coverage.parsedScripts).toBe(4);
});
it("keeps unresolved dynamic references addressable and counts their limitations", async () => {
  const g = await resolveFixture("adversarial/dynamic.rbxlx");
  expect(g.nodes.some((n) => n.kind === "unresolved")).toBe(true);
  expect(g.sites.some((s) => s.reason === "DYNAMIC_CONFIG_KEY")).toBe(true);
  expect(g.coverage.unresolvedSites).toBeGreaterThan(0);
  expect(() => validateGraph(g)).not.toThrow();
});

it("indexes only saved local object targets from typed Content properties", async () => {
  const snapshot = await importPlace(fixturePath("shop/place.rbxlx"));
  const owner = snapshot.instances[1];
  const target = snapshot.instances[2];
  Object.assign(owner.properties, {
    MeshContent: { type: "Content", value: { Object: target.id } },
    TextureContent: { type: "Content", value: { Uri: "rbxassetid://123456" } },
    MissingContent: { type: "Content", value: { Object: null } },
  });
  const graph = assembleGraph(snapshot, [], []);
  const edge = graph.relations.find(
    (r) => r.type === "REFERENCES" && r.source === owner.id && r.target === target.id,
  );
  expect(edge).toBeDefined();
  expect(graph.evidence.filter((e) => e.relationId === edge?.id)).toMatchObject([
    { propertyName: "MeshContent", rule: "serialized-content-reference", status: "saved" },
  ]);
  expect(graph.evidence.some((e) => e.propertyName === "TextureContent" || e.propertyName === "MissingContent")).toBe(false);
});
