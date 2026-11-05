import Graph from "graphology";
import forceAtlas2 from "graphology-layout-forceatlas2";

export type Point = { id: string; x: number; y: number };
export type Link = { source: string; target: string; order?: string };
export type LayoutOptions = {
  aspectRatio?: number;
  polish?: boolean;
  order?: "degree" | "natural" | "evidence";
  coreLayout?: (
    ids: string[],
    links: Link[],
    weights: Map<string, number>,
    initial: Point[],
  ) => Point[];
};
type Adjacency = Map<string, Set<string>>;
const GAP = 72;
const TAU = Math.PI * 2;

function distanceToEdge(p: Point, a: Point, b: Point) {
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
function nearEdge(p: Point, a: Point, b: Point, clearance: number) {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const t = Math.max(
    0,
    Math.min(
      1,
      ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1),
    ),
  );
  const x = p.x - a.x - t * dx,
    y = p.y - a.y - t * dy;
  return x * x + y * y < clearance * clearance;
}
function crosses(a: Point, b: Point, c: Point, d: Point) {
  const side = (p: Point, q: Point, r: Point) =>
    (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  return (
    side(a, b, c) * side(a, b, d) < -0.01 &&
    side(c, d, a) * side(c, d, b) < -0.01
  );
}

// Run after topology placement as a safety net for dense cyclic cores.
function separate(points: Point[]) {
  for (let pass = 0; pass < 120; pass++) {
    let moved = false;
    for (let i = 0; i < points.length; i++)
      for (let j = i + 1; j < points.length; j++) {
        const a = points[i],
          b = points[j];
        let dx = b.x - a.x,
          dy = b.y - a.y,
          d = Math.hypot(dx, dy);
        if (d >= GAP) continue;
        if (d < 0.001) {
          dx = 1;
          dy = 0.5;
          d = Math.hypot(dx, dy);
        }
        const shift = (GAP - d) / 2 + 0.01;
        a.x -= (dx / d) * shift;
        a.y -= (dy / d) * shift;
        b.x += (dx / d) * shift;
        b.y += (dy / d) * shift;
        moved = true;
      }
    if (!moved) break;
  }
  removeNodeOverlaps(points);
}

/** Deterministic spatial packing finishes cases where pairwise relaxation stalls. */
export function removeNodeOverlaps(points: Point[]) {
  const cells = new Map<string, Point[]>();
  const key = (x: number, y: number) => `${x},${y}`;
  const free = (x: number, y: number) => {
    const cx = Math.floor(x / GAP),
      cy = Math.floor(y / GAP);
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (const p of cells.get(key(cx + dx, cy + dy)) ?? [])
          if ((p.x - x) ** 2 + (p.y - y) ** 2 < (GAP - 0.001) ** 2)
            return false;
    return true;
  };
  for (const p of points) {
    const origin = { x: p.x, y: p.y };
    if (!free(p.x, p.y))
      search: for (let ring = 1; ; ring++) {
        for (let dx = -ring; dx <= ring; dx++)
          for (const dy of [-ring, ring])
            if (free(origin.x + dx * GAP, origin.y + dy * GAP)) {
              p.x = origin.x + dx * GAP;
              p.y = origin.y + dy * GAP;
              break search;
            }
        for (let dy = -ring + 1; dy < ring; dy++)
          for (const dx of [-ring, ring])
            if (free(origin.x + dx * GAP, origin.y + dy * GAP)) {
              p.x = origin.x + dx * GAP;
              p.y = origin.y + dy * GAP;
              break search;
            }
      }
    const cell = key(Math.floor(p.x / GAP), Math.floor(p.y / GAP));
    const bucket = cells.get(cell) ?? [];
    bucket.push(p);
    cells.set(cell, bucket);
  }
}

// Coordinate descent can move a vertex inside a cycle (swaps alone cannot).
// Score only geometry affected by that vertex; keep the worker's cost bounded.
function untangle(points: Point[], links: Link[], extended = false) {
  if (
    points.length > (extended ? 350 : 150) ||
    links.length > (extended ? 500 : 220)
  )
    return;
  const byId = new Map(points.map((p) => [p.id, p]));
  const edgeClearance = extended ? 40 : 28;
  const segments = links.map((e) => ({
    a: byId.get(e.source)!,
    b: byId.get(e.target)!,
  }));
  const outward = new Map<Point, { parent: Point; dx: number; dy: number }>();
  for (const p of points) {
    const incident = segments.filter((e) => e.a === p || e.b === p);
    if (incident.length !== 1) continue;
    const parent = incident[0].a === p ? incident[0].b : incident[0].a;
    const d = Math.hypot(p.x - parent.x, p.y - parent.y) || 1;
    outward.set(p, {
      parent,
      dx: (p.x - parent.x) / d,
      dy: (p.y - parent.y) / d,
    });
  }
  const passes = extended
    ? Math.max(
        1,
        Math.min(
          8,
          Math.floor(300000 / Math.max(1, points.length * links.length)),
        ),
      )
    : 4;
  for (let pass = 0; pass < passes; pass++) {
    let improved = false;
    for (const p of points) {
      const incident = segments.filter((e) => e.a === p || e.b === p),
        other = segments.filter((e) => e.a !== p && e.b !== p);
      const score = () => {
        let cost = 0;
        const direction = outward.get(p);
        if (
          direction &&
          (p.x - direction.parent.x) * direction.dx +
            (p.y - direction.parent.y) * direction.dy <
            GAP
        )
          cost += 10000;
        for (const n of points)
          if (n !== p) {
            const d = Math.hypot(p.x - n.x, p.y - n.y);
            if (d < GAP - 0.1) cost += 1000 + (GAP - d) * 100;
          }
        for (const e of other)
          if (nearEdge(p, e.a, e.b, edgeClearance)) cost += 100;
        for (const e of incident) {
          for (const n of points)
            if (n !== e.a && n !== e.b && nearEdge(n, e.a, e.b, edgeClearance))
              cost += 100;
          for (const f of other)
            if (
              e.a !== f.a &&
              e.a !== f.b &&
              e.b !== f.a &&
              e.b !== f.b &&
              crosses(e.a, e.b, f.a, f.b)
            )
              cost += 10;
        }
        return cost;
      };
      let best = score();
      if (best === 0 || !incident.length) continue;
      const origin = { x: p.x, y: p.y },
        neighbors = incident.map((e) => (e.a === p ? e.b : e.a));
      const candidates = [
        {
          x: neighbors.reduce((s, n) => s + n.x, 0) / neighbors.length,
          y: neighbors.reduce((s, n) => s + n.y, 0) / neighbors.length,
        },
      ];
      if (extended)
        for (const e of other) {
          if (!nearEdge(p, e.a, e.b, 32)) continue;
          const dx = e.b.x - e.a.x,
            dy = e.b.y - e.a.y,
            length = Math.hypot(dx, dy) || 1;
          for (const side of [-1, 1])
            candidates.push({
              x: origin.x - ((side * dy) / length) * GAP,
              y: origin.y + ((side * dx) / length) * GAP,
            });
        }
      for (const radius of [GAP / 2, GAP, GAP * 2])
        for (let i = 0; i < (extended ? 8 : 12); i++)
          candidates.push({
            x: origin.x + Math.cos((i * TAU) / (extended ? 8 : 12)) * radius,
            y: origin.y + Math.sin((i * TAU) / (extended ? 8 : 12)) * radius,
          });
      let chosen = origin;
      for (const candidate of candidates) {
        p.x = candidate.x;
        p.y = candidate.y;
        const cost = score();
        if (cost < best) {
          best = cost;
          chosen = candidate;
          improved = true;
        }
        if (best === 0) break;
      }
      p.x = chosen.x;
      p.y = chosen.y;
    }
    if (!improved) break;
  }
}

function layoutCore(
  ids: string[],
  adjacency: Adjacency,
  weights: Map<string, number>,
  options: LayoutOptions,
): Point[] {
  if (ids.length === 1) return [{ id: ids[0], x: 0, y: 0 }];
  const allowed = new Set(ids),
    links: Link[] = [];
  for (const id of ids)
    for (const next of adjacency.get(id)!)
      if (allowed.has(next) && id < next)
        links.push({ source: id, target: next });
  const neighbors = (id: string) =>
    [...adjacency.get(id)!].filter((n) => allowed.has(n));
  // A simple cycle has an exact crossing-free embedding; force simulation can fold it.
  if (ids.every((id) => neighbors(id).length === 2)) {
    const order = [ids[0]];
    let previous = "",
      current = ids[0];
    while (order.length < ids.length) {
      const next = neighbors(current).find(
        (n) => n !== previous && n !== order[0],
      )!;
      order.push(next);
      previous = current;
      current = next;
    }
    const radius = Math.max(
      150,
      (ids.length * GAP) / TAU,
      ...ids.map((id) => (weights.get(id) ?? 1) * 12 + 20),
    );
    // Reserve local room for a fan instead of sending its leaves thousands of
    // units down a narrow cone. Adjacent fan disks remain separated on cycles.
    const cone = (TAU / ids.length) * 0.9;
    const crowded = ids.some(
      (id) =>
        adjacency.get(id)!.size > 2 &&
        ((weights.get(id) ?? 1) * GAP) / cone >
          Math.max(180, Math.sqrt(weights.get(id) ?? 1) * GAP),
    );
    const active = order
      .map((id, i) => ({
        i,
        radius: Math.max(180, Math.sqrt(weights.get(id) ?? 1) * GAP),
      }))
      .filter((p) => adjacency.get(order[p.i])!.size > 2);
    const spacing = order.map(() => GAP);
    if (crowded && active.length > 1)
      for (let i = 0; i < active.length; i++) {
        const a = active[i],
          b = active[(i + 1) % active.length],
          count = (b.i - a.i + order.length) % order.length;
        const required = Math.max(GAP, (a.radius + b.radius + GAP) / count);
        for (let j = 0; j < count; j++)
          spacing[(a.i + j) % order.length] = required;
      }
    const perimeter = spacing.reduce((sum, n) => sum + n, 0),
      angles = [0];
    for (let i = 1; i < order.length; i++)
      angles.push(angles[i - 1] + (spacing[i - 1] / perimeter) * TAU);
    let reservedRadius = radius;
    if (crowded && active.length > 1) {
      for (let i = 0; i < order.length; i++)
        reservedRadius = Math.max(
          reservedRadius,
          spacing[i] / (2 * Math.sin((spacing[i] / perimeter) * Math.PI)),
        );
      for (let i = 0; i < active.length; i++) {
        const a = active[i],
          b = active[(i + 1) % active.length];
        const angle = (angles[b.i] - angles[a.i] + TAU) % TAU;
        reservedRadius = Math.max(
          reservedRadius,
          (a.radius + b.radius + GAP) / (2 * Math.sin(angle / 2)),
        );
      }
    }
    return order.map((id, i) => ({
      id,
      x: Math.cos(angles[i]) * reservedRadius,
      y: Math.sin(angles[i]) * reservedRadius,
    }));
  }
  const graph = new Graph({ type: "undirected" }),
    columns = Math.ceil(Math.sqrt(ids.length));
  ids.forEach((id, i) =>
    graph.addNode(id, {
      x: (i % columns) * GAP,
      y: Math.floor(i / columns) * GAP,
      size: 24 + (weights.get(id) ?? 1) * 10,
    }),
  );
  links.forEach((e) => graph.addEdge(e.source, e.target));
  forceAtlas2.assign(graph, {
    iterations: 240,
    settings: {
      gravity: 0.1,
      scalingRatio: 40,
      linLogMode: true,
      adjustSizes: true,
      barnesHutOptimize: ids.length > 100,
      slowDown: 5,
    },
  });
  let points = ids.map((id) => ({
    id,
    x: graph.getNodeAttribute(id, "x") as number,
    y: graph.getNodeAttribute(id, "y") as number,
  }));
  if (options.coreLayout)
    points = options.coreLayout(ids, links, weights, points);
  separate(points);
  // Swaps change the embedding without deleting or rerouting real relationships.
  // Bound this expensive polish; larger cores retain the force-directed placement.
  if (ids.length <= 24 && links.length <= 60) {
    const byId = new Map(points.map((p) => [p.id, p]));
    const score = () => {
      let cost = 0;
      for (let i = 0; i < links.length; i++) {
        const e = links[i],
          a = byId.get(e.source)!,
          b = byId.get(e.target)!;
        cost += Math.hypot(a.x - b.x, a.y - b.y) * 0.00001;
        for (const p of points)
          if (p !== a && p !== b && distanceToEdge(p, a, b) < 28) cost += 100;
        for (let j = i + 1; j < links.length; j++) {
          const f = links[j];
          if (
            e.source === f.source ||
            e.source === f.target ||
            e.target === f.source ||
            e.target === f.target
          )
            continue;
          if (crosses(a, b, byId.get(f.source)!, byId.get(f.target)!))
            cost += 10;
        }
      }
      return cost;
    };
    let best = score();
    for (let pass = 0; pass < 3; pass++) {
      let improved = false;
      for (let i = 0; i < points.length; i++)
        for (let j = i + 1; j < points.length; j++) {
          const a = points[i],
            b = points[j];
          [a.x, b.x] = [b.x, a.x];
          [a.y, b.y] = [b.y, a.y];
          const next = score();
          if (next < best - 0.001) {
            best = next;
            improved = true;
          } else {
            [a.x, b.x] = [b.x, a.x];
            [a.y, b.y] = [b.y, a.y];
          }
        }
      if (!improved) break;
    }
  }
  untangle(points, links);
  return points;
}

function componentLayout(
  ids: string[],
  adjacency: Adjacency,
  options: LayoutOptions,
): Point[] {
  // Peel pendant trees to expose the cyclic core. For a tree, the final peeled
  // vertex is a center, keeping long branches balanced without recursive calls.
  const degree = new Map(ids.map((id) => [id, adjacency.get(id)!.size]));
  const queue = ids.filter((id) => degree.get(id)! <= 1),
    peeled = new Set<string>();
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i];
    peeled.add(id);
    for (const next of adjacency.get(id)!)
      if (!peeled.has(next)) {
        const d = degree.get(next)! - 1;
        degree.set(next, d);
        if (d === 1) queue.push(next);
      }
  }
  let roots = ids.filter((id) => !peeled.has(id));
  if (!roots.length) roots = [queue.at(-1)!];
  const core = new Set(roots),
    children = new Map(ids.map((id) => [id, [] as string[]]));
  const order = [...roots],
    visited = new Set(roots);
  for (let i = 0; i < order.length; i++)
    for (const next of adjacency.get(order[i])!)
      if (!visited.has(next)) {
        visited.add(next);
        children.get(order[i])!.push(next);
        order.push(next);
      }
  const weights = new Map<string, number>();
  for (const id of [...order].reverse())
    weights.set(
      id,
      Math.max(
        1,
        children.get(id)!.reduce((sum, n) => sum + weights.get(n)!, 0),
      ),
    );
  const points = layoutCore(roots, adjacency, weights, options),
    byId = new Map(points.map((p) => [p.id, p]));
  for (const root of roots) {
    const origin = byId.get(root)!,
      branches = children.get(root)!;
    if (!branches.length) continue;
    // The largest angular gap between core edges faces away from the interior.
    const angles = [...adjacency.get(root)!]
      .filter((n) => core.has(n))
      .map((n) =>
        Math.atan2(byId.get(n)!.y - origin.y, byId.get(n)!.x - origin.x),
      )
      .sort((a, b) => a - b);
    let start = -Math.PI,
      width = TAU;
    if (angles.length) {
      let gap = 0;
      for (let i = 0; i < angles.length; i++) {
        const end = i + 1 < angles.length ? angles[i + 1] : angles[0] + TAU;
        if (end - angles[i] > gap) {
          gap = end - angles[i];
          start = angles[i];
        }
      }
      // Stay in the outward normal cone. Using most of the empty gap lets
      // adjacent hub fans point backward and cross each other's spokes.
      const normalCone = gap - Math.PI;
      width = (normalCone > 0.000001 ? normalCone : Math.PI / 12) * 0.9;
      start += (gap - width) / 2;
    }
    let step = Math.max(120, (weights.get(root)! * GAP) / width);
    const localRadius = Math.max(180, Math.sqrt(weights.get(root)!) * GAP);
    if (angles.length && width < Math.PI * 0.85 && step > localRadius) {
      const center = start + width / 2;
      width = Math.min(
        Math.PI * 0.85,
        (weights.get(root)! * GAP) / localRadius,
      );
      start = center - width / 2;
      step = localRadius;
    }
    const pending = [{ id: root, start, width, depth: 0 }];
    for (let i = 0; i < pending.length; i++) {
      const item = pending[i];
      let cursor = item.start;
      for (const id of children.get(item.id)!) {
        const span = (item.width * weights.get(id)!) / weights.get(item.id)!;
        const angle = cursor + span / 2,
          depth = item.depth + 1;
        const p = {
          id,
          x: origin.x + Math.cos(angle) * depth * step,
          y: origin.y + Math.sin(angle) * depth * step,
        };
        points.push(p);
        byId.set(id, p);
        pending.push({ id, start: cursor, width: span, depth });
        cursor += span;
      }
    }
  }
  separate(points);
  const links: Link[] = [];
  for (const id of ids)
    for (const next of adjacency.get(id)!)
      if (id < next) links.push({ source: id, target: next });
  untangle(points, links, options.polish);
  removeNodeOverlaps(points);
  return points;
}

