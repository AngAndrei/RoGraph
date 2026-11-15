import { arrangeGraph, type Link, type Point } from "./layout.js";
import { layoutCost, measureLayout, uniqueLinks } from "./layout-quality.js";
import { stabilizeLayout } from "./layout-stability.js";
import { validPositions } from "./layout-protocol.js";
import type { ELK } from "elkjs/lib/elk-api.js";

type Options = { aspectRatio?: number; previous?: Point[]; pins?: Point[] };
type Adjacency = Map<string, Set<string>>;

/** First overview: connected structures own their geometry, independently of service labels. */
export async function arrangeInitialGraph(
  nodes: string[],
  edges: Link[],
  options: Options = {},
) {
  const ids = [...new Set(nodes)].sort();
  const links = uniqueLinks(new Set(ids), edges);
  const adjacency: Adjacency = new Map(
    ids.map((id) => [id, new Set<string>()]),
  );
  for (const e of links) {
    adjacency.get(e.source)!.add(e.target);
    adjacency.get(e.target)!.add(e.source);
  }
  const aspectRatio = Number.isFinite(options.aspectRatio)
    ? Math.max(0.3, Math.min(4, options.aspectRatio!))
    : 1.8;
  const seen = new Set<string>(),
    layouts: Point[][] = [],
    warnings: string[] = [];
  let engine = "component-topology";
  let elk: ELK | undefined;
  for (const id of ids) {
    if (seen.has(id)) continue;
    const component = [id];
    seen.add(id);
    for (let i = 0; i < component.length; i++)
      for (const next of adjacency.get(component[i])!)
        if (!seen.has(next)) {
          seen.add(next);
          component.push(next);
        }
    component.sort();
    const allowed = new Set(component),
      local = links.filter((e) => allowed.has(e.source));
    // Extra refinement is a candidate, never an unconditional replacement:
    // moving one vertex can improve its neighborhood but worsen the whole graph.
    let points = arrangeGraph(component, local);
    const core = cyclicCore(component, adjacency);
    // Trees and rings already have an exact radial embedding. Bound the extra
    // solver to small tangled cores; large networks retain the topology fallback.
    if (
      core.length > 2 &&
      core.length <= 80 &&
      local.length <= 220 &&
      core.some(
        (n) =>
          [...adjacency.get(n)!].filter((v) => core.includes(v)).length > 2,
      ) &&
      layoutCost(points, local) > 0
    ) {
      try {
        if (!elk) {
          const { default: ELK } = await import("elkjs/lib/elk.bundled.js");
          elk = new ELK();
        }
        const members = new Set(core);
        const graph = await elk.layout({
          id: "core",
          layoutOptions: {
            "elk.algorithm": "stress",
            "elk.randomSeed": "1",
            "elk.stress.iterationLimit": "160",
            "elk.stress.desiredEdgeLength": "220",
          },
          children: core.map((id) => ({ id, width: 72, height: 72 })),
          edges: local
            .filter((e) => members.has(e.source) && members.has(e.target))
            .map((e, i) => ({
              id: `e${i}`,
              sources: [e.source],
              targets: [e.target],
            })),
        });
        const geometry = graph.children?.map((n) => ({
          id: n.id,
          x: n.x! + 36,
          y: -(n.y! + 36),
        }));
        if (!validPositions(geometry, core))
          throw new Error("Invalid core placement");
        const byId = new Map(geometry.map((p) => [p.id, p]));
        const candidate = arrangeGraph(component, local, {
          polish: true,
          coreLayout: (coreIds) => coreIds.map((id) => ({ ...byId.get(id)! })),
        });
        if (layoutCost(candidate, local) < layoutCost(points, local)) {
          points = candidate;
          engine = "component-stress";
        }
      } catch {
        warnings.push(
          "Alternative core layout unavailable; retained connected topology layout.",
        );
      }
    }
    layouts.push(orient(points, aspectRatio));
  }
  let positions = packComponents(layouts, aspectRatio);
  if (options.previous?.length || options.pins?.length)
    positions = stabilizeLayout(
      positions,
      options.previous ?? [],
      options.pins ?? [],
      true,
    );
  return {
    positions,
    engine,
    metrics: measureLayout(positions, links),
    warnings: [...new Set(warnings)],
  };
}

