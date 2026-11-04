import { expect, it } from "vitest";
import { stabilizeLayout } from "../apps/web/src/layout-stability.js";
it("aligns a changed graph to its previous orientation and location without changing distances", () => {
  const previous = [
    { id: "a", x: 100, y: 200 },
    { id: "b", x: 200, y: 200 },
    { id: "c", x: 100, y: 300 },
  ];
  const next = [
    { id: "a", x: 0, y: 0 },
    { id: "b", x: 0, y: 100 },
    { id: "c", x: -100, y: 0 },
    { id: "new", x: 0, y: 200 },
  ];
  const result = stabilizeLayout(next, previous, []),
    p = new Map(result.map((p) => [p.id, p]));
  for (const old of previous) {
    expect(p.get(old.id)!.x).toBeCloseTo(old.x);
    expect(p.get(old.id)!.y).toBeCloseTo(old.y);
  }
  expect(result).toHaveLength(4);
  expect(next[0].x).toBe(0);
});
it("keeps manually pinned positions exact and separates movable nodes from them", () => {
  const points = [
    { id: "a", x: 0, y: 0 },
    { id: "b", x: 100, y: 0 },
    { id: "c", x: 200, y: 0 },
  ];
  const result = stabilizeLayout(points, points, [{ id: "b", x: 0, y: 0 }]),
    p = new Map(result.map((p) => [p.id, p]));
  expect(p.get("b")).toEqual({ id: "b", x: 0, y: 0 });
  expect(Math.hypot(p.get("a")!.x, p.get("a")!.y)).toBeGreaterThanOrEqual(71.9);
});
