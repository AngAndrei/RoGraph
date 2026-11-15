import ELK from "elkjs/lib/elk.bundled.js";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { optimizeGraph } from "../apps/web/src/network-layout.js";
import { arrangeInitialGraph } from "../apps/web/src/initial-layout.js";
import { measureLayout } from "../apps/web/src/layout-quality.js";
import type { Point, Link } from "../apps/web/src/layout.js";
// Run inspect-default-layout on the baseline first; keep its frozen inputs private.
const source = resolve(process.argv[2] ?? "build/default-layout-review/before"),
  out = resolve(process.argv[3] ?? "build/default-layout-review/comparison");
await mkdir(out, { recursive: true });
const results: any[] = [];
for (const sample of [
  "SaveHer",
  "Grow_a_Chicken",
  "BanglaBattlegrounds_20240706_01",
]) {
  const query = JSON.parse(
    await readFile(join(source, sample + "-gameplay.json"), "utf8"),
  );
  const run = JSON.parse(
    await readFile(join(source, sample + "-layout.json"), "utf8"),
  );
  const { nodes, edges, aspectRatio } = run.request as {
    nodes: string[];
    edges: Link[];
    aspectRatio: number;
  };
  const adjacency = new Map(nodes.map((id) => [id, new Set<string>()]));
  for (const e of edges) {
    adjacency.get(e.source)?.add(e.target);
    adjacency.get(e.target)?.add(e.source);
  }
  const seen = new Set<string>(),
    components: string[][] = [];
  for (const id of [...nodes].sort()) {
    if (seen.has(id)) continue;
    const ids = [id];
    seen.add(id);
    for (let i = 0; i < ids.length; i++)
      for (const n of adjacency.get(ids[i])!)
        if (!seen.has(n)) {
          seen.add(n);
          ids.push(n);
        }
    components.push(ids.sort());
  }
  const variants: any[] = [];
  for (const mode of [
    "original",
    "topology",
    "stress",
    "radial",
    "layered",
    "selected",
  ]) {
    const started = performance.now();
    let positions: Point[];
    try {
      if (mode === "original") positions = run.response.positions;
      else if (mode === "selected")
        positions = (await arrangeInitialGraph(nodes, edges, { aspectRatio }))
          .positions;
      else if (mode === "topology")
        positions = (await optimizeGraph(nodes, edges, { aspectRatio }))
          .positions;
      else {
        const elk = new ELK();
        const layouts: Point[][] = [];
        for (const ids of components) {
          const allowed = new Set(ids),
            links = edges.filter(
              (e) => allowed.has(e.source) && allowed.has(e.target),
            );
          const graph = await elk.layout({
            id: "root",
            layoutOptions: {
              "elk.algorithm": mode,
              "elk.randomSeed": "1",
              "elk.spacing.nodeNode": "70",
              "elk.spacing.componentComponent": "130",
              "elk.aspectRatio": String(aspectRatio),
              "elk.stress.iterationLimit": "200",
              "elk.stress.desiredEdgeLength": "140",
              "elk.radial.radius": "160",
              "elk.edgeRouting": "STRAIGHT",
              "elk.direction": "RIGHT",
            },
            children: ids.map((id) => ({ id, width: 36, height: 36 })),
            edges: links.map((e, i) => ({
              id: "e" + i,
              sources: [e.source],
              targets: [e.target],
            })),
          });
          layouts.push(
            graph.children!.map((n) => ({
              id: n.id,
              x: n.x! + 18,
              y: -(n.y! + 18),
            })),
          );
        }
        positions = pack(layouts, aspectRatio);
      }
      const ms = performance.now() - started;
      await writeFile(
        join(out, `${sample}-${mode}-positions.json`),
        JSON.stringify(positions),
      );
      variants.push({
        mode,
        milliseconds: mode === "original" ? run.response.milliseconds : ms,
        ...measureLayout(positions, edges),
      });
    } catch (e) {
      variants.push({ mode, error: String(e) });
    }
  }
  await writeFile(join(out, sample + ".json"), JSON.stringify(query));
  const result = {
    sample,
    details: false,
    nodes: nodes.length,
    connections: edges.length,
    components: components.map((c) => c.length).sort((a, b) => b - a),
    variants,
  };
  results.push(result);
  console.log(JSON.stringify(result));
  await writeFile(
    join(out, "metrics.json"),
    JSON.stringify({ results }, null, 2),
  );
}

function pack(layouts: Point[][], aspectRatio: number): Point[] {
  const boxes = layouts
    .map((points) => {
      const x = Math.min(...points.map((p) => p.x)),
        y = Math.min(...points.map((p) => p.y));
      return {
        points: points.map((p) => ({ id: p.id, x: p.x - x, y: p.y - y })),
        width: Math.max(...points.map((p) => p.x)) - x + 160,
        height: Math.max(...points.map((p) => p.y)) - y + 120,
      };
    })
    .sort(
      (a, b) =>
        b.height - a.height ||
        b.width - a.width ||
        a.points[0].id.localeCompare(b.points[0].id),
    );
  let best: Point[] = [],
    bestScore = Infinity;
  for (const factor of [0.6, 0.8, 1, 1.2, 1.5, 2]) {
    const target =
      Math.sqrt(
        boxes.reduce((s, b) => s + b.width * b.height, 0) * aspectRatio,
      ) * factor;
    let x = 0,
      y = 0,
      h = 0,
      w = 0;
    const result: Point[] = [];
    for (const box of boxes) {
      if (x && x + box.width > target) {
        y += h;
        x = 0;
        h = 0;
      }
      result.push(...box.points.map((p) => ({ ...p, x: p.x + x, y: p.y + y })));
      x += box.width;
      h = Math.max(h, box.height);
      w = Math.max(w, x);
    }
    const score = Math.max(w / aspectRatio, y + h);
    if (score < bestScore) {
      bestScore = score;
      best = result;
    }
  }
  return best;
}
