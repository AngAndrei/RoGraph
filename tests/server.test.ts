import { it, expect } from "vitest";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { withWorkspace } from "./support/workspace.js";
import { fixturePath } from "./support/fixtures.js";
import { startServer } from "../apps/local/src/server.js";
it("requires a local session and authenticates jobs and pinned queries", async () =>
  withWorkspace(async (dir) => {
    const app = await startServer({ workspacePath: dir });
    try {
      const headers = {
        "X-RoGraph-Session": app.sessionToken,
        Origin: app.url,
      };
      expect((await fetch(app.url + "/api/workspace")).status).toBe(403);
      expect(
        (
          await fetch(app.url + "/api/workspace", {
            headers: { ...headers, Origin: "https://evil.example" },
          })
        ).status,
      ).toBe(403);
      const response = await fetch(app.url + "/api/imports", {
        method: "POST",
        headers: {
          ...headers,
          "Content-Type": "application/octet-stream",
          "X-RoGraph-Filename": "shop.rbxlx",
        },
        body: await readFile(fixturePath("shop/place.rbxlx")),
      });
      expect(response.status).toBe(202);
      let job = (await response.json()) as any;
      for (
        let i = 0;
        i < 100 &&
        !["complete", "failed", "partial", "canceled"].includes(job.status);
        i++
      ) {
        await new Promise((r) => setTimeout(r, 100));
        job = await (
          await fetch(app.url + "/api/jobs/" + job.id, { headers })
        ).json();
      }
      expect(job.status).toBe("complete");
      const r = await fetch(app.url + "/api/query", {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          op: "search",
          analysisId: job.analysisId,
          text: "Sword",
        }),
      });
      expect(
        ((await r.json()) as any).nodes.some(
          (n: any) => n.label === "ShopConfig.Prices.Sword",
        ),
      ).toBe(true);
      expect(
        (
          await fetch(app.url + "/api/query", {
            method: "POST",
            headers: {
              "X-RoGraph-Session": app.sessionToken,
              "Content-Type": "application/json",
            },
            body: "{}",
          })
        ).status,
      ).toBe(403);
      expect(
        (await fetch(app.url + "/api/sql", { method: "POST", headers })).status,
      ).toBe(404);
    } finally {
      await app.close();
    }
  }));
