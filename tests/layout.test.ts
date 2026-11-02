import { it, expect } from "vitest";
import { arrangeGraph } from "../apps/web/src/layout.js";
it("separates connected components with space and no overlapping nodes", () => {
  const nodes = Array.from({ length: 36 }, (_, i) => "n" + i),
    edges = nodes
      .slice(1, 18)
      .map((id) => ({ source: "n0", target: id }))
      .concat(nodes.slice(19).map((id) => ({ source: "n18", target: id })));
  const points = arrangeGraph(nodes, edges),
    byId = new Map(points.map((p) => [p.id, p]));
  for (let i = 0; i < points.length; i++)
    for (let j = i + 1; j < points.length; j++)
      expect(
        Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y),
      ).toBeGreaterThanOrEqual(47);
  const left = points.filter((p) => Number(p.id.slice(1)) < 18),
    right = points.filter((p) => Number(p.id.slice(1)) >= 18);
  expect(
    Math.max(...left.map((p) => p.x)) + 48 <=
      Math.min(...right.map((p) => p.x)) ||
      Math.max(...left.map((p) => p.y)) + 48 <=
        Math.min(...right.map((p) => p.y)),
  ).toBe(true);
  expect(arrangeGraph(nodes, edges)).toEqual(points);
  expect(byId.size).toBe(36);
});
it("handles isolated nodes and empty inputs with finite, distinct positions", () => {
  expect(arrangeGraph([], [])).toEqual([]);
  const p = arrangeGraph(["a", "b", "c"], []);
  expect(p.every((n) => Number.isFinite(n.x) && Number.isFinite(n.y))).toBe(
    true,
  );
  expect(new Set(p.map((n) => n.x + "," + n.y)).size).toBe(3);
});