export function arrangeGraph(
  nodes: string[],
  edges: Link[],
  options: LayoutOptions = {},
): Point[] {
  nodes = [...new Set(nodes)].sort();
  edges = edges.toSorted((a, b) => {
    if (
      options.order === "evidence" &&
      a.order &&
      b.order &&
      a.order !== b.order
    )
      return a.order < b.order ? -1 : 1;
    const ak = [a.source, a.target].sort().join("\0"),
      bk = [b.source, b.target].sort().join("\0");
    return ak < bk ? -1 : ak > bk ? 1 : 0;
  });
  const adjacency: Adjacency = new Map(
    nodes.map((id) => [id, new Set<string>()]),
  );
  for (const e of edges)
    if (
      e.source !== e.target &&
      adjacency.has(e.source) &&
      adjacency.has(e.target)
    ) {
      adjacency.get(e.source)!.add(e.target);
      adjacency.get(e.target)!.add(e.source);
    }
  if (options.order === "degree") {
    nodes.sort(
      (a, b) =>
        adjacency.get(b)!.size - adjacency.get(a)!.size || (a < b ? -1 : 1),
    );
    for (const id of nodes)
      adjacency.set(
        id,
        new Set(
          [...adjacency.get(id)!].sort(
            (a, b) =>
              adjacency.get(b)!.size - adjacency.get(a)!.size ||
              (a < b ? -1 : 1),
          ),
        ),
      );
  }
  if (options.order === "natural") {
    const natural = (a: string, b: string) =>
      a.localeCompare(b, "en", { numeric: true });
    nodes.sort(natural);
    for (const id of nodes)
      adjacency.set(id, new Set([...adjacency.get(id)!].sort(natural)));
  }
  const seen = new Set<string>(),
    components: string[][] = [];
  for (const id of nodes) {
    if (seen.has(id)) continue;
    const component = [id];
    seen.add(id);
    for (let i = 0; i < component.length; i++)
      for (const next of adjacency.get(component[i])!)
        if (!seen.has(next)) {
          seen.add(next);
          component.push(next);
        }
    components.push(component);
  }
  const boxes = components
    .map((ids) => {
      const p = componentLayout(ids, adjacency, options);
      const minX = Math.min(...p.map((n) => n.x)),
        minY = Math.min(...p.map((n) => n.y));
      p.forEach((n) => {
        n.x -= minX;
        n.y -= minY;
      });
      return {
        points: p,
        width: Math.max(...p.map((n) => n.x)) + 120,
        height: Math.max(...p.map((n) => n.y)) + 120,
      };
    })
    .sort(
      (a, b) =>
        b.points.length - a.points.length ||
        (a.points[0].id < b.points[0].id ? -1 : 1),
    );
  const rowWidth = Math.max(
    120,
    Math.sqrt(
      boxes.reduce((sum, b) => sum + b.width * b.height, 0) *
        Math.max(0.2, Math.min(5, options.aspectRatio ?? 1.96)),
    ),
  );
  let x = 0,
    y = 0,
    rowHeight = 0;
  const output: Point[] = [];
  for (const box of boxes) {
    if (x > 0 && x + box.width > rowWidth) {
      x = 0;
      y += rowHeight;
      rowHeight = 0;
    }
    for (const p of box.points)
      output.push({ id: p.id, x: p.x + x, y: p.y + y });
    x += box.width;
    rowHeight = Math.max(rowHeight, box.height);
  }
  return output;
}
