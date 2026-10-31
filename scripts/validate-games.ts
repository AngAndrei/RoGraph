import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import { resolve, join, extname } from "node:path";
import { analyze } from "../packages/core/src/pipeline.js";
import { openWorkerStore } from "../packages/core/src/worker-client.js";
import { createContext } from "../packages/core/src/context.js";
import { hash } from "../packages/core/src/util.js";
if (!process.argv[2])
  throw Error("Choose an explicit local test-game directory");
const directory = resolve(process.argv[2]),
  reportPath = resolve(process.argv[3] ?? "build/real-game-validation.json");
const inputs = (await readdir(directory))
  .filter((name) => /\.(rbxlx|rbxl)$/i.test(name))
  .sort();
if (!inputs.length) throw Error("No saved Roblox places found");
const games = [];
for (const name of inputs) {
  const path = join(directory, name),
    before = hash(await readFile(path));
  const workspace = resolve(
    "private-inputs",
    "acceptance",
    name.replace(/[^a-z0-9_-]/gi, "_") + "-" + before.slice(0, 12),
  );
  await mkdir(workspace, { recursive: true });
  let store = await openWorkerStore(join(workspace, "graph.db"));
  const started = performance.now();
  let previousStage = "";
  try {
    const graph = await analyze({ kind: "place", path }, store, undefined, {
      cacheDir: join(workspace, "cache"),
      excludedRoots: [workspace],
      onProgress: (p) => {
        if (p.stage !== previousStage) {
          process.stderr.write(name + ": " + p.stage + "\n");
          previousStage = p.stage;
        }
      },
    });
    const milliseconds = performance.now() - started;
    const semantic = graph.relations.filter((r) => r.gameplay);
    const gameplay = await store.query({
      op: "overview",
      analysisId: graph.analysisId,
      view: "gameplay",
      limit: 300,
    });
    if (gameplay.nodes.some((n) => n.kind !== "instance"))
      throw Error("ABSTRACT_GAMEPLAY_NODE");
    let gameplayTraceChecked = false;
    const behavior = semantic.find(
      (r) =>
        r.type === "HAS_BEHAVIOR" &&
        semantic.some((s) => s.type === "SPAWNS" && s.source === r.target),
    );
    if (behavior) {
      const spawn = semantic.find(
        (r) => r.type === "SPAWNS" && r.source === behavior.target,
      )!;
      const traced = await store.query({
        op: "trace",
        view: "gameplay",
        analysisId: graph.analysisId,
        fromId: behavior.source,
        toId: spawn.target,
        depth: 6,
        limit: 300,
      });
      if (!traced.paths.length) throw Error("GAMEPLAY_MODEL_FLOW_MISSING");
      gameplayTraceChecked = true;
    }
    const gameplayPack = createContext(gameplay, {
      estimatedTokenBudget: 4000,
    });
    if (gameplayPack.utf8Bytes > 32000)
      throw Error("GAMEPLAY_CONTEXT_OVER_BUDGET");
    const searchable =
      graph.nodes.find((n) => n.kind === "function") ??
      graph.nodes.find((n) => n.kind === "instance" && n.attributes.sourceId);
    let searched = false,
      inspected = false,
      sourceChecked = false,
      traced = false,
      exportChecked = false;
    if (searchable) {
      const token = searchable.label.match(/[\p{L}\p{N}_]{3,}/u)?.[0];
      if (token) {
        const result = await store.query({
          op: "search",
          analysisId: graph.analysisId,
          text: token,
          limit: 50,
        });
        if (!result.nodes.length) throw Error("SEARCH_RETURNED_NO_MATCHES");
        searched = true;
      }
      const inspect = await store.query({
        op: "inspect",
        analysisId: graph.analysisId,
        nodeId: searchable.id,
        limit: 50,
      });
      if (!inspect.nodes.some((n) => n.id === searchable.id))
        throw Error("INSPECT_LOST_SELECTED_NODE");
      inspected = true;
      await store.query({
        op: "dependencies",
        analysisId: graph.analysisId,
        nodeId: searchable.id,
        depth: 2,
        limit: 50,
      });
      await store.query({
        op: "impact",
        analysisId: graph.analysisId,
        nodeId: searchable.id,
        depth: 2,
        limit: 50,
      });
      const pack = createContext(inspect, { estimatedTokenBudget: 2000 });
      if (pack.utf8Bytes > 32000 || pack.json.analysisId !== graph.analysisId)
        throw Error("CONTEXT_BOUND_OR_ID_MISMATCH");
      exportChecked = true;
    }
    if (graph.sources.length) {
      const source = graph.sources[0],
        result = await store.query({
          op: "source",
          analysisId: graph.analysisId,
          sourceId: source.id,
          startByte: 0,
          endByte: 256,
        });
      if (result.sources[0]?.sha256 !== source.sha256)
        throw Error("SOURCE_REVISION_MISMATCH");
      sourceChecked = true;
    }
    const edge = graph.relations.find(
      (r) =>
        ["CALLS", "REQUIRES", "READS"].includes(r.type) &&
        graph.evidence.some((e) => e.relationId === r.id),
    );
    if (edge) {
      const result = await store.query({
        op: "trace",
        analysisId: graph.analysisId,
        fromId: edge.source,
        toId: edge.target,
        depth: 2,
        limit: 100,
      });
      if (!result.paths.length) throw Error("DIRECT_MODELED_TRACE_MISSING");
      for (const hop of result.paths[0])
        if (!result.evidence.some((e) => e.relationId === hop.relationId))
          throw Error("TRACE_HOP_WITHOUT_EVIDENCE");
      traced = true;
    }
    const retained = join(
      workspace,
      "blobs",
      before + extname(name).toLowerCase(),
    );
    if (hash(await readFile(retained)) !== before)
      throw Error("RETAINED_RAW_BYTES_DIFFER");
    await store.close();
    store = await openWorkerStore(join(workspace, "graph.db"));
    const analyses = await store.listAnalyses(100);
    if (!analyses.items.some((a) => a.analysisId === graph.analysisId))
      throw Error("REOPEN_LOST_ANALYSIS");
    if (
      !graph.coverage.partialImport &&
      (await store.current()) !== graph.analysisId
    )
      throw Error("COMPLETE_ANALYSIS_NOT_PUBLISHED");
    if (hash(await readFile(path)) !== before)
      throw Error("ORIGINAL_FILE_CHANGED");
    const diagnosticCounts = Object.fromEntries(
      [...new Set(graph.diagnostics.map((d) => d.code))]
        .sort()
        .map((code) => [
          code,
          graph.diagnostics.filter((d) => d.code === code).length,
        ]),
    );
    games.push({
      name,
      sha256: before,
      analysisId: graph.analysisId,
      bytes: (await readFile(path)).length,
      milliseconds,
      coverage: graph.coverage,
      nodes: graph.nodes.length,
      relations: graph.relations.length,
      evidence: graph.evidence.length,
      gameplay: {
        relations: semantic.length,
        types: Object.fromEntries(
          [...new Set(semantic.map((r) => r.type))].map((type) => [
            type,
            semantic.filter((r) => r.type === type).length,
          ]),
        ),
        visibleNodes: gameplay.nodes.length,
        visibleEdges: gameplay.projection?.edges.length ?? 0,
        traceChecked: gameplayTraceChecked,
        contextChecked: true,
      },
      unresolvedReasons: Object.fromEntries(
        [
          ...new Set(
            graph.sites
              .filter((s) => s.status === "unresolved")
              .map((s) => s.reason ?? "unknown"),
          ),
        ].map((reason) => [
          reason,
          graph.sites.filter(
            (s) => s.status === "unresolved" && s.reason === reason,
          ).length,
        ]),
      ),
      diagnosticCounts,
      checks: {
        searched,
        inspected,
        sourceChecked,
        traced,
        exportChecked,
        reopened: true,
        rawBytesRetained: true,
        inputUnchanged: true,
      },
    });
    process.stdout.write(JSON.stringify(games.at(-1)) + "\n");
  } finally {
    await store.close();
  }
}
await writeFile(
  reportPath,
  JSON.stringify(
    {
      createdAt: new Date().toISOString(),
      status: "provided-game validation; static coverage limits apply",
      games,
    },
    null,
    2,
  ),
);
