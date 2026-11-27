import { Worker } from "node:worker_threads";
import { RoGraphError } from "./util.js";
import type { GraphStore } from "./store.js";
import type { Query, QueryResult } from "../../contracts/src/query.js";
import type { GraphDiff } from "./diff.js";
export class WorkerClient {
  private worker: Worker;
  private failure?: Error;
  private termination?: Promise<number>;
  private next = 0;
  private pending = new Map<
    number,
    { resolve: (v: any) => void; reject: (e: any) => void; cleanup: () => void }
  >();
  constructor() {
    const source = import.meta.url.endsWith(".ts");
    this.worker = new Worker(
      new URL(
        source ? "../../../apps/local/src/worker.ts" : "./worker.js",
        import.meta.url,
      ),
      {
        execArgv: source ? ["--import", "tsx"] : [],
        resourceLimits: { maxOldGenerationSizeMb: 1536 },
      },
    );
    this.worker.on("message", (m) => {
      const p = this.pending.get(m.id);
      if (!p) return;
      this.pending.delete(m.id);
      p.cleanup();
      m.error
        ? p.reject(new RoGraphError(m.error.code, m.error.message))
        : p.resolve(m.value);
    });
    this.worker.on("error", (error) => this.fail(error));
    this.worker.on("exit", (code) =>
      this.fail(new RoGraphError("WORKER_EXIT", `Worker exited (${code})`)),
    );
  }
  get stopped() {
    return this.failure !== undefined;
  }
  private fail(error: Error) {
    this.failure ??= error;
    for (const pending of this.pending.values()) {
      pending.cleanup();
      pending.reject(this.failure);
    }
    this.pending.clear();
  }
  call<T = any>(
    op: string,
    args: unknown[] = [],
    signal?: AbortSignal,
  ): Promise<T> {
    signal?.throwIfAborted();
    if (this.failure) return Promise.reject(this.failure);
    if (this.pending.size >= 8)
      return Promise.reject(
        new RoGraphError("WORKER_BUSY", "Worker queue is full"),
      );
    const id = ++this.next;
    return new Promise((resolve, reject) => {
      const abort = () => this.worker.postMessage({ op: "cancel", id });
      const timer = setTimeout(() => {
        this.pending.delete(id);
        cleanup();
        reject(new RoGraphError("WORKER_TIMEOUT", "Worker timed out"));
        void this.terminate();
      }, 120000);
      const cleanup = () => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
      };
      this.pending.set(id, { resolve, reject, cleanup });
      signal?.addEventListener("abort", abort, { once: true });
      this.worker.postMessage({ op, id, args });
    });
  }
  async terminate() {
    this.fail(new RoGraphError("WORKER_EXIT", "Worker stopped"));
    if (this.worker.threadId !== -1) {
      this.termination ??= this.worker.terminate();
    }
    await this.termination;
  }
}
export interface WorkerStore extends GraphStore {
  query(q: Query, signal?: AbortSignal): Promise<QueryResult>;
  diff(before: string, after: string): Promise<GraphDiff>;
}
export async function openWorkerStore(path: string): Promise<WorkerStore> {
  const open = async () => {
    const worker = new WorkerClient();
    try {
      await worker.call("open", [path]);
      return worker;
    } catch (error) {
      await worker.terminate();
      throw error;
    }
  };
  let rpc = await open();
  let reopening: Promise<WorkerClient> | undefined;
  let closed = false;
  const call = async <T>(op: string, args: unknown[] = [], signal?: AbortSignal) => {
    if (closed) throw new RoGraphError("WORKER_EXIT", "Store is closed");
    signal?.throwIfAborted();
    if (rpc.stopped) {
      // Reopen for the next request; never replay the operation that failed.
      reopening ??= rpc.terminate()
        .then(open)
        .then((worker) => (rpc = worker))
        .finally(() => (reopening = undefined));
      await reopening;
    }
    if (closed) throw new RoGraphError("WORKER_EXIT", "Store is closed");
    return rpc.call<T>(op, args, signal);
  };
  return {
    async save(graph, signal) {
      try {
        await call("save", [graph], signal);
      } catch (error) {
        if (!(error instanceof RoGraphError) || error.code !== "WORKER_TIMEOUT")
          throw error;
        signal?.throwIfAborted();
        // SQLite may finish COMMIT before the worker can acknowledge it.
        // Verify the exact saved snapshot on a new worker without replaying the write.
        const saved = await call<QueryResult>(
          "select",
          [{ op: "manifest", analysisId: graph.analysisId, limit: 1 }],
          signal,
        ).catch(() => undefined);
        signal?.throwIfAborted();
        if (saved?.analysisId !== graph.analysisId)
          throw error;
      }
    },
    publish: (id) => call("publish", [id]),
    current: () => call("current"),
    listAnalyses: (l, c) => call("listAnalyses", [l, c]),
    deleteAnalysis: (id) => call("deleteAnalysis", [id]),
    readGraph: (id) => call("readGraph", [id]),
    select: (q) => call("select", [q]),
    query: (q, s) => call("query", [q], s),
    diff: (before, after) => call("diff", [before, after]),
    close: async () => {
      if (closed) return;
      closed = true;
      try {
        await reopening;
        if (!rpc.stopped) await rpc.call("close");
      } finally {
        await rpc.terminate();
      }
    },
  };
}
