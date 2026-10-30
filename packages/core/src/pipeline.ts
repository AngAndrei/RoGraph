import type { Input, Graph } from "../../contracts/src/model.js";
import type { GraphStore } from "./store.js";
import type { ParsedSource } from "../../contracts/src/protocol.js";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importPlace } from "./import.js";
import { buildRojoSnapshot } from "./rojo-import.js";
import { createParseCache } from "./cache.js";
import { WorkerClient } from "./worker-client.js";
import { createNativeSession } from "../../adapters/src/native.js";
export interface Progress {
  stage: string;
  completed: number;
  total: number;
}
export interface AnalyzeOptions {
  cacheDir?: string;
  displayName?: string;
  excludedRoots?: string[];
  onParse?: (hit: boolean) => void;
  onProgress?: (progress: Progress) => void;
}
export async function analyze(
  input: Input,
  store: GraphStore,
  signal?: AbortSignal,
  options: AnalyzeOptions = {},
): Promise<Graph> {
  const report = (stage: string, completed = 0, total = 1) => {
    options.onProgress?.({ stage, completed, total });
    signal?.throwIfAborted();
  };
  report("import");
  const snapshot =
    input.kind === "place"
      ? await importPlace(input.path, signal)
      : await buildRojoSnapshot(
          input.projectPath,
          signal,
          options.excludedRoots,
        );
  report("import", 1);
  const session = createNativeSession("luau-parser"),
    cache = createParseCache(
      options.cacheDir ?? join(tmpdir(), "rograph-parse-cache-v1"),
      { onParse: options.onParse, session },
    );
  const worker = new WorkerClient();
  const abort = () => {
    void worker.terminate();
  };
  signal?.addEventListener("abort", abort, { once: true });
  let graph: Graph;
  try {
    await worker.call("initAnalysis", [snapshot], signal);
    let completed = 0;
    for (const source of snapshot.sources) {
      report("parse", completed, snapshot.sources.length);
      const parsed = await cache.parseCached(source, signal);
      await worker.call("lowerSource", [parsed], signal);
      completed++;
    }
    report("parse", completed, completed);
    await session.close();
    report("resolve");
    graph = await worker.call<Graph>("resolve", [], signal);
  } finally {
    signal?.removeEventListener("abort", abort);
    await session.close();
    await worker.terminate();
  }
  if (options.displayName)
    graph.importManifest.displayName = options.displayName;
  report("persist");
  await store.save(graph, signal);
  report("persist", 1);
  signal?.throwIfAborted();
  if (!graph.coverage.partialImport) await store.publish(graph.analysisId);
  options.onProgress?.({ stage: "complete", completed: 1, total: 1 });
  return graph;
}
