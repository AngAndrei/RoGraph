import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, sep, join } from "node:path";
import { performance } from "node:perf_hooks";
import { freemem } from "node:os";
import { answerRequest } from "../packages/assistant/src/assistant.js";
import { createQueryEngine } from "../packages/core/src/query.js";
import { openStore } from "../packages/core/src/store.js";
import { createModelManager } from "../apps/local/src/assistant/models.js";
import { LocalModelRuntime } from "../apps/local/src/assistant/runtime.js";
import type {
  AssistantIntent,
  AssistantRequest,
} from "../packages/contracts/src/assistant.js";
import type { Query } from "../packages/contracts/src/query.js";

type Task = {
  id: string;
  game: string;
  analysisId: string;
  query: string;
  requiresModel: boolean;
  kind: string;
  selectedId?: string;
  expected: {
    op?: string;
    noQuery?: boolean;
    ambiguous?: boolean;
    noMatch?: boolean;
    textPattern?: string;
    targetId?: string;
    text?: string;
    targetLabel?: string;
    sourceId?: string;
    fromId?: string;
    toId?: string;
    view?: "code" | "gameplay";
    cardKind?: string;
    pathRequired?: boolean;
  };
};
type Snapshot = {
  game: string;
  analysisId: string;
  evaluationDatabasePath: string;
};
const flag = (name: string, fallback: string) =>
  process.argv
    .find((a) => a.startsWith(`--${name}=`))
    ?.slice(name.length + 3) ?? fallback;
