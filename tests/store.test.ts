import { it, expect } from "vitest";
import { join } from "node:path";
import { readFile, unlink } from "node:fs/promises";
import { openStore } from "../packages/core/src/store.js";
import { resolveFixture } from "./support/resolve.js";
import { withWorkspace } from "./support/workspace.js";
it("persists evidence, sources and indexed search across reopen", async () =>
  withWorkspace(async (dir) => {
    const g = await resolveFixture("shop/place.rbxlx");
    let s = await openStore(join(dir, "graph.db"));
    await s.save(g);
    await s.publish(g.analysisId);
    await s.close();
    s = await openStore(join(dir, "graph.db"));
    try {
      expect(await s.readGraph(g.analysisId)).toEqual(g);
      expect(
        (
          await s.select({
            op: "search",
            analysisId: g.analysisId,
            text: "Sword",
            limit: 10,
          })
        ).nodes.map((n) => n.label),
      ).toContain("ShopConfig.Prices.Sword");
      expect(await s.current()).toBe(g.analysisId);
      const owned = join(
        dir,
        "blobs",
        String((g.importManifest.inventory as any).rawInput.sha256) + ".rbxlx",
      );
      expect((await readFile(owned)).length).toBeGreaterThan(100);
      await expect(s.readGraph("stale")).rejects.toMatchObject({
        code: "ANALYSIS_NOT_FOUND",
      });
    } finally {
      await s.close();
    }
  }));
it("never publishes partial or canceled work over the last complete snapshot", async () =>
  withWorkspace(async (dir) => {
    const g = await resolveFixture("shop/place.rbxlx"),
      s = await openStore(join(dir, "graph.db"));
    try {
      await s.save(g);
      await s.publish(g.analysisId);
      const partial = {
        ...g,
        analysisId: "partial",
        importManifest: { ...g.importManifest, displayName: "My Game.rbxlx" },
        coverage: { ...g.coverage, partialImport: true },
      };
      await s.save(partial);
      await expect(s.publish("partial")).rejects.toMatchObject({
        code: "PARTIAL_ANALYSIS",
      });
      const c = new AbortController();
      c.abort();
      await expect(
        s.save({ ...g, analysisId: "canceled" }, c.signal),
      ).rejects.toBeDefined();
      expect(await s.current()).toBe(g.analysisId);
      const first = await s.listAnalyses(1);
      expect(first.items).toMatchObject([
        { displayName: "My Game.rbxlx", importNumber: 2, complete: false },
      ]);
      expect((await s.listAnalyses(1, first.nextCursor)).items).toMatchObject([
        { displayName: "place.rbxlx", importNumber: 1, complete: true },
      ]);
    } finally {
      await s.close();
    }
  }));

it("deletes a snapshot and releases its blob only after the last reference", async () =>
  withWorkspace(async (dir) => {
    const graph = await resolveFixture("shop/place.rbxlx");
    const store = await openStore(join(dir, "graph.db"));
    try {
      await store.save(graph);
      await store.save({ ...graph, analysisId: "other" });
      await store.publish(graph.analysisId);
      const blob = join(dir, "blobs", graph.snapshotId + ".rbxlx");
      await store.deleteAnalysis(graph.analysisId);
      expect(await store.current()).toBe("other");
      await expect(store.readGraph(graph.analysisId)).rejects.toMatchObject({
        code: "ANALYSIS_NOT_FOUND",
      });
      expect((await readFile(blob)).length).toBeGreaterThan(0);
      await store.deleteAnalysis("other");
      expect(await store.current()).toBeNull();
      expect((await store.listAnalyses(100)).items).toEqual([]);
      await expect(readFile(blob)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await store.close();
    }
  }));
