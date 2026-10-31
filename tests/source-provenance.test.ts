import { it, expect } from "vitest";
import { join } from "node:path";
import { analyze } from "../packages/core/src/pipeline.js";
import { openStore } from "../packages/core/src/store.js";
import { createQueryEngine } from "../packages/core/src/query.js";
import { hash } from "../packages/core/src/util.js";
import { fixturePath } from "./support/fixtures.js";
import { withWorkspace } from "./support/workspace.js";
it("preserves original generated-config text without inventing statement mappings", async () =>
  withWorkspace(async (d) => {
    const s = await openStore(join(d, "g.db"));
    try {
      const g = await analyze(
        { kind: "rojo", projectPath: fixturePath("rojo/default.project.json") },
        s,
      );
      const source = g.sources.find((s) => s.origin.kind === "generated")!;
      expect(source).toBeDefined();
      const e = createQueryEngine(s),
        saved = await e.run({
          op: "source",
          analysisId: g.analysisId,
          sourceId: source.id,
        }),
        original = await e.run({
          op: "source",
          analysisId: g.analysisId,
          sourceId: source.id,
          original: true,
        });
      expect(saved.sources[0].sha256).toBe(source.sha256);
      expect(original.sources[0].variant).toBe("original");
      expect(original.sources[0].origin.mapping).toBe("unavailable");
      expect(original.sources[0].excerpts[0].text.trim().startsWith("{")).toBe(
        true,
      );
      expect(hash(original.sources[0].excerpts[0].text)).toBe(
        source.origin.originalSha256,
      );
    } finally {
      await s.close();
    }
  }));
