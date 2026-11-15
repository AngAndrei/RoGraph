import { expect, it } from "vitest";
import { arrangeInitialGraph } from "../apps/web/src/initial-layout.js";
import { layoutCost, measureLayout } from "../apps/web/src/layout-quality.js";
import { arrangeGraph } from "../apps/web/src/layout.js";

it("keeps a hub central and packs whole connected components with clear gutters", async () => {
  const leaves = Array.from({ length: 16 }, (_, i) => `leaf-${i}`);
  const nodes = ["hub", ...leaves, "a", "b", "isolated"];
  const edges = [
    ...leaves.map((target) => ({ source: "hub", target })),
    { source: "a", target: "b" },
  ];
  const r = await arrangeInitialGraph(nodes, edges, { aspectRatio: 1.8 });
  const p = new Map(r.positions.map((p) => [p.id, p]));
  const hub = p.get("hub")!;
  expect(Math.min(...leaves.map((id) => p.get(id)!.x))).toBeLessThan(hub.x);
  expect(Math.max(...leaves.map((id) => p.get(id)!.x))).toBeGreaterThan(hub.x);
  expect(Math.min(...leaves.map((id) => p.get(id)!.y))).toBeLessThan(hub.y);
  expect(Math.max(...leaves.map((id) => p.get(id)!.y))).toBeGreaterThan(hub.y);
  const box = (ids: string[]) => {
    const points = ids.map((id) => p.get(id)!);
    return {
      left: Math.min(...points.map((p) => p.x)),
      right: Math.max(...points.map((p) => p.x)),
      top: Math.min(...points.map((p) => p.y)),
      bottom: Math.max(...points.map((p) => p.y)),
    };
  };
  const boxes = [["hub", ...leaves], ["a", "b"], ["isolated"]].map(box);
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i],
        b = boxes[j];
      expect(
        a.right + 140 <= b.left ||
          b.right + 140 <= a.left ||
          a.bottom + 140 <= b.top ||
          b.bottom + 140 <= a.top,
      ).toBe(true);
    }
  expect(measureLayout(r.positions, edges).crossings).toBe(0);
  expect(measureLayout(r.positions, edges).obstructions).toBe(0);
});

it("preserves every node and edge and is deterministic across query ordering", async () => {
  const nodes = Array.from({ length: 20 }, (_, i) => `n${i}`);
  const edges = nodes.slice(0, 8).flatMap((source, i) => [
    { source, target: nodes[(i + 1) % 8] },
    { source, target: nodes[(i + 3) % 8] },
    { source, target: nodes[i + 8] },
  ]);
  const original = JSON.stringify({ nodes, edges });
  const a = await arrangeInitialGraph(nodes, edges);
  const b = await arrangeInitialGraph(nodes.toReversed(), edges.toReversed());
  expect(a.positions).toEqual(b.positions);
  expect(new Set(a.positions.map((p) => p.id))).toEqual(new Set(nodes));
  expect(
    a.positions.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)),
  ).toBe(true);
  expect(JSON.stringify({ nodes, edges })).toBe(original);
  expect(layoutCost(a.positions, edges)).toBeLessThanOrEqual(
    layoutCost(arrangeGraph(nodes, edges), edges),
  );
});

it("fits a long tree to the viewport direction and handles empty and isolated graphs", async () => {
  const nodes = Array.from({ length: 12 }, (_, i) => `n${i}`);
  const edges = nodes
    .slice(1)
    .map((target, i) => ({ source: nodes[i], target }));
  const wide = (await arrangeInitialGraph(nodes, edges, { aspectRatio: 2 }))
    .positions;
  const tall = (await arrangeInitialGraph(nodes, edges, { aspectRatio: 0.5 }))
    .positions;
  const width = (p: typeof wide) =>
    Math.max(...p.map((n) => n.x)) - Math.min(...p.map((n) => n.x));
  const height = (p: typeof wide) =>
    Math.max(...p.map((n) => n.y)) - Math.min(...p.map((n) => n.y));
  expect(width(wide)).toBeGreaterThan(height(wide) * 2);
  expect(height(tall)).toBeGreaterThan(width(tall) * 2);
  expect((await arrangeInitialGraph([], [])).positions).toEqual([]);
  const isolated = await arrangeInitialGraph(["a", "b", "b", "c"], []);
  expect(isolated.positions.length).toBe(3);
  expect(isolated.metrics.minimumSeparation).toBeGreaterThanOrEqual(140);
});

it("keeps a manually pinned node exactly in place", async () => {
  const result = await arrangeInitialGraph(
    ["a", "b", "c"],
    [{ source: "a", target: "b" }],
    {
      pins: [{ id: "a", x: 1234, y: -432 }],
      previous: [{ id: "a", x: 1234, y: -432 }],
    },
  );
  expect(result.positions.find((p) => p.id === "a")).toEqual({
    id: "a",
    x: 1234,
    y: -432,
  });
});