const input = JSON.parse(
  await readFile(resolve(flag("cases", "build/multigame-cases.json")), "utf8"),
) as { cases: Task[]; snapshots: Snapshot[] };
const modelIds = flag("models", "qwen3.5-0.8b,qwen3.5-2b,qwen3.5-4b").split(
  ",",
);
const out = resolve(flag("out", "build/model-comparison"));
await mkdir(out, { recursive: true });
const manager = await createModelManager({ root: resolve("models") });
const original = await manager.status();
if (!original.selectedId) {
  await manager.close();
  throw Error(
    "Select an installed baseline model before comparing so its preferences can be restored.",
  );
}
const stores = new Map<string, Awaited<ReturnType<typeof openStore>>>();
const engines = new Map<string, ReturnType<typeof createQueryEngine>>();
const stats = (values: number[]) => {
  const v = [...values].sort((a, b) => a - b);
  return {
    n: v.length,
    min: v[0],
    median: v[Math.floor(v.length / 2)],
    p95: v[Math.max(0, Math.ceil(v.length * 0.95) - 1)],
    max: v.at(-1),
  };
};
try {
  for (const snapshot of input.snapshots) {
    if (
      !resolve(snapshot.evaluationDatabasePath).startsWith(
        resolve("build") + sep,
      )
    )
      throw Error("Evaluate an app-owned backup, not the live workspace");
    let store = stores.get(snapshot.evaluationDatabasePath);
    if (!store) {
      store = await openStore(snapshot.evaluationDatabasePath);
      stores.set(snapshot.evaluationDatabasePath, store);
    }
    engines.set(snapshot.analysisId, createQueryEngine(store));
  }
  for (const modelId of modelIds) {
    if (!(await manager.status()).installed.includes(modelId))
      throw Error("Install verified model first: " + modelId);
    await manager.configure({ modelId, backend: "cpu" });
    const runtime = new LocalModelRuntime(manager);
    const rows: any[] = [];
    try {
      const hardware = await runtime.hardware();
      console.log(
        JSON.stringify({
          event: "model-start",
          modelId,
          freeRamGiB: freemem() / 2 ** 30,
        }),
      );
      for (const task of input.cases) {
        const engine = engines.get(task.analysisId)!;
        const calls: Query[] = [];
        let interpreted: AssistantIntent | undefined,
          modelCalls = 0,
          modelMs = 0;
        const begin = performance.now();
        let error: string | undefined;
        let response: Awaited<ReturnType<typeof answerRequest>> | undefined;
        try {
          response = await answerRequest(
            {
              message: task.query,
              analysisId: task.analysisId,
              view: task.expected.view ?? "code",
              selectedId: task.selectedId,
            } as AssistantRequest,
            {
              query: (q, s) => {
                calls.push(q);
                return engine.run(q, s);
              },
              interpret: async (m, c, s) => {
                modelCalls++;
                const start = performance.now();
                try {
                  return (interpreted = await runtime.interpret(m, c, s));
                } finally {
                  modelMs += performance.now() - start;
                }
              },
            },
          );
        } catch (e) {
          error = (e as Error).message;
        }
        const ms = performance.now() - begin;
        const expected = task.expected;
        const operation =
          expected.op === "connections" ? "inspect" : expected.op;
        const scoped =
          calls.every((q) => q.analysisId === task.analysisId) &&
          Boolean(
            response?.cards.every(
              (c) => !c.query || c.query.analysisId === task.analysisId,
            ),
          );
        const checks: Record<string, boolean> = {
          responded: !error,
          scope: scoped,
          budget: calls.length <= 6,
          ...(operation
            ? { operation: calls.some((q) => q.op === operation) }
            : {}),
        };
        if (expected.targetId) {
          if (operation === "search")
            checks.target = Boolean(
              response?.cards.some(
                (c) => c.kind === "node" && c.id === expected.targetId,
              ),
            );
          else if (operation === "source")
            checks.target =
              Boolean(
                response?.cards.some(
                  (c) => c.kind === "node" && c.id === expected.targetId,
                ),
              ) &&
              calls.some(
                (q) =>
                  q.op === "source" &&
                  (!expected.sourceId || q.sourceId === expected.sourceId),
              );
          else
            checks.target = calls.some(
              (q) => q.op === operation && q.nodeId === expected.targetId,
            );
        }
        if (operation === "trace")
          checks.endpoints = calls.some(
            (q) =>
              q.op === "trace" &&
              q.fromId === expected.fromId &&
              q.toId === expected.toId,
          );
        if (expected.pathRequired || expected.cardKind === "path")
          checks.path = Boolean(response?.cards.some((c) => c.kind === "path"));
        if (expected.cardKind && expected.cardKind !== "path")
          checks.card = Boolean(
            response?.cards.some((c) => c.kind === expected.cardKind),
          );
        if (task.kind === "connections")
          checks.evidence = Boolean(
            response?.cards.some((c) => c.kind === "connection" && c.source),
          );
        if (expected.noQuery) checks.noQuery = calls.length === 0;
        if (expected.ambiguous)
          checks.ambiguity =
            Boolean(response?.text.match(/choose|qualified/i)) &&
            calls.every((q) => q.op === "search") &&
            Boolean(response?.cards.length);
        if (expected.textPattern)
          checks.text = new RegExp(expected.textPattern, "i").test(
            response?.text ?? "",
          );
        if (task.kind === "no-match" || expected.noMatch)
          checks.noMatch =
            Boolean(
              response?.text.match(/no (?:literal|verified|supported)/i),
            ) &&
            !response?.cards.some(
              (c) => c.kind === "node" || c.kind === "path",
            );
        const row = {
          id: task.id,
          game: task.game,
          kind: task.kind,
          requiresModel: task.requiresModel,
          pass: Object.values(checks).every(Boolean),
          checks,
          ms: Math.round(ms * 100) / 100,
          modelMs: Math.round(modelMs * 100) / 100,
          modelCalls,
          queries: calls,
          interpreted,
          error,
          query: task.query,
          text: response?.text,
          labels: response?.cards.map((c) => c.label),
          warnings: response?.warnings,
        };
        rows.push(row);
        console.log(
          JSON.stringify({
            modelId,
            id: row.id,
            pass: row.pass,
            ms: row.ms,
            modelCalls,
            checks,
          }),
        );
        await writeFile(
          join(out, modelId + ".progress.json"),
          JSON.stringify({ modelId, rows }, null, 2),
        );
      }
      const modelRows = rows.filter((r) => r.modelCalls > 0);
      const fast = rows.filter((r) => r.modelCalls === 0);
      const warm = modelRows.slice(1);
      const summary = {
        modelId,
        bytes: manager.catalog.find((m) => m.id === modelId)!.bytes,
        passed: rows.filter((r) => r.pass).length,
        total: rows.length,
        modelTasks: {
          passed: modelRows.filter((r) => r.pass).length,
          total: modelRows.length,
        },
        fastTasks: {
          passed: fast.filter((r) => r.pass).length,
          total: fast.length,
        },
        latencyMs: stats(rows.map((r) => r.ms)),
        warmModelMs: stats(warm.map((r) => r.ms)),
        coldModelMs: modelRows[0]?.ms,
        perGame: input.snapshots.map((s) => ({
          game: s.game,
          passed: rows.filter((r) => r.game === s.game && r.pass).length,
          total: rows.filter((r) => r.game === s.game).length,
        })),
        actualBackend: (await runtime.status()).actualBackend,
      };
      await writeFile(
        join(out, modelId + ".json"),
        JSON.stringify(
          { generatedAt: new Date().toISOString(), hardware, summary, rows },
          null,
          2,
        ) + "\n",
      );
      console.log(JSON.stringify({ event: "model-complete", ...summary }));
    } finally {
      await runtime.close();
    }
  }
} finally {
  await manager.configure({
    modelId: original.selectedId,
    backend: original.backend,
  });
  await manager.close();
  for (const store of stores.values()) await store.close();
}
