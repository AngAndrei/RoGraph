/** Assemble private first-import screenshots and metrics into a local review page. */
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { measureLayout, uniqueLinks } from "../apps/web/src/layout-quality.js";
const root = resolve(process.argv[2] ?? "build/default-layout-review");
const samples = [
  "SaveHer",
  "Grow_a_Chicken",
  "BanglaBattlegrounds_20240706_01",
];
const results = [];
for (const sample of samples) {
  const baseline = JSON.parse(
    await readFile(join(root, "before", sample + "-layout.json"), "utf8"),
  );
  const selected = JSON.parse(
    await readFile(join(root, "final", sample + "-layout.json"), "utf8"),
  );
  const nodes = (run: typeof baseline) =>
    JSON.stringify([...run.request.nodes].sort());
  const links = (run: typeof baseline) =>
    JSON.stringify(uniqueLinks(new Set(run.request.nodes), run.request.edges));
  const directions = (run: typeof baseline) =>
    JSON.stringify(
      run.request.edges
        .map((e: { source: string; target: string }) =>
          [e.source, e.target].join("\0"),
        )
        .sort(),
    );
  if (
    nodes(baseline) !== nodes(selected) ||
    links(baseline) !== links(selected) ||
    directions(baseline) !== directions(selected)
  )
    throw new Error("Projected topology changed: " + sample);
  results.push({
    sample,
    nodes: selected.request.nodes.length,
    connections: selected.request.edges.length,
    baseline: measureLayout(
      baseline.response.positions,
      baseline.request.edges,
    ),
    selected: measureLayout(
      selected.response.positions,
      selected.request.edges,
    ),
    workerMilliseconds: selected.response.milliseconds,
    engine: selected.response.engine,
  });
}
await writeFile(
  join(root, "summary.json"),
  JSON.stringify(
    { results, invariant: "Identical projected node and unique edge sets" },
    null,
    2,
  ),
);
await writeFile(
  join(root, "index.html"),
  `<!doctype html><meta charset="utf-8"><title>RoGraph default graph layout review</title>
<style>body{font:16px system-ui;color:#21344c;background:#f4f7fb;margin:28px}h1{font-size:25px}select{font:inherit;padding:8px}table{border-collapse:collapse;margin:20px 0}td,th{padding:10px 18px;border-bottom:1px solid #ccd8e4;text-align:left}.pair{display:grid;grid-template-columns:1fr 1fr;gap:18px}.pair img{width:100%;border:1px solid #ccd8e4;background:white}h2{font-size:18px}a{color:#215fac}@media(max-width:1000px){.pair{grid-template-columns:1fr}}</style>
<h1>RoGraph: first-import graph layout review</h1><p>Same nodes and connections. Click a screenshot to inspect it at full size. This branch is awaiting your approval.</p>
<table><tr><th>Game</th><th>Nodes / lines</th><th>Crossings before → after</th><th>Edges near unrelated nodes before → after</th></tr>${results.map((r) => `<tr><td>${r.sample}</td><td>${r.nodes} / ${r.connections}</td><td>${r.baseline.crossings} → ${r.selected.crossings}</td><td>${r.baseline.obstructions} → ${r.selected.obstructions}</td></tr>`).join("")}</table>
<p>The proximity metric uses 22 layout units. Grow a Chicken and Bangla Battlegrounds are partial static analyses; this compares their visible graphs.</p>
<label>Game <select id="game">${samples.map((s) => `<option>${s}</option>`).join("")}</select></label>
<div class="pair"><section><h2>Main: current default</h2><a id="beforeLink"><img id="before" alt="Original first-import graph"></a></section><section><h2>Experimental branch: selected layout</h2><a id="afterLink"><img id="after" alt="Improved first-import graph"></a></section></div>
<p><a id="narrow">Inspect the narrower window screenshot</a></p>
<script>const g=document.getElementById('game');function show(){const s=encodeURIComponent(g.value);for(const [id,dir]of [['before','before'],['after','final']]){const path=dir+'/'+s+'.png';document.getElementById(id).src=path;document.getElementById(id+'Link').href=path;}document.getElementById('narrow').href='narrow/'+s+'.png';}g.onchange=show;show();</script>`,
);
console.log(JSON.stringify(results));
