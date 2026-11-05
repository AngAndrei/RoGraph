/** Local/private inputs stay outside Git. Example:
 * npx tsx scripts/compare-layouts.ts --fixtures build/graph-layout-research --baseline build/readability-original-layout.ts
 */
import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { arrangeGraph, type Point } from "../apps/web/src/layout.js";
import { optimizeGraph } from "../apps/web/src/network-layout.js";
import { measureLayout } from "../apps/web/src/layout-quality.js";
import { projectGraph } from "../apps/web/src/graph-projection.js";
import type { QueryResult } from "../packages/contracts/src/query.js";

const arg = (name: string, fallback: string) =>
  process.argv.includes(name)
    ? (process.argv[process.argv.indexOf(name) + 1] ?? fallback)
    : fallback;
const fixtureDir = resolve(arg("--fixtures", "build/graph-layout-research"));
const output = resolve(arg("--out", "build/layout-comparison"));
const repeats = Number(arg("--repeats", "3"));
if (!Number.isInteger(repeats) || repeats < 1 || repeats > 30)
  throw new Error("repeats must be 1..30");
const baselinePath = process.argv.includes("--baseline")
  ? resolve(arg("--baseline", ""))
  : undefined;
const original: typeof arrangeGraph = baselinePath
  ? (await import(pathToFileURL(baselinePath).href)).arrangeGraph
  : arrangeGraph;
await mkdir(output, { recursive: true });
const samples: {
  name: string;
  query: QueryResult;
  details: boolean;
  hash: string;
}[] = [];
for (const file of (await readdir(fixtureDir)).sort()) {
  if (
    !/-gameplay\.json$/.test(file) &&
    !/(Photon|SaveHer).*?-code\.json$/.test(file)
  )
    continue;
  const bytes = await readFile(join(fixtureDir, file));
  const query = JSON.parse(bytes.toString()) as QueryResult;
  const hash = createHash("sha256").update(bytes).digest("hex");
  await writeFile(join(output, file), bytes);
  samples.push({
    name: file.replace(/\.json$/, ""),
    query,
    details: file.endsWith("-code.json"),
    hash,
  });
}
if (!samples.length) throw new Error("No frozen graph fixtures found");
const results: unknown[] = [];
for (const sample of samples) {
  const view = projectGraph(sample.query, sample.details),
    nodes = view.nodes.map((n) => n.id);
  const edges = view.edges.map((e) => ({
    source: e.source!,
    target: e.target!,
    order: [...e.relationIds].sort()[0],
  }));
  const entries = new Map<
    string,
    { milliseconds: number[]; positions: Point[]; engine: string }
  >();
  // Interleave algorithms. First iteration is recorded separately as a cold run.
  for (let repeat = 0; repeat <= repeats; repeat++)
    for (const mode of ["original", "topology", "fcose", "adaptive"] as const) {
      const start = performance.now();
      const r =
        mode === "original"
          ? { positions: original(nodes, edges), engine: "original" }
          : await optimizeGraph(nodes, edges, {
              aspectRatio: 1000 / 700,
              candidate: mode === "adaptive" ? undefined : mode,
            });
      const elapsed = performance.now() - start;
      const entry = entries.get(mode) ?? {
        milliseconds: [],
        positions: r.positions,
        engine: r.engine,
      };
      entry.milliseconds.push(elapsed);
      entries.set(mode, entry);
    }
  const variants = [];
  for (const [mode, entry] of entries) {
    if (new Set(entry.positions.map((p) => p.id)).size !== nodes.length)
      throw new Error("Lost graph node");
    const times = entry.milliseconds.slice(1).toSorted((a, b) => a - b);
    await writeFile(
      join(output, `${sample.name}-${mode}-positions.json`),
      JSON.stringify(entry.positions),
    );
    variants.push({
      mode,
      engine: entry.engine,
      ...measureLayout(entry.positions, edges),
      firstOptimizationMilliseconds: entry.milliseconds[0],
      repeatOptimizationMilliseconds: entry.milliseconds.slice(1),
      medianMilliseconds: times[Math.floor(times.length / 2)],
      maxMilliseconds: Math.max(...times),
    });
  }
  const result = {
    sample: sample.name,
    sha256: sample.hash,
    nodes: nodes.length,
    connections: edges.length,
    details: sample.details,
    queryTruncated: sample.query.meta?.truncated,
    omittedCounts: sample.query.meta?.omittedCounts,
    variants,
  };
  results.push(result);
  console.log(JSON.stringify(result));
}
await writeFile(
  join(output, "metrics.json"),
  JSON.stringify(
    {
      revision: execFileSync("git", ["rev-parse", "HEAD"], {
        encoding: "utf8",
      }).trim(),
      node: process.version,
      repeats,
      baseline: baselinePath
        ? {
            sha256: createHash("sha256")
              .update(await readFile(baselinePath))
              .digest("hex"),
          }
        : "current topology",
      packages: JSON.parse(await readFile("package.json", "utf8")).dependencies,
      results,
    },
    null,
    2,
  ),
);
