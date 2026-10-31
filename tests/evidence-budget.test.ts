import { it, expect } from "vitest";
import { join } from "node:path";
import { writeFile } from "node:fs/promises";
import { analyze } from "../packages/core/src/pipeline.js";
import { openStore } from "../packages/core/src/store.js";
import { createQueryEngine } from "../packages/core/src/query.js";
import { withWorkspace } from "./support/workspace.js";
it("keeps diverse readers within the occurrence budget and pages the remaining evidence", async () =>
  withWorkspace(async (d) => {
    const code =
        'local Config=require(game:GetService("ReplicatedStorage").Config)\n',
      script = (name: string, text: string) =>
        `<Item class="Script" referent="${name}"><Properties><string name="Name">${name}</string><ProtectedString name="Source"><![CDATA[${text}]]></ProtectedString></Properties></Item>`;
    const path = join(d, "many.rbxlx");
    await writeFile(
      path,
      `<roblox version="4"><Item class="ReplicatedStorage" referent="r"><Properties><string name="Name">ReplicatedStorage</string></Properties><Item class="ModuleScript" referent="c"><Properties><string name="Name">Config</string><ProtectedString name="Source">return {Price=1}</ProtectedString></Properties></Item></Item>${script("Bulk", code + "print(Config.Price)\n".repeat(6000))}${script("Rare", code + "print(Config.Price)")}</roblox>`,
    );
    const store = await openStore(join(d, "g.db"));
    try {
      const g = await analyze({ kind: "place", path }, store, undefined, {
          cacheDir: join(d, "cache"),
        }),
        e = createQueryEngine(store),
        price = g.nodes.find((n) => n.label === "Config.Price")!,
        r = await e.run({
          op: "impact",
          analysisId: g.analysisId,
          nodeId: price.id,
        });
      expect(r.nodes.some((n) => n.label === "Rare")).toBe(true);
      expect(r.evidence.length).toBeLessThanOrEqual(5000);
      const bulk = g.nodes.find((n) => n.label === "Bulk")!,
        q = {
          op: "inspect" as const,
          analysisId: g.analysisId,
          nodeId: bulk.id,
          limit: 300,
        },
        first = await e.run(q);
      expect(first.meta.nextCursor).toBeTruthy();
      const second = await e.run({ ...q, cursor: first.meta.nextCursor });
      expect(second.evidence.length).toBeGreaterThan(0);
      expect(
        second.evidence.every(
          (ev) => !first.evidence.some((a) => a.id === ev.id),
        ),
      ).toBe(true);
    } finally {
      await store.close();
    }
  }));