function cyclicCore(ids: string[], adjacency: Adjacency) {
  const degree = new Map(ids.map((id) => [id, adjacency.get(id)!.size]));
  const queue = ids.filter((id) => degree.get(id)! < 2),
    peeled = new Set<string>();
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i];
    peeled.add(id);
    for (const n of adjacency.get(id)!)
      if (!peeled.has(n)) {
        const d = degree.get(n)! - 1;
        degree.set(n, d);
        if (d === 1) queue.push(n);
      }
  }
  return ids.filter((id) => !peeled.has(id));
}

function orient(points: Point[], aspectRatio: number): Point[] {
  const mx = points.reduce((s, p) => s + p.x, 0) / points.length,
    my = points.reduce((s, p) => s + p.y, 0) / points.length;
  const xx = points.reduce((s, p) => s + (p.x - mx) ** 2, 0),
    yy = points.reduce((s, p) => s + (p.y - my) ** 2, 0),
    xy = points.reduce((s, p) => s + (p.x - mx) * (p.y - my), 0);
  const angle =
    Math.abs(xx - yy) + Math.abs(xy) < 0.001
      ? 0
      : 0.5 * Math.atan2(2 * xy, xx - yy) + (aspectRatio < 1 ? Math.PI / 2 : 0);
  const c = Math.cos(angle),
    s = Math.sin(angle);
  // Reserve horizontal breathing room for the renderer's right-hand labels.
  // A rotation and expansion preserve crossings and cannot reduce clearance.
  return points.map((p) => ({
    id: p.id,
    x: ((p.x - mx) * c + (p.y - my) * s) * 1.4,
    y: -(p.x - mx) * s + (p.y - my) * c,
  }));
}

function packComponents(layouts: Point[][], aspectRatio: number): Point[] {
  if (!layouts.length) return [];
  const boxes = layouts
    .map((points) => {
      const x = Math.min(...points.map((p) => p.x)),
        y = Math.min(...points.map((p) => p.y));
      return {
        points: points.map((p) => ({ id: p.id, x: p.x - x, y: p.y - y })),
        width: Math.max(...points.map((p) => p.x)) - x + 190,
        height: Math.max(...points.map((p) => p.y)) - y + 150,
      };
    })
    .sort(
      (a, b) =>
        b.height - a.height ||
        b.width - a.width ||
        a.points[0].id.localeCompare(b.points[0].id),
    );
  let best: Point[] = [],
    bestExtent = Infinity;
  const area = boxes.reduce((sum, b) => sum + b.width * b.height, 0);
  // Compare several deterministic shelf widths in screen units, rather than
  // dedicating entire side columns to tiny disconnected structures.
  for (const factor of [0.5, 0.7, 0.85, 1, 1.2, 1.5, 1.8, 2.2]) {
    const target = Math.sqrt(area * aspectRatio) * factor;
    let x = 0,
      y = 0,
      rowHeight = 0,
      width = 0;
    const result: Point[] = [];
    for (const box of boxes) {
      if (x && x + box.width > target) {
        x = 0;
        y += rowHeight;
        rowHeight = 0;
      }
      result.push(
        ...box.points.map((p) => ({ id: p.id, x: p.x + x, y: -(p.y + y) })),
      );
      x += box.width;
      rowHeight = Math.max(rowHeight, box.height);
      width = Math.max(width, x);
    }
    const extent = Math.max(width / aspectRatio, y + rowHeight);
    if (extent < bestExtent) {
      bestExtent = extent;
      best = result;
    }
  }
  return best;
}
