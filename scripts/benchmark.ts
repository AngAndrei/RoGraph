import { mkdir, writeFile, stat, readFile } from "node:fs/promises";
import { join, resolve, relative } from "node:path";
import { cpus, totalmem, release } from "node:os";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { performance } from "node:perf_hooks";
import { chromium } from "@playwright/test";
import { analyze } from "../packages/core/src/pipeline.js";
import { openWorkerStore } from "../packages/core/src/worker-client.js";
import { startServer } from "../apps/local/src/server.js";
import { hash } from "../packages/core/src/util.js";
import { toolPath } from "../packages/adapters/src/native.js";
const flags = Object.fromEntries(
    process.argv
      .slice(2)
      .reduce<
        string[][]
      >((a, v, i, all) => (i % 2 === 0 ? [...a, [v, all[i + 1]]] : a), []),
  ),
  profile = flags["--profile"] ?? "smoke",
  output = resolve(flags["--output"] ?? "build/benchmark.json"),
  runs = Number(flags["--runs"] ?? (profile === "release" ? 3 : 1));
if (
  !["smoke", "release"].includes(profile) ||
  !Number.isInteger(runs) ||
  runs < 1 ||
  runs > 5
)
  throw Error("Invalid benchmark options");
const objects = profile === "release" ? 50000 : 2000,
  scripts = profile === "release" ? 1000 : 30,
  lines = 100,
  owned = resolve("build", "bench-" + randomUUID());
await mkdir(owned, { recursive: true });
const item = (cls: string, id: string, name: string, body = "") =>
  `<Item class="${cls}" referent="${id}"><Properties><string name="Name">${name}</string>${body}</Properties></Item>`;
const moduleSource = [
  "return { Price = 100 }",
  ...Array.from({ length: lines - 1 }, () => "-- configuration"),
].join("\n");
let serverScripts = "";
for (let i = 0; i < scripts - 1; i++) {
  const code = [
    `-- script ${i}`,
    'local Config = require(game:GetService("ReplicatedStorage").Config)',
    ...Array.from(
      { length: lines - 2 },
      (_, j) => `local v${j} = Config.Price`,
    ),
  ].join("\n");
  serverScripts += item(
    "Script",
    "s" + i,
    "Script" + String(i).padStart(4, "0"),
    `<ProtectedString name="Source"><![CDATA[${code}]]></ProtectedString>`,
  );
}
const geometry = Array.from({ length: objects - scripts - 3 }, (_, i) =>
  item("Part", "p" + i, "Part" + i),
).join("");
const xml = `<roblox version="4"><Item class="ReplicatedStorage" referent="rs"><Properties><string name="Name">ReplicatedStorage</string></Properties>${item("ModuleScript", "cfg", "Config", `<ProtectedString name="Source"><![CDATA[${moduleSource}]]></ProtectedString>`)}</Item><Item class="ServerScriptService" referent="ss"><Properties><string name="Name">ServerScriptService</string></Properties>${serverScripts}</Item><Item class="Workspace" referent="w"><Properties><string name="Name">Workspace</string></Properties>${geometry}</Item></roblox>`;
const place = join(owned, "synthetic.rbxlx");
await writeFile(place, xml);
const stopFile = join(owned, "memory.stop"),
  memoryPath = join(owned, "memory.json");
const monitor = spawn(
  "pwsh.exe",
  [
    "-NoProfile",
    "-File",
    resolve("scripts/measure-memory.ps1"),
    "-RootPid",
    String(process.pid),
    "-StopFile",
    stopFile,
    "-OutputPath",
    memoryPath,
  ],
  { windowsHide: true, stdio: "ignore" },
);
let monitorFailure = "";
monitor.on("error", (e) => {
  monitorFailure = e.message;
});
const monitorExited = once(monitor, "exit").catch(() => []);
const report: any = {
  profile,
  runs,
  createdAt: new Date().toISOString(),
  hardware: {
    cpu: cpus()[0]?.model,
    logicalProcessors: cpus().length,
    ramBytes: totalmem(),
    os: release(),
    arch: process.arch,
    node: process.version,
  },
  input: {
    objects,
    scripts,
    sourceLines: scripts * lines,
    utf8Bytes: (await stat(place)).size,
    sha256: hash(xml),
    description:
      "Synthetic place: unique script texts, repeated exact config reads, minimal geometry properties; source never executes.",
  },
  cold: [],
  queries: {},
  overview: {},
  memory: {},
  artifacts: {
    pins: JSON.parse(await readFile("tools/versions.lock.json", "utf8")),
    importerSha256: hash(await readFile(toolPath("rbx-import"))),
    parserSha256: hash(await readFile(toolPath("luau-parser"))),
    cliSha256: hash(await readFile("dist/cli.js")),
    workerSha256: hash(await readFile("dist/worker.js")),
  },
  workspace: relative(process.cwd(), owned),
};
let workspace = "",
  analysisId = "",
  priceId = "";
