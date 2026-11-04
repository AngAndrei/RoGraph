import { it, expect } from "vitest";
import { arrangeGraph } from "../apps/web/src/layout.js";

// A cycle between two hubs and two bridges, matching the user's NPC example.
const npcEdges = [
  ["Animate", "Humanoid"],
  ["Humanoid", "NPCBehavior"],
  ["NPCBehavior", "Modon"],
  ["Modon", "Animate"],
  ...["Hip", "Shoulder", "PlayEmote", "Animation"].map((id) => ["Animate", id]),
  ...Array.from({ length: 7 }, (_, i) => ["NPCBehavior", "npc" + i]),
  ["Modon", "Health"],
].map(([source, target]) => ({ source, target }));
type P = { x: number; y: number };
const turn = (a: P, b: P, c: P) =>
  (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
function crossings(
  points: ReturnType<typeof arrangeGraph>,
  edges: typeof npcEdges,
) {
  const p = new Map(points.map((n) => [n.id, n]));
  let count = 0;
  edges.forEach((e, i) =>
    edges.slice(i + 1).forEach((f) => {
      if ([e.source, e.target].some((id) => id === f.source || id === f.target))
        return;
      const a = p.get(e.source)!,
        b = p.get(e.target)!,
        c = p.get(f.source)!,
        d = p.get(f.target)!;
      if (
        turn(a, b, c) * turn(a, b, d) < 0 &&
        turn(c, d, a) * turn(c, d, b) < 0
      )
        count++;
    }),
  );
  return count;
}
function clearance(p: P, a: P, b: P) {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const t = Math.max(
    0,
    Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)),
  );
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}
it("places NPC leaves outside the hub/bridge core without crossings or node obstructions", () => {
  const nodes = [...new Set(npcEdges.flatMap((e) => [e.source, e.target]))];
  const points = arrangeGraph(nodes, npcEdges),
    p = new Map(points.map((n) => [n.id, n]));
  expect(crossings(points, npcEdges)).toBe(0);
  const core = ["Animate", "Humanoid", "NPCBehavior", "Modon"].map(
    (id) => p.get(id)!,
  );
  const center = {
    x: core.reduce((s, n) => s + n.x, 0) / 4,
    y: core.reduce((s, n) => s + n.y, 0) / 4,
  };
  for (const e of npcEdges) {
    const a = p.get(e.source)!,
      b = p.get(e.target)!;
    for (const n of points.filter(
      (n) => n.id !== e.source && n.id !== e.target,
    ))
      expect(
        clearance(n, a, b),
        `${n.id} obstructs ${e.source} -> ${e.target}`,
      ).toBeGreaterThan(22);
    if (
      npcEdges.filter((f) => f.source === e.target || f.target === e.target)
        .length === 1
    )
      expect(Math.hypot(b.x - center.x, b.y - center.y)).toBeGreaterThan(
        Math.hypot(a.x - center.x, a.y - center.y),
      );
  }
});

it("keeps branching trees crossing-free and ignores duplicate, reversed and invalid links for layout", () => {
  const edges = Array.from({ length: 4 }, (_, i) => [
    { source: "root", target: "hub" + i },
    ...Array.from({ length: 5 }, (_, j) => ({
      source: "hub" + i,
      target: `leaf${i}-${j}`,
    })),
  ]).flat();
  const nodes = [...new Set(edges.flatMap((e) => [e.source, e.target]))];
  const p = arrangeGraph(nodes, edges);
  expect(crossings(p, edges)).toBe(0);
  expect(
    arrangeGraph(nodes, [
      ...edges,
      ...edges.map((e) => ({ source: e.target, target: e.source })),
      { source: "root", target: "root" },
      { source: "missing", target: "root" },
    ]),
  ).toEqual(p);
});
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

