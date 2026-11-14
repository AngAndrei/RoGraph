import { test, expect } from "./support.js";
import { readFile } from "node:fs/promises";
import { fixturePath } from "../support/fixtures.js";

test("exports scoped AI context and the complete saved graph without chat", async ({
  page,
  app,
}) => {
  await page.goto(app.url + "/#session=" + app.sessionToken);
  await expect(
    page.getByRole("button", { name: "Export for AI", exact: true }),
  ).toHaveCount(0);
  await page
    .getByLabel("Place file")
    .setInputFiles(fixturePath("shop/place.rbxlx"));
  await page.getByRole("button", { name: "Analyze", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Coverage", exact: true }),
  ).toBeVisible({ timeout: 90000 });
  await page.getByRole("button", { name: "Code", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Export for AI", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Traversal depth").selectOption("4");
  await page.getByLabel("Object classes").fill("ModuleScript");
  await page
    .getByRole("button", { name: "Export for AI", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Export agent context" });
  await expect(dialog).toBeVisible();
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
  const full = JSON.parse(await readFile((await fullDownload.path())!, "utf8"));
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
});