const times = (values: number[]) => ({
  medianMs: [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)],
  maxMs: Math.max(...values),
  samplesMs: values,
});
try {
  for (let run = 0; run < runs; run++) {
    workspace = join(owned, "run-" + run);
    const store = await openWorkerStore(join(workspace, "graph.db")),
      stages: Record<string, number> = {},
      start = performance.now();
    let previousStage = "",
      misses = 0,
      hits = 0;
    try {
      const graph = await analyze(
        { kind: "place", path: place },
        store,
        undefined,
        {
          cacheDir: join(workspace, "cache"),
          onParse: (hit) => (hit ? hits++ : misses++),
          onProgress: (p) => {
            if (p.stage !== previousStage) {
              stages[p.stage] = performance.now() - start;
              previousStage = p.stage;
            }
            if (p.stage !== "parse" || p.completed % 100 === 0)
              process.stderr.write(JSON.stringify({ run, ...p }) + "\n");
          },
        },
      );
      analysisId = graph.analysisId;
      priceId = graph.nodes.find((n) => n.label === "Config.Price")!.id;
      report.cold.push({
        durationMs: performance.now() - start,
        stages,
        parserMisses: misses,
        parserHits: hits,
        nodes: graph.nodes.length,
        relations: graph.relations.length,
        evidence: graph.evidence.length,
        codeOccurrences: graph.evidence.filter(
          (e) => e.sourceId && e.rule !== "source-declaration",
        ).length,
        coverage: graph.coverage,
      });
    } finally {
      await store.close();
    }
  }
  const store = await openWorkerStore(join(workspace, "graph.db"));
  try {
    for (const q of [
      { name: "search", op: "search" as const, text: "Script000" },
      { name: "impact", op: "impact" as const, nodeId: priceId, depth: 3 },
      { name: "overview", op: "overview" as const, limit: 300 },
    ]) {
      const values: number[] = [];
      for (let i = 0; i < 7; i++) {
        const start = performance.now();
        const r = await store.query({ ...q, analysisId });
        values.push(performance.now() - start);
        if (i === 0)
          report.queries[q.name + "Result"] = {
            nodes: r.nodes.length,
            evidence: r.evidence.length,
            truncated: r.meta.truncated,
            omittedCounts: r.meta.omittedCounts,
          };
      }
      report.queries[q.name] = times(values);
    }
  } finally {
    await store.close();
  }
  const app = await startServer({ workspacePath: workspace }),
    browser = await chromium.launch({
      channel: "msedge",
      headless: true,
      args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
    });
  try {
    const page = await browser.newPage({
        viewport: { width: 1440, height: 960 },
      }),
      start = performance.now(),
      requests: any[] = [];
    page.on("request", (r) => {
      if (r.url().endsWith("/api/query")) requests.push(r.postDataJSON());
    });
    await page.goto(app.url + "/#session=" + app.sessionToken);
    await page
      .getByRole("heading", { name: "Coverage", exact: true })
      .waitFor({ timeout: 30000 });
    await page.locator(".sigma-container canvas").first().waitFor();
    await page.waitForFunction(
      () =>
        document
          .querySelector(".sigma-container")
          ?.getAttribute("data-layout-ready") === "true",
      {},
      { timeout: 30000 },
    );
    report.overview.firstRenderedMs = performance.now() - start;
    report.overview.initialQueries = requests.map((q) => ({
      op: q.op,
      limit: q.limit,
    }));
    await page.getByLabel("Search project").fill("Script0000");
    await page
      .getByRole("button", { name: "Script0000", exact: true })
      .first()
      .click();
    await page
      .getByRole("heading", { name: "Relationships", exact: false })
      .waitFor();
    report.overview.neighborhoodQueries = requests
      .filter((q) => q.op === "inspect")
      .map((q) => ({ op: q.op, limit: q.limit }));
    await page.screenshot({ path: join(owned, "large-explorer.png") });
  } finally {
    await browser.close();
    await app.close();
  }
} catch (error) {
  report.error = { message: (error as Error).message };
  process.exitCode = 1;
} finally {
  await writeFile(stopFile, "stop");
  await monitorExited;
  try {
    report.memory = JSON.parse(
      (await readFile(memoryPath, "utf8")).replace(/^\uFEFF/, ""),
    );
  } catch {
    report.memory = { error: monitorFailure || "Memory sampler unavailable" };
  }
  report.nodeHighWaterKiB = process.resourceUsage().maxRSS;
  report.coldSummary = report.cold.length
    ? times(report.cold.map((r: any) => r.durationMs))
    : {};
  report.targets = {
    coldUnder60s:
      report.cold.every((r: any) => r.durationMs < 60000) &&
      report.cold.length === runs,
    warmQueriesUnder500ms: ["search", "impact", "overview"].every(
      (k) => report.queries[k]?.medianMs < 500,
    ),
    firstOverviewUnder3s: report.overview.firstRenderedMs < 3000,
    sampledAggregateUnder2GB: report.memory.peakAggregateBytes < 2 * 1024 ** 3,
  };
  await mkdir(resolve(output, ".."), { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2));
  process.stdout.write(
    JSON.stringify({
      output,
      cold: report.coldSummary,
      queries: report.queries,
      overview: report.overview,
      memory: report.memory.peakAggregateBytes,
      targets: report.targets,
      error: report.error,
    }) + "\n",
  );
}
