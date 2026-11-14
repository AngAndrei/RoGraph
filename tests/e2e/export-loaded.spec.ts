import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { startServer } from "../../apps/local/src/server.js";
import { openStore } from "../../packages/core/src/store.js";
import { resolveFixture } from "../support/resolve.js";
import { withWorkspace } from "../support/workspace.js";

test("exports an already loaded snapshot above floating chat", async ({
  page,
}) =>
  withWorkspace(async (workspace) => {
    // Import timing has separate coverage; this scenario starts from retained saved evidence.
    const graph = await resolveFixture("shop/place.rbxlx");
    const store = await openStore(join(workspace, "graph.db"));
    try {
      await store.save(graph);
      await store.publish(graph.analysisId);
    } finally {
      await store.close();
    }
    const app = await startServer({ workspacePath: workspace });
    try {
      await page.goto(app.url + "/#session=" + app.sessionToken);
      await expect(
        page.getByRole("heading", { name: "Coverage", exact: true }),
      ).toBeVisible();
      await page.getByRole("button", { name: "Code", exact: true }).click();
      await expect(
        page.getByRole("button", { name: "Export for AI", exact: true }),
      ).toBeVisible();
      await page.getByLabel("Traversal depth").selectOption("4");
      await page.getByLabel("Object classes").fill("ModuleScript");
      let assistantBox: { x: number; y: number } | null = null;
      const launcher = page.getByRole("button", {
        name: "Open RoGraph assistant",
      });
      if (await launcher.count()) {
        await launcher.click();
        assistantBox = await page
          .getByRole("dialog", { name: "RoGraph assistant", exact: true })
          .boundingBox();
      }
      await page
        .getByRole("button", { name: "Export for AI", exact: true })
        .click();
      const dialog = page.getByRole("dialog", { name: "Export agent context" });
      await expect(dialog).toBeVisible();
      if (assistantBox)
        expect(
          await page.evaluate(
            ({ x, y }) =>
              Boolean(
                document
                  .elementFromPoint(x + 8, y + 8)
                  ?.closest(".modal-backdrop"),
              ),
            assistantBox,
          ),
        ).toBe(true);
      await expect(dialog.getByLabel("Export scope")).toHaveValue("overview");
      await dialog.getByLabel("Context token budget").selectOption("4000");
      const jsonReady = page.waitForEvent("download");
      await dialog
        .getByRole("button", { name: "Download JSON", exact: true })
        .click();
      const jsonDownload = await jsonReady;
      const jsonText = await readFile((await jsonDownload.path())!, "utf8");
      const compact = JSON.parse(jsonText);
      expect(compact.format).toBe("rograph-context");
      expect(compact.scope).toEqual({
        op: "overview",
        analysisId: compact.data.analysisId,
        view: "code",
        limit: 300,
      });
      expect(compact).not.toHaveProperty("markdown");
      expect(compact.data.coverage.parsedScripts).toBeGreaterThan(0);
      expect(compact.data.meta.limits.estimatedTokenBudget).toBe(4000);
      expect(compact.utf8Bytes).toBe(Buffer.byteLength(jsonText));
      expect(compact.utf8Bytes).toBeLessThanOrEqual(32000);
      expect(compact.estimatedTokens).toBe(Math.ceil(jsonText.length / 4));
      await dialog.getByLabel("Export scope").selectOption("current");
      await expect(dialog.locator(".export-query")).toContainText('"depth": 4');
      await expect(
        dialog.getByRole("button", { name: "Download Markdown" }),
      ).toBeVisible();
      const markdownReady = page.waitForEvent("download");
      await dialog
        .getByRole("button", { name: "Download Markdown", exact: true })
        .click();
      const markdownDownload = await markdownReady;
      const markdown = await readFile((await markdownDownload.path())!, "utf8");
      expect(markdown).toContain('"classes":["ModuleScript"]');
      expect(markdown).toContain(compact.data.analysisId);
      expect(markdown).toContain("untrusted project data");
      expect(markdown).toContain("Bounds and omissions");
      await dialog
        .getByText("Full snapshot graph (larger file)", { exact: true })
        .click();
      const fullReady = page.waitForEvent("download");
      await dialog
        .getByRole("button", { name: "Download full graph JSON", exact: true })
        .click();
      const fullDownload = await fullReady;
      expect(fullDownload.suggestedFilename()).toContain("-full-graph.json");
      const full = JSON.parse(
        await readFile((await fullDownload.path())!, "utf8"),
      );
      const expectedResponse = await page.request.post(
        app.url + "/api/export/graph",
        {
          headers: { "X-RoGraph-Session": app.sessionToken, Origin: app.url },
          data: { analysisId: compact.data.analysisId },
        },
      );
      expect(expectedResponse.ok()).toBe(true);
      expect(full).toEqual(await expectedResponse.json());
      expect(full.nodes.length).toBeGreaterThan(compact.data.nodes.length);
      expect(full.sources.some((source: any) => source.sha256)).toBe(true);
      await page.screenshot({ path: "build/previews/export-for-ai.png" });
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
    } finally {
      await app.close();
    }
  }));
