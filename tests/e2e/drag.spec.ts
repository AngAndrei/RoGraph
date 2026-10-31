import { test, expect } from "@playwright/test";
import { build } from "esbuild";
// Exercise the production component and real Sigma renderer, exposing it only
// inside this browser fixture so screen coordinates can be measured precisely.
test("dragging boundary nodes preserves the viewport; pan and wheel still work", async ({
  page,
}) => {
  const bundle = await build({
    stdin: {
      contents: `import React from 'react';import{createRoot}from'react-dom/client';import{GraphView}from'./apps/web/src/GraphView.tsx';createRoot(document.getElementById('root')).render(React.createElement(GraphView,{result:{analysisId:'drag',nodes:['left','right','top','bottom','center'].map(id=>({id,kind:'instance',label:id,contexts:['server'],attributes:{className:'Script'}})),relations:[],groups:[]},details:false,onSelect:()=>{}}));`,
      resolveDir: process.cwd(),
      loader: "tsx",
    },
    bundle: true,
    write: false,
    format: "esm",
    jsx: "automatic",
    plugins: [
      {
        name: "test-renderer-access",
        setup(b) {
          b.onResolve({ filter: /^sigma$/ }, (args) =>
            args.importer.endsWith("GraphView.tsx")
              ? { path: "renderer", namespace: "drag-test" }
              : undefined,
          );
          b.onLoad({ filter: /.*/, namespace: "drag-test" }, () => ({
            contents: `import Sigma from 'sigma';export default class extends Sigma{constructor(...args){super(...args);window.dragRenderer=this;}}`,
            resolveDir: process.cwd(),
          }));
        },
      },
    ],
  });
  await page.route("http://rograph.test/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    return route.fulfill({
      contentType:
        path.endsWith(".js") || path.endsWith(".ts")
          ? "application/javascript"
          : "text/html",
      body:
        path === "/fixture.js"
          ? bundle.outputFiles[0].text
          : path === "/layout.worker.ts"
            ? `onmessage=()=>postMessage([{id:'left',x:-100,y:0},{id:'right',x:100,y:0},{id:'top',x:0,y:100},{id:'bottom',x:0,y:-100},{id:'center',x:0,y:0}]);`
            : `<style>.sigma-container{width:1000px;height:700px}</style><div id="root"></div><script type="module" src="/fixture.js"></script>`,
    });
  });
  await page.goto("http://rograph.test/");
  await expect(page.locator(".sigma-container")).toHaveAttribute(
    "data-layout-ready",
    "true",
  );
  const screen = async (id: string) =>
    page.evaluate((id) => {
      const s = (window as any).dragRenderer;
      return s.graphToViewport(s.getGraph().getNodeAttributes(id));
    }, id);
  const camera = () =>
    page.evaluate(() => (window as any).dragRenderer.getCamera().getState());
  const rect = (await page.locator(".sigma-container").boundingBox())!;
  for (const [id, dx, dy] of [
    ["left", 60, 0],
    ["left", -100, 0],
    ["right", -60, 0],
    ["right", 100, 0],
    ["top", 0, 60],
    ["top", 0, -100],
    ["bottom", 0, -60],
    ["bottom", 0, 100],
  ] as [string, number, number][]) {
    const before = await screen(id),
      anchor = await screen("center"),
      state = await camera();
    await page.mouse.move(rect.x + before.x, rect.y + before.y);
    await page.mouse.down();
    // Sigma arms its drag on the first move; establish that at the press point.
    await page.mouse.move(rect.x + before.x, rect.y + before.y);
    await page.mouse.move(rect.x + before.x + dx, rect.y + before.y + dy, {
      steps: 10,
    });
    await page.mouse.up();
    await expect
      .poll(async () => {
        const p = await screen(id);
        return Math.hypot(p.x - before.x - dx, p.y - before.y - dy);
      })
      .toBeLessThan(2);
    const after = await screen("center");
    expect(Math.hypot(after.x - anchor.x, after.y - anchor.y)).toBeLessThan(
      0.5,
    );
    expect(await camera()).toEqual(state);
  }
  await page.getByRole("button", { name: "Fit graph", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() => (window as any).dragRenderer.getCustomBBox()),
    )
    .toBeNull();
  const beforePan = await camera();
  await page.mouse.move(rect.x + 25, rect.y + 25);
  await page.mouse.down();
  await page.mouse.move(rect.x + 80, rect.y + 65, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => (await camera()).x).not.toBe(beforePan.x);
  const beforeZoom = await camera();
  await page.mouse.wheel(0, -180);
  await expect
    .poll(async () => (await camera()).ratio)
    .toBeLessThan(beforeZoom.ratio);
});
