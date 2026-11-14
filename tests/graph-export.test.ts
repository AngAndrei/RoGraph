import { it, expect } from "vitest";
import { join } from "node:path";
import { startServer } from "../apps/local/src/server.js";
import { openStore } from "../packages/core/src/store.js";
import { resolveFixture } from "./support/resolve.js";
import { withWorkspace } from "./support/workspace.js";
it("exports the complete pinned graph with all retained facts and requires a same-origin session", async () =>
  withWorkspace(async (dir) => {
    const graph = await resolveFixture("shop/place.rbxlx");
    const store = await openStore(join(dir, "graph.db"));
    await store.save(graph);
    const expected = await store.readGraph(graph.analysisId);
    const other = await resolveFixture("adversarial/dynamic.rbxlx");
    await store.save(other);
    await store.close();
    const app = await startServer({ workspacePath: dir });
    try {
      const headers = {
        "X-RoGraph-Session": app.sessionToken,
        Origin: app.url,
        "Content-Type": "application/json",
      };
      const request = (body: unknown, extraHeaders = headers) =>
        fetch(app.url + "/api/export/graph", {
          method: "POST",
          headers: extraHeaders,
          body: JSON.stringify(body),
        });
      const response = await request({ analysisId: graph.analysisId });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(expected);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(
        (
          await request(
            { analysisId: graph.analysisId },
            { ...headers, "X-RoGraph-Session": "" },
          )
        ).status,
      ).toBe(403);
      expect(
        (
          await request(
            { analysisId: graph.analysisId },
            { ...headers, Origin: "https://other.example" },
          )
        ).status,
      ).toBe(403);
      expect((await request({})).status).toBe(400);
      expect(
        (await request({ analysisId: graph.analysisId, limit: 1 })).status,
      ).toBe(400);
      expect((await request({ analysisId: "missing-snapshot" })).status).toBe(
        404,
      );
    } finally {
      await app.close();
    }
  }));
