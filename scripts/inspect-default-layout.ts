import { chromium } from "@playwright/test";
import { startServer } from "../apps/local/src/server.js";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { validPositions } from "../apps/web/src/layout-protocol.js";
import { projectGraph } from "../apps/web/src/graph-projection.js";
import { uniqueLinks } from "../apps/web/src/layout-quality.js";
const out = resolve(process.argv[2] ?? "build/default-layout-review/final");
const allowBaseline = process.argv.includes("--baseline");
const [width, height] = (process.argv[3] ?? "1600x1000").split("x").map(Number);
if (!width || !height || width < 600 || height < 500)
  throw new Error("Expected viewport WIDTHxHEIGHT, at least 600x500");
await mkdir(out, { recursive: true });
const app = await startServer({ workspacePath: join(out, "workspace") });
const browser = await chromium.launch({
  channel: "msedge",
  headless: true,
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const page = await browser.newPage({
  viewport: { width, height },
  reducedMotion: "reduce",
});
await page.addInitScript(() => {
  const Original = window.Worker;
  (window as any).layoutRuns = [];
  window.Worker = class extends Original {
    postMessage(message: any, options?: any) {
      if (message.nodes) (window as any).layoutRuns.push({ request: message });
      return super.postMessage(message, options);
    }
    constructor(url: any, options?: any) {
      super(url, options);
      this.addEventListener("message", (event) => {
        const run = (window as any).layoutRuns.findLast(
          (r: any) => r.request.requestId === event.data.requestId,
        );
        if (run) run.response = event.data;
      });
    }
  };
});
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
const results: any[] = [];
try {
  await page.goto(app.url + "/#session=" + app.sessionToken);
  for (const name of [
    "SaveHer.rbxl",
    "Grow_a_Chicken.rbxl",
    "BanglaBattlegrounds_20240706_01.rbxl",
  ]) {
    console.log("Importing " + name);
    const importButton = page.getByRole("button", {
      name: "＋ Import project",
      exact: true,
    });
    if (await importButton.count()) await importButton.click();
    await page
      .getByLabel("Place file")
      .last()
      .setInputFiles(resolve("../Rbxl_files_for_Test", name));
    const pending = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/query") &&
        response.request().postDataJSON()?.op === "overview" &&
        response.request().postDataJSON()?.view === "gameplay",
      { timeout: 240000 },
    );
    const started = Date.now();
    await page
      .getByRole("button", { name: "Analyze", exact: true })
      .last()
      .click();
    const query = await (await pending).json();
    await page
      .locator(
        `.sigma-container[data-analysis-id="${query.analysisId}"][data-layout-ready="true"]`,
      )
      .waitFor({ timeout: 60000 });
    await page.evaluate(async () => {
      await document.fonts.ready;
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
    });
    const run = await page.evaluate(() => (window as any).layoutRuns.at(-1));
    const projected = projectGraph(query, false);
    const expected = projected.nodes.map((n) => n.id).sort();
    if (
      (!allowBaseline && !run?.request.initialOverview) ||
      !validPositions(run?.response.positions, expected) ||
      JSON.stringify(run.request.nodes.toSorted()) !==
        JSON.stringify(expected) ||
      JSON.stringify(uniqueLinks(new Set(expected), run.request.edges)) !==
        JSON.stringify(uniqueLinks(new Set(expected), projected.edges))
    )
      throw new Error("Initial overview did not return complete coordinates");
    const sample = name.replace(/\.rbxl$/, "");
    await writeFile(
      join(out, sample + "-gameplay.json"),
      JSON.stringify(query),
    );
    await writeFile(join(out, sample + "-layout.json"), JSON.stringify(run));
    await page.screenshot({ path: join(out, sample + ".png") });
    results.push({
      sample,
      viewport: { width, height },
      nodes: run?.request.nodes.length,
      edges: run?.request.edges.length,
      groups: run?.request.groups?.map((g: any) => g.length),
      engine: run?.response.engine,
      milliseconds: run?.response.milliseconds,
      importMilliseconds: Date.now() - started,
      truncated: query.meta?.truncated,
      omittedCounts: query.meta?.omittedCounts,
    });
    console.log(JSON.stringify(results.at(-1)));
  }
  await writeFile(
    join(out, "imports.json"),
    JSON.stringify({ results, errors }, null, 2),
  );
  if (errors.length) throw new Error(errors.join("\n"));
} finally {
  await browser.close();
  await app.close();
}
