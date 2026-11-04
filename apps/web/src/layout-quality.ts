import type { Link, Point } from "./layout.js";

export function uniqueLinks(ids: Set<string>, edges: Link[]): Link[] {
  const pairs = new Map<string, Link>();
  for (const e of edges) {
    if (e.source === e.target || !ids.has(e.source) || !ids.has(e.target))
      continue;
    const [source, target] = [e.source, e.target].sort();
    pairs.set(JSON.stringify([source, target]), { source, target });
  }
  return [...pairs.values()].sort((a, b) =>
    a.source < b.source
      ? -1
      : a.source > b.source
        ? 1
        : a.target < b.target
          ? -1
          : 1,
  );
}

export function edgeDistance(p: Point, a: Point, b: Point) {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const t = Math.max(
    0,
    Math.min(
      1,
      ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1),
    ),
  );
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}

export function measureLayout(points: Point[], edges: Link[], clearance = 22) {
  const byId = new Map(points.map((p) => [p.id, p]));
  const links = uniqueLinks(new Set(byId.keys()), edges);
  const turn = (a: Point, b: Point, c: Point) =>
    (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  let crossings = 0,
    obstructions = 0,
    minimumSeparation = Infinity;
  const lengths: number[] = [];
  for (let i = 0; i < points.length; i++)
    for (let j = i + 1; j < points.length; j++)
      minimumSeparation = Math.min(
        minimumSeparation,
        Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y),
      );
  for (let i = 0; i < links.length; i++) {
    const e = links[i],
      a = byId.get(e.source)!,
      b = byId.get(e.target)!;
    lengths.push(Math.hypot(a.x - b.x, a.y - b.y));
    for (const p of points)
      if (p !== a && p !== b && edgeDistance(p, a, b) < clearance)
        obstructions++;
    for (let j = i + 1; j < links.length; j++) {
      const f = links[j];
      if (
        e.source === f.source ||
        e.source === f.target ||
        e.target === f.source ||
        e.target === f.target
      )
        continue;
      const c = byId.get(f.source)!,
        d = byId.get(f.target)!;
      if (
        turn(a, b, c) * turn(a, b, d) < -0.01 &&
        turn(c, d, a) * turn(c, d, b) < -0.01
      )
        crossings++;
    }
  }
  lengths.sort((a, b) => a - b);
  return {
    crossings,
    obstructions,
    minimumSeparation: Number.isFinite(minimumSeparation)
      ? minimumSeparation
      : 0,
    edgeLengths: {
      median: lengths[Math.floor(lengths.length / 2)] ?? 0,
      p95:
        lengths[
          Math.min(lengths.length - 1, Math.floor(lengths.length * 0.95))
        ] ?? 0,
      max: lengths.at(-1) ?? 0,
    },
  };
}

// Compare topology readability first. Labels remain a rendered, secondary metric.
export function layoutCost(points: Point[], edges: Link[]) {
  const m = measureLayout(points, edges, 40);
  const severe = measureLayout(points, edges).obstructions;
  return (
    severe * 1000 +
    m.obstructions * 10 +
    m.crossings * 10 +
    Math.max(0, 65 - m.minimumSeparation) * 1000
  );
}