it("untangles a planar core that needs an interior vertex rather than a ring", () => {
  const nodes = ["a", "b", "c", "d"];
  const edges = nodes.flatMap((source, i) =>
    nodes.slice(i + 1).map((target) => ({ source, target })),
  );
  const points = arrangeGraph(nodes, edges);
  expect(crossings(points, edges)).toBe(0);
  for (const e of edges)
    for (const p of points.filter(
      (p) => p.id !== e.source && p.id !== e.target,
    ))
      expect(
        clearance(
          p,
          points.find((p) => p.id === e.source)!,
          points.find((p) => p.id === e.target)!,
        ),
      ).toBeGreaterThan(22);
});

it("keeps neighboring hub fans apart around a cycle", () => {
  const edges = Array.from({ length: 10 }, (_, i) => [
    { source: `hub${i}`, target: `hub${(i + 1) % 10}` },
    ...Array.from({ length: 5 }, (_, j) => ({
      source: `hub${i}`,
      target: `leaf${i}-${j}`,
    })),
  ]).flat();
  const nodes = [...new Set(edges.flatMap((e) => [e.source, e.target]))];
  const points = arrangeGraph(nodes, edges),
    p = new Map(points.map((n) => [n.id, n]));
  expect(crossings(points, edges)).toBe(0);
  for (const e of edges)
    for (const n of points.filter(
      (n) => n.id !== e.source && n.id !== e.target,
    ))
      expect(clearance(n, p.get(e.source)!, p.get(e.target)!)).toBeGreaterThan(
        22,
      );
});

it("preserves narrow outward cones above the untangling size cutoff", () => {
  const edges = Array.from({ length: 50 }, (_, i) => [
    { source: `hub${i}`, target: `hub${(i + 1) % 50}` },
    ...Array.from({ length: 5 }, (_, j) => ({
      source: `hub${i}`,
      target: `leaf${i}-${j}`,
    })),
  ]).flat();
  const nodes = [...new Set(edges.flatMap((e) => [e.source, e.target]))];
  const points = arrangeGraph(nodes, edges);
  expect(crossings(points, edges)).toBe(0);
});

it("keeps leaves near an almost straight core instead of creating an empty chasm", () => {
  const edges = Array.from({ length: 9 }, (_, i) => [
    { source: "a", target: `b${i}` },
    { source: "z", target: `b${i}` },
  ]).flat();
  for (let i = 0; i < 3; i++) edges.push({ source: "b1", target: `leaf${i}` });
  const nodes = [...new Set(edges.flatMap((e) => [e.source, e.target]))],
    points = arrangeGraph(nodes, edges),
    p = new Map(points.map((n) => [n.id, n]));
  for (const e of edges.filter((e) => e.target.startsWith("leaf")))
    expect(
      Math.hypot(
        p.get(e.source)!.x - p.get(e.target)!.x,
        p.get(e.source)!.y - p.get(e.target)!.y,
      ),
    ).toBeLessThan(500);
});

it("keeps a bare cycle compact without reserving space for nonexistent branches", () => {
  const nodes = Array.from({ length: 50 }, (_, i) => `n${i}`),
    edges = nodes.map((id, i) => ({ source: id, target: nodes[(i + 1) % 50] }));
  const p = new Map(arrangeGraph(nodes, edges).map((n) => [n.id, n]));
  for (const e of edges)
    expect(
      Math.hypot(
        p.get(e.source)!.x - p.get(e.target)!.x,
        p.get(e.source)!.y - p.get(e.target)!.y,
      ),
    ).toBeLessThan(120);
});

it("adds local branch room without inflating a sparsely occupied cycle", () => {
  const nodes = Array.from({ length: 50 }, (_, i) => `n${i}`),
    edges = nodes.map((id, i) => ({ source: id, target: nodes[(i + 1) % 50] }));
  for (const count of [1, 2]) {
    const extra = Array.from({ length: count }, (_, i) => ({
      source: nodes[i],
      target: `leaf${i}`,
    }));
    const p = arrangeGraph(
      [...nodes, ...extra.map((e) => e.target)],
      [...edges, ...extra],
    );
    expect(
      Math.max(...p.map((n) => n.x)) - Math.min(...p.map((n) => n.x)),
    ).toBeLessThan(2100);
    expect(
      Math.max(...p.map((n) => n.y)) - Math.min(...p.map((n) => n.y)),
    ).toBeLessThan(2100);
  }
});
