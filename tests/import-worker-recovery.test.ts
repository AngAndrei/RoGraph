import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { expect, it, vi } from "vitest";
import { openWorkerStore, WorkerClient } from "../packages/core/src/worker-client.js";
import { RoGraphError } from "../packages/core/src/util.js";
import { resolveFixture } from "./support/resolve.js";
import { withWorkspace } from "./support/workspace.js";

it("rejects calls immediately after an analysis worker has stopped", async () => {
  const worker = new WorkerClient();
  await worker.terminate();
  await expect(
    Promise.race([
      worker.call("resolve").catch((error) => error.code),
      delay(250, "still waiting", { ref: false }),
    ]),
  ).resolves.toBe("WORKER_EXIT");
});

it("reopens a stopped store worker once and retains the published snapshot", async () =>
  withWorkspace(async (directory) => {
    const opened: WorkerClient[] = [];
    const originalCall = WorkerClient.prototype.call;
    const spy = vi.spyOn(WorkerClient.prototype, "call").mockImplementation(
      function (this: WorkerClient, ...args) {
        if (args[0] === "open") opened.push(this);
        return originalCall.apply(this, args);
      },
    );
    const store = await openWorkerStore(join(directory, "graph.db"));
    try {
      const graph = await resolveFixture("shop/place.rbxlx");
      await store.save(graph);
      await store.publish(graph.analysisId);
      await opened[0].terminate();
      const [current, analyses] = await Promise.all([
        store.current(),
        store.listAnalyses(10),
      ]);
      expect(current).toBe(graph.analysisId);
      expect(analyses.items.map((row) => row.analysisId)).toEqual([graph.analysisId]);
      expect(opened).toHaveLength(2);
    } finally {
      await store.close();
      spy.mockRestore();
    }
  }), 45_000);

it.each([true, false])("checks whether a timed-out save committed (%s) without replaying it", async (committed) =>
  withWorkspace(async (directory) => {
    const originalCall = WorkerClient.prototype.call;
    let saves = 0;
    const timeout = new RoGraphError("WORKER_TIMEOUT", "Worker timed out");
    const spy = vi.spyOn(WorkerClient.prototype, "call").mockImplementation(
      async function (this: WorkerClient, ...args) {
        if (args[0] !== "save") return originalCall.apply(this, args);
        saves++;
        if (committed) await originalCall.apply(this, args);
        await this.terminate();
        throw timeout;
      },
    );
    const store = await openWorkerStore(join(directory, "graph.db"));
    try {
      const graph = await resolveFixture("shop/place.rbxlx");
      if (committed) await expect(store.save(graph)).resolves.toBeUndefined();
      else await expect(store.save(graph)).rejects.toBe(timeout);
      expect(saves).toBe(1);
      expect((await store.listAnalyses(10)).items).toHaveLength(committed ? 1 : 0);
      expect(await store.current()).toBeNull();
    } finally {
      await store.close();
      spy.mockRestore();
    }
  }), 45_000);
