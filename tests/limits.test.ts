import { it, expect } from "vitest";
import { join } from "node:path";
import { writeFile } from "node:fs/promises";
import { defaultLimits } from "../packages/core/src/limits.js";
import { parseSource } from "../packages/adapters/src/native.js";
import { hash } from "../packages/core/src/util.js";
import { analyze } from "../packages/core/src/pipeline.js";
import { openStore } from "../packages/core/src/store.js";
import { createQueryEngine } from "../packages/core/src/query.js";
import { withWorkspace } from "./support/workspace.js";
it("keeps native multichunk Unicode strings byte-faithful", async () => {
  const value = "é😀".repeat(20000),
    text = 'return "' + value + '"',
    p = await parseSource({
      id: "unicode-source",
      scriptId: "unicode-script",
      text,
      sha256: hash(text),
      origin: { kind: "place" },
    });
  expect(hash(p.ast.body[0].list[0].value)).toBe(hash(value));
});
it("enforces published defaults and bounds a real cyclic caller hub", async () =>
  withWorkspace(async (d) => {
    expect(defaultLimits).toMatchObject({
      queryDepth: 3,
      maxDepth: 6,
      maxNodes: 1000,
      maxEvidence: 5000,
      maxPaths: 5,
      overviewNodes: 300,
      estimatedTokenBudget: 2000,
      maxContextBytes: 32000,
      inputBytes: 536870912,
      instances: 200000,
      scriptBytes: 16777216,
      totalSourceBytes: 268435456,
      xmlDepth: 256,
      cancelBatchRecords: 1000,
    });
    const code =
        "local function Hub() Hub() end\n" +
        Array.from(
          { length: 1050 },
          (_, i) => `local function f${i}() Hub() end`,
        ).join("\n"),
      path = join(d, "hub.rbxlx");
    await writeFile(
      path,
      `<roblox version="4"><Item class="Script" referent="s"><Properties><string name="Name">HubScript</string><ProtectedString name="Source"><![CDATA[${code}]]></ProtectedString></Properties></Item></roblox>`,
    );
    const store = await openStore(join(d, "graph.db"));
    try {
      const g = await analyze({ kind: "place", path }, store, undefined, {
          cacheDir: join(d, "cache"),
        }),
        hub = g.nodes.find((n) => n.label === "HubScript.Hub")!;
      const r = await createQueryEngine(store).run({
        op: "impact",
        analysisId: g.analysisId,
        nodeId: hub.id,
        depth: 100,
      });
      expect(r.nodes.length).toBeLessThanOrEqual(1000);
      expect(r.evidence.length).toBeLessThanOrEqual(5000);
      expect(r.meta.truncated).toBe(true);
      expect(r.meta.limits.depth).toBe(6);
      expect(Object.values(r.meta.omittedCounts).some((v) => v > 0)).toBe(true);
    } finally {
      await store.close();
    }
  }));
