import { expect, it } from "vitest";
import { optimizeGraph } from "../apps/web/src/network-layout.js";
import { arrangeGraph } from "../apps/web/src/layout.js";
import { layoutCost } from "../apps/web/src/layout-quality.js";

it("retains the topology baseline when a stronger candidate cannot improve structural quality", async () => {
  const nodes = Array.from({ length: 18 }, (_, i) => `n${i}`);
  const edges = nodes.slice(1).map((target) => ({ source: nodes[0], target }));
  const result = await optimizeGraph(nodes, edges);
  expect(result.positions).toEqual(
    arrangeGraph(nodes, edges, { polish: true }),
  );
  expect(result.metrics.crossings).toBe(0);
});

it("returns deterministic complete geometry no worse than the existing cyclic placement", async () => {
  const nodes = Array.from({ length: 26 }, (_, i) => `n${i}`);
  const edges = nodes.flatMap((source, i) =>
    [1, 4, 7].map((step) => ({
      source,
      target: nodes[(i + step) % nodes.length],
    })),
  );
  const a = await optimizeGraph(nodes, edges),
    b = await optimizeGraph(nodes.toReversed(), edges.toReversed());
  expect(a.positions).toEqual(b.positions);
  expect(new Set(a.positions.map((p) => p.id))).toEqual(new Set(nodes));
  expect(
    a.positions.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)),
  ).toBe(true);
  expect(layoutCost(a.positions, edges)).toBeLessThanOrEqual(
    layoutCost(arrangeGraph(nodes, edges), edges),
  );
});

it("lays a focused directed chain in reading order without altering input edges", async () => {
  const nodes = ["a", "b", "c"],
    edges = [
      { source: "a", target: "b" },
      { source: "b", target: "c" },
    ];
  const before = JSON.stringify(edges);
  const r = await optimizeGraph(nodes, edges, { intent: "directional" });
  const p = new Map(r.positions.map((p) => [p.id, p]));
  expect(p.get("a")!.x).toBeLessThan(p.get("b")!.x);
  expect(p.get("b")!.x).toBeLessThan(p.get("c")!.x);
  expect(JSON.stringify(edges)).toBe(before);
});
