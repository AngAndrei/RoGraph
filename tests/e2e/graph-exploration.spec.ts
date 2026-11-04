import { test, expect, type Page } from "@playwright/test";
import { build } from "esbuild";
import { readFile } from "node:fs/promises";

async function setupGraph(page: Page, mode = "normal") {
  const bundle = await build({
    stdin: {
      contents: `import React from'react';import{createRoot}from'react-dom/client';import{GraphView}from'./apps/web/src/GraphView.tsx';
  const root=createRoot(document.getElementById('root'));let selected='a';let extra=false;
  window.showGraph=(id=selected,more=extra)=>{selected=id;extra=more;root.render(React.createElement(GraphView,{selectedId:selected,
    result:{analysisId:'exploration',nodes:['a','b','c','d',...(extra?['extra']:[])].map(id=>({id,kind:'instance',label:'Part',ownerId:'parent-'+id,contexts:['server'],attributes:{className:'Script'}})),
    relations:[{id:'ab',source:'a',target:'b',type:'REFERENCES'},{id:'ba',source:'b',target:'a',type:'MODIFIES'},{id:'bc',source:'b',target:'c',type:'REFERENCES'}],groups:[]},
    details:true,onSelect:id=>window.showGraph(id),onEdge:(...args)=>window.clicked=args}));};window.showGraph();`,
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
              ? { path: "observed", namespace: "test" }
              : undefined,
          );
          b.onLoad({ filter: /.*/, namespace: "test" }, () => ({
            contents: `import Sigma from'sigma';export default class extends Sigma{constructor(...args){super(...args);window.s=this;}}`,
            resolveDir: process.cwd(),
          }));
        },
      },
    ],
  });
  const css = await readFile("apps/web/src/styles.css", "utf8");
  await page.addInitScript((failureMode) => {
    const NativeWorker = Worker;
    (window as any).workerCount = 0;
    (window as any).workerAttempts = 0;
    (window as any).Worker = class extends NativeWorker {
      constructor(...args: any[]) {
        (window as any).workerAttempts++;
        if (failureMode === "fail-once" && (window as any).workerAttempts === 1)
          throw new Error("Transient worker failure");
        if (failureMode === "constructor-error")
          throw new Error("Blocked layout worker");
        super(args[0], args[1]);
        (window as any).workerCount++;
      }
      postMessage(message: any) {
        if (failureMode === "post-message-error")
          throw new Error("Cannot clone request");
        (window as any).lastLayoutRequest = message;
        super.postMessage(message);
      }
    };
  }, mode);
  await page.route("http://rograph.test/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    return route.fulfill({
      contentType: path === "/" ? "text/html" : "application/javascript",
      body:
        path === "/fixture.js"
          ? bundle.outputFiles[0].text
          : path === "/layout.worker.ts"
            ? `onmessage=e=>{const r=e.data,p=r.nodes.map((id,i)=>({id,x:i*150,y:(i%2)*100}));
        if(${JSON.stringify(mode)}==='error') throw new Error('fixture failure');
        const response={requestId:r.requestId,positions:${JSON.stringify(mode)}==='malformed'?p.slice(1):p,engine:'test',milliseconds:1,warnings:[]};
        if(${JSON.stringify(mode)}==='stale'){postMessage({...response,requestId:'old'});setTimeout(()=>postMessage(response),100);}else postMessage(response);};`
            : `<style>${css}#root{height:700px;width:1000px}.graph-area{height:700px}</style><div id="root"></div><script type="module" src="/fixture.js"></script>`,
    });
  });
  await page.goto("http://rograph.test/");
}

test("focus and direction preserve selection, evidence and cached arrangements", async ({
  page,
}) => {
  await setupGraph(page);
  const ready = () =>
    expect(page.locator(".sigma-container")).toHaveAttribute(
      "data-layout-ready",
      "true",
    );
  await ready();
  await page
    .getByRole("button", { name: "Focus selected neighborhood" })
    .click();
  await ready();
  await expect
    .poll(() => page.evaluate(() => (window as any).s.getGraph().order))
    .toBe(2);
  await expect(page.getByText(/2 nodes hidden/)).toBeVisible();
  await page.getByLabel("Layout style").selectOption("directional");
  await ready();
  expect(
    await page.evaluate(() => (window as any).lastLayoutRequest.edges),
  ).toEqual(
    expect.arrayContaining([
      { source: "a", target: "b" },
      { source: "b", target: "a" },
    ]),
  );
  await page.getByRole("button", { name: "Show whole graph" }).click();
  await ready();
  expect(await page.evaluate(() => (window as any).s.getGraph().order)).toBe(4);
  const before = await page.evaluate(() => (window as any).workerCount);
  await page.evaluate(() => (window as any).showGraph("c"));
  await ready();
  expect(await page.evaluate(() => (window as any).workerCount)).toBe(before);
  expect(
    await page.evaluate(
      () => (window as any).s.getNodeDisplayData("c").highlighted,
    ),
  ).toBe(true);
  await page.evaluate(() => (window as any).showGraph("c", true));
  await ready();
  expect(await page.evaluate(() => (window as any).s.getGraph().order)).toBe(5);
  expect(
    await page.evaluate(() => (window as any).workerCount),
  ).toBeGreaterThan(before);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => {
    document.getElementById("root")!.style.width = "100%";
  });
  await expect(
    page.getByRole("button", { name: "Focus selected neighborhood" }),
  ).toBeVisible();
  await page.screenshot({ path: "build/previews/readability-mobile.png" });
});

for (const mode of [
  "error",
  "malformed",
  "constructor-error",
  "post-message-error",
])
  test(`recovers from ${mode} worker output without losing graph access`, async ({
    page,
  }) => {
    await setupGraph(page, mode);
    await expect(page.locator(".sigma-container")).toHaveAttribute(
      "data-layout-ready",
      "true",
    );
    await expect(
      page.getByText(/Layout optimization unavailable/),
    ).toBeVisible();
    await expect(page.getByRole("status")).toHaveCount(0);
    expect(await page.evaluate(() => (window as any).s.getGraph().order)).toBe(
      4,
    );
  });

test("ignores a stale worker result and waits for the active request", async ({
  page,
}) => {
  await setupGraph(page, "stale");
  await expect(page.locator(".sigma-container")).toHaveAttribute(
    "data-layout-ready",
    "true",
  );
  expect(
    await page.evaluate(() =>
      (window as any).s.getGraph().getNodeAttribute("d", "x"),
    ),
  ).toBe(450);
});

test("retries an optimized view after a transient failure rather than caching the fallback", async ({
  page,
}) => {
  await setupGraph(page, "fail-once");
  const ready = () =>
    expect(page.locator(".sigma-container")).toHaveAttribute(
      "data-layout-ready",
      "true",
    );
  await ready();
  await expect(page.getByText(/Layout optimization unavailable/)).toBeVisible();
  await page
    .getByRole("button", { name: "Focus selected neighborhood" })
    .click();
  await ready();
  await page.getByRole("button", { name: "Show whole graph" }).click();
  await ready();
  expect(await page.evaluate(() => (window as any).workerCount)).toBe(2);
  await expect(page.getByText(/Layout optimization unavailable/)).toHaveCount(
    0,
  );
});
