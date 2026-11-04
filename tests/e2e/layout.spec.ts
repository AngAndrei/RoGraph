import { test, expect } from "@playwright/test";
import { build } from "esbuild";

test("arranges hubs and leaves compactly with one inspectable line per pair", async ({
  page,
}) => {
  const pairs = [
    ["Animate", "Humanoid"],
    ["Humanoid", "NPCBehavior"],
    ["NPCBehavior", "Modon"],
    ["Modon", "Animate"],
    ...["Right Hip", "Right Shoulder", "PlayEmote", "Animation"].map((id) => [
      "Animate",
      id,
    ]),
    ...Array.from({ length: 7 }, (_, i) => ["NPCBehavior", "Part " + i]),
    ["Modon", "Health"],
  ];
  const result = {
    analysisId: "layout",
    nodes: [...new Set(pairs.flat())].map((id) => ({
      id,
      kind: "instance",
      label: id,
      contexts: ["server"],
      attributes: {
        className:
          id === "Animate"
            ? "LocalScript"
            : ["Health", "NPCBehavior"].includes(id)
              ? "Script"
              : "Part",
      },
    })),
    relations: pairs.map(([source, target], i) => ({
      id: "e" + i,
      source,
      target,
      type: "REFERENCES",
      label: "uses",
    })),
    groups: [],
  };
  const bundle = await build({
    stdin: {
      contents: `import React from'react';import{createRoot}from'react-dom/client';import{GraphView}from'./apps/web/src/GraphView.tsx';const root=createRoot(document.getElementById('root'));window.showGraph=result=>root.render(React.createElement(GraphView,{result,details:true,onSelect:()=>{},onEdge:(...args)=>window.clickedConnection=args}));window.showGraph(${JSON.stringify(result)});`,
      resolveDir: process.cwd(),
      loader: "tsx",
    },
    bundle: true,
    write: false,
    format: "esm",
    jsx: "automatic",
    plugins: [
      {
        name: "test-renderer",
        setup(b) {
          b.onResolve({ filter: /^sigma$/ }, (args) =>
            args.importer.endsWith("GraphView.tsx")
              ? { path: "renderer", namespace: "layout-test" }
              : undefined,
          );
          b.onLoad({ filter: /.*/, namespace: "layout-test" }, () => ({
            contents: `import Sigma from'sigma';export default class extends Sigma{constructor(...args){super(...args);window.layoutRenderer=this}}`,
            resolveDir: process.cwd(),
          }));
        },
      },
    ],
  });
  const worker = await build({
    entryPoints: ["apps/web/src/layout.worker.ts"],
    bundle: true,
    write: false,
    format: "esm",
  });
  await page.route("http://rograph.test/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    return route.fulfill({
      contentType: path === "/" ? "text/html" : "application/javascript",
      body:
        path === "/fixture.js"
          ? bundle.outputFiles[0].text
          : path === "/layout.worker.ts"
            ? worker.outputFiles[0].text
            : `<style>body{font-family:Segoe UI;color:#435069;background:#f8fbff}.sigma-container{width:1000px;height:700px}details,button,select{display:none}</style><h2>Connected hubs, bridges and outward leaves</h2><div id="root"></div><script type="module" src="/fixture.js"></script>`,
    });
  });
  await page.goto("http://rograph.test/");
  await expect(page.locator(".sigma-container")).toHaveAttribute(
    "data-layout-ready",
    "true",
  );
  const positions = await page.evaluate(() => {
    const s = (window as any).layoutRenderer;
    return s
      .getGraph()
      .nodes()
      .map((id: string) => ({
        id,
        ...s.graphToViewport(s.getGraph().getNodeAttributes(id)),
      }));
  });
  for (let i = 0; i < positions.length; i++)
    for (let j = i + 1; j < positions.length; j++)
      expect(
        Math.hypot(
          positions[i].x - positions[j].x,
          positions[i].y - positions[j].y,
        ),
      ).toBeGreaterThan(22);
  await page.screenshot({ path: "build/previews/topology-layout.png" });
  // Distinct actions and reverse directions share one actual rendered line.
  const bundled = {
    ...result,
    relations: [
      ...result.relations,
      { ...result.relations[0], id: "parallel", type: "MODIFIES" },
      {
        ...result.relations[0],
        id: "reverse",
        source: "Humanoid",
        target: "Animate",
        type: "TRIGGERS",
      },
    ],
  };
  await page.evaluate((r) => (window as any).showGraph(r), bundled);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as any).layoutRenderer
            .getGraph()
            .getEdgeAttribute("e0", "relationIds").length,
      ),
    )
    .toBe(3);
  await expect(page.locator(".sigma-container")).toHaveAttribute(
    "data-layout-ready",
    "true",
  );
  const connection = await page.evaluate(() => {
    const s = (window as any).layoutRenderer,
      g = s.getGraph(),
      a = s.graphToViewport(g.getNodeAttributes("Animate")),
      b = s.graphToViewport(g.getNodeAttributes("Humanoid"));
    return {
      edges: g.size,
      attributes: g.getEdgeAttributes("e0"),
      x: (a.x + b.x) / 2,
      y: (a.y + b.y) / 2,
    };
  });
  expect(connection.edges).toBe(16);
  expect(connection.attributes.tail).toBe("arrow");
  expect(connection.attributes.label).toBe("3 relationships");
  const box = (await page.locator(".sigma-container").boundingBox())!;
  await page.mouse.click(box.x + connection.x, box.y + connection.y);
  await expect
    .poll(() => page.evaluate(() => (window as any).clickedConnection?.[1]))
    .toEqual(["e0", "parallel", "reverse"]);
  await page.screenshot({ path: "build/previews/compact-connections.png" });
  const densePairs = Array.from({ length: 40 }, (_, i) => [
    [`h${i}`, `h${(i + 1) % 40}`],
    ...Array.from({ length: 5 }, (_, j) => [`h${i}`, `l${i}-${j}`]),
  ]).flat();
  const dense = {
    ...result,
    analysisId: "dense",
    nodes: [...new Set(densePairs.flat())].map((id) => ({
      ...result.nodes[0],
      id,
      label: id,
    })),
    relations: densePairs.map(([source, target], i) => ({
      ...result.relations[0],
      id: "d" + i,
      source,
      target,
    })),
  };
  await page.evaluate((r) => (window as any).showGraph(r), dense);
  await expect(page.locator(".sigma-container")).toHaveAttribute(
    "data-analysis-id",
    "dense",
  );
  await expect(page.locator(".sigma-container")).toHaveAttribute(
    "data-layout-ready",
    "true",
  );
  const separated = () =>
    page.evaluate(() => {
      const s = (window as any).layoutRenderer;
      if (s.getGraph().order !== 240) return false;
      const nodes = s
        .getGraph()
        .nodes()
        .map((id: string) => ({
          ...s.graphToViewport(s.getGraph().getNodeAttributes(id)),
          radius: s.scaleSize(s.getNodeDisplayData(id).size),
        }));
      return nodes.every((a: any, i: number) =>
        nodes
          .slice(i + 1)
          .every(
            (b: any) =>
              Math.hypot(a.x - b.x, a.y - b.y) > a.radius + b.radius + 0.5,
          ),
      );
    });
  await expect.poll(separated).toBe(true);
  const before = await page.evaluate(
    () => (window as any).layoutRenderer.getNodeDisplayData("h0").size,
  );
  await page.evaluate(() =>
    (window as any).layoutRenderer.getCamera().setState({ ratio: 0.5 }),
  );
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as any).layoutRenderer.getNodeDisplayData("h0").size,
      ),
    )
    .toBeGreaterThan(before);
  await expect.poll(separated).toBe(true);
  await page.evaluate(() =>
    (window as any).layoutRenderer.getCamera().setState({ ratio: 0.4 }),
  );
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  await expect.poll(separated).toBe(true);
  await page.locator(".sigma-container").evaluate((el) => {
    (el as HTMLElement).style.width = "600px";
    (el as HTMLElement).style.height = "400px";
  });
  await page.setViewportSize({ width: 800, height: 600 });
  await expect
    .poll(() =>
      page.evaluate(() => (window as any).layoutRenderer.getDimensions().width),
    )
    .toBe(600);
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  await expect.poll(separated).toBe(true);
});
