import { it, expect } from "vitest";
import { cp, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { analyze } from "../packages/core/src/pipeline.js";
import { openStore } from "../packages/core/src/store.js";
import { diffGraphs } from "../packages/core/src/diff.js";
import { fixturePath } from "./support/fixtures.js";
import { withWorkspace } from "./support/workspace.js";
import { resolveFixture } from "./support/resolve.js";
it("refreshes source-only Rojo edits and excludes a colocated analysis workspace", async () =>
  withWorkspace(async (dir) => {
    const project = join(dir, "project");
    await cp(dirname(fixturePath("rojo/default.project.json")), project, {
      recursive: true,
    });
    const workspace = join(project, "analysis-data"),
      store = await openStore(join(workspace, "graph.db")),
      input = {
        kind: "rojo" as const,
        projectPath: join(project, "default.project.json"),
      },
      options = {
        excludedRoots: [workspace],
        cacheDir: join(workspace, "cache"),
      };
    try {
      const before = await analyze(input, store, undefined, options),
        service = before.sources.find((s) =>
          s.origin.originalPath?.endsWith("PurchaseService.luau"),
        )!;
      const original = await readFile(service.origin.originalPath!, "utf8");
      await writeFile(
        service.origin.originalPath!,
        original.replace("Config.Prices.Sword", "Config.Prices.Shield"),
      );
      const after = await analyze(input, store, undefined, options);
      expect(after.analysisId).not.toBe(before.analysisId);
      expect(diffGraphs(before, after).addedRelationIds.length).toBeGreaterThan(
        0,
      );
      expect(
        (after.importManifest.inventory as any).rojo.files.every(
          (f: any) => !f.originalPath.includes("analysis-data"),
        ),
      ).toBe(true);
      const fresh = await analyze(input, store, undefined, options);
      expect(fresh.analysisId).toBe(after.analysisId);
      expect(fresh.relations).toEqual(after.relations);
    } finally {
      await store.close();
    }
  }));
it("does not force correspondence between duplicate sibling objects", async () => {
  const g = await resolveFixture("adversarial/duplicates.rbxlx"),
    copy = structuredClone(g);
  copy.analysisId = "new";
  const remap = new Map(copy.nodes.map((n) => [n.id, n.id + "new"]));
  for (const n of copy.nodes) {
    n.id = remap.get(n.id)!;
    if (n.ownerId) n.ownerId = remap.get(n.ownerId);
  }
  for (const r of copy.relations) {
    r.id += "new";
    r.source = remap.get(r.source)!;
    r.target = remap.get(r.target)!;
  }
  const diff = diffGraphs(g, copy);
  expect(diff.ambiguousMatches.length).toBeGreaterThan(0);
});
