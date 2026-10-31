import { it, expect } from "vitest";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { openStore } from "../../packages/core/src/store.js";
import { withWorkspace } from "../support/workspace.js";
import { gameplayGraph, eggCode } from "./graph.js";
it("retains concrete gameplay endpoints and proof after reopening the store", async () =>
  withWorkspace(async (dir) => {
    const graph = await gameplayGraph(eggCode),
      path = join(dir, "graph.db");
    let store = await openStore(path);
    await store.save(graph);
    await store.close();
    store = await openStore(path);
    const reopened = await store.readGraph(graph.analysisId);
    expect(reopened.relations.filter((r) => r.gameplay)).toEqual(
      graph.relations.filter((r) => r.gameplay),
    );
    await store.close();
    const db = new DatabaseSync(path);
    try {
      expect(
        (db.prepare("PRAGMA user_version").get() as any).user_version,
      ).toBe(2);
    } finally {
      db.close();
    }
  }));
