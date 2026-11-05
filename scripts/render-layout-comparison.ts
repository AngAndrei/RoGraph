import { build } from "esbuild";
import { chromium } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
const dir = resolve(process.argv[2] ?? "build/layout-comparison");
const report = JSON.parse(await readFile(join(dir, "metrics.json"), "utf8"));
const css = await readFile("apps/web/src/styles.css", "utf8");
const worker = await build({
  entryPoints: ["apps/web/src/layout.worker.ts"],
  bundle: true,
  write: false,
  format: "esm",
});
const bundle = await build({
  stdin: {
    contents: `import React from'react';import{createRoot}from'react-dom/client';import{GraphView}from'./apps/web/src/GraphView.tsx';
const root=createRoot(document.getElementById('root'));window.showGraph=(result,details,selectedId)=>root.render(React.createElement(GraphView,{result,details,selectedId,onSelect:id=>window.showGraph(result,details,id)}));`,
    resolveDir: process.cwd(),
    loader: "tsx",
  },
  bundle: true,
  write: false,
  format: "esm",
  jsx: "automatic",
  plugins: [
    {
      name: "observe",
      setup(b) {
        b.onResolve({ filter: /^sigma$/ }, (args) =>
          args.importer.endsWith("GraphView.tsx")
            ? { path: "observed", namespace: "comparison" }
            : undefined,
        );
        b.onLoad({ filter: /.*/, namespace: "comparison" }, () => ({
          contents: `import Sigma from'sigma';export default class extends Sigma{constructor(...args){super(...args);window.s=this;}}`,
          resolveDir: process.cwd(),
        }));
      },
    },
  ],
});
const browser = await chromium.launch({
  channel: "msedge",
  headless: true,
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const output: any[] = [];
try {
  for (const sample of report.results)
    for (const mode of ["original", "adaptive", "live"]) {
      if (mode === "live" && !sample.details) continue;
      const context = await browser.newContext({
        viewport: { width: 1200, height: 850 },
        deviceScaleFactor: 1,
        locale: "en-US",
        timezoneId: "Europe/Bucharest",
        reducedMotion: "reduce",
      });
      await context.addInitScript("window.__name = (fn) => fn;");
      const page = await context.newPage();
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      const fixed =
        mode === "live"
          ? null
          : JSON.parse(
              await readFile(
                join(dir, `${sample.sample}-${mode}-positions.json`),
                "utf8",
              ),
            );
      await page.route("http://rograph.test/**", (route) => {
        const p = new URL(route.request().url()).pathname;
        return route.fulfill({
          contentType:
            p === "/" ? "text/html; charset=utf-8" : "application/javascript",
          body:
            p === "/fixture.js"
              ? bundle.outputFiles[0].text
              : p === "/layout.worker.ts"
                ? worker.outputFiles[0].text +
                  `\nconst frozen=${JSON.stringify(fixed)},compute=self.onmessage;self.onmessage=e=>{if(frozen&&e.data.nodes.length===frozen.length){postMessage({requestId:e.data.requestId,positions:frozen,engine:'replay',milliseconds:0,warnings:[]});}else compute(e);};`
                : `<meta charset="utf-8"><style>${css}#root{width:1000px;height:700px;margin:15px auto}.graph-area{height:700px;min-height:700px}h2{margin:18px auto;width:1000px}</style><h2>${sample.sample} · ${mode}</h2><div id="root"></div><script type="module" src="/fixture.js"></script>`,
        });
      });
      await page.goto("http://rograph.test/");
      const query = JSON.parse(
        await readFile(join(dir, `${sample.sample}.json`), "utf8"),
      );
      const started = performance.now();
      await page.evaluate(
        ({ query, details }) => (window as any).showGraph(query, details),
        { query, details: sample.details },
      );
      await page
        .locator('.sigma-container[data-layout-ready="true"]')
        .waitFor({ timeout: 60000 });
      const readyMilliseconds = performance.now() - started;
      await page.evaluate(async () => {
        await document.fonts.ready;
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        );
      });
      const measure = () =>
        page.evaluate(() => {
          const s = (window as any).s,
            g = s.getGraph(),
            rect = s.getContainer().getBoundingClientRect();
          const points = g.nodes().map((id: string) => {
            const d = s.getNodeDisplayData(id);
            return {
              id,
              ...s.graphToViewport(g.getNodeAttributes(id)),
              radius: s.scaleSize(d.size),
              data: d,
            };
          });
          const map = new Map(points.map((p: any) => [p.id, p]));
          const ctx = document.createElement("canvas").getContext("2d")!;
          const boxes = [...s.getNodeDisplayedLabels()].map((id: any) => {
            const p: any = map.get(id),
              d = p.data;
            ctx.font = `${d.labelSize}px ${d.labelFont}`;
            const m = ctx.measureText(d.label ?? "");
            return {
              id,
              x: p.x + p.radius + 3,
              y: p.y - d.labelSize / 2,
              width: m.width,
              height: d.labelSize,
            };
          });
          const overlaps = (a: any, b: any) =>
            a.x < b.x + b.width &&
            b.x < a.x + a.width &&
            a.y < b.y + b.height &&
            b.y < a.y + a.height;
          let nodeOverlaps = 0,
            labelOverlaps = 0,
            edgeNodeIntersections = 0;
          for (let i = 0; i < points.length; i++)
            for (let j = i + 1; j < points.length; j++) {
              const a = points[i],
                b = points[j];
              if (Math.hypot(a.x - b.x, a.y - b.y) < a.radius + b.radius)
                nodeOverlaps++;
            }
          for (let i = 0; i < boxes.length; i++)
            for (let j = i + 1; j < boxes.length; j++)
              if (overlaps(boxes[i], boxes[j])) labelOverlaps++;
          for (const edge of g.edges()) {
            const a: any = map.get(g.source(edge)),
              b: any = map.get(g.target(edge)),
              dx = b.x - a.x,
              dy = b.y - a.y;
            for (const p of points) {
              if (p === a || p === b) continue;
              const t = Math.max(
                0,
                Math.min(
                  1,
                  ((p.x - a.x) * dx + (p.y - a.y) * dy) /
                    (dx * dx + dy * dy || 1),
                ),
              );
              if (Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy) < p.radius)
                edgeNodeIntersections++;
            }
          }
          return {
            nodes: g.order,
            connections: g.size,
            nodeOverlaps,
            labelOverlaps,
            edgeNodeIntersections,
            labels: boxes.length,
            clippedLabels: boxes.filter(
              (b) =>
                b.x < 0 ||
                b.y < 0 ||
                b.x + b.width > rect.width ||
                b.y + b.height > rect.height,
            ).length,
            minimumRadius: Math.min(...points.map((p: any) => p.radius)),
            camera: s.getCamera().getState(),
          };
        });
      output.push({
        sample: sample.sample,
        mode,
        placementReplay: mode !== "live",
        readyMilliseconds,
        ...(await measure()),
        errors,
      });
      await page.screenshot({
        path: join(dir, `${sample.sample}-${mode}.png`),
      });
      if (mode === "live") {
        const hub = await page.evaluate(() => {
          const g = (window as any).s.getGraph();
          return g
            .nodes()
            .sort((a: string, b: string) => g.degree(b) - g.degree(a))[0];
        });
        await page.evaluate(
          ({ query, details, hub }) =>
            (window as any).showGraph(query, details, hub),
          { query, details: sample.details, hub },
        );
        await page
          .getByRole("button", { name: "Focus selected neighborhood" })
          .click();
        await page
          .locator('.sigma-container[data-layout-ready="true"]')
          .waitFor({ timeout: 60000 });
        await page.screenshot({
          path: join(dir, `${sample.sample}-focus.png`),
        });
      }
      await context.close();
    }
} finally {
  await browser.close();
}
await writeFile(
  join(dir, "screen-metrics.json"),
  JSON.stringify(
    {
      browser: browser.version(),
      viewport: { width: 1000, height: 700 },
      dpr: 1,
      labelBounds:
        "font-measured right-hand rectangles; rendered label ID set from Sigma",
      results: output,
    },
    null,
    2,
  ),
);
console.log(JSON.stringify(output));
