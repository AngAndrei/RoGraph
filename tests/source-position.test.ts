import { join } from "node:path";
import { expect, it } from "vitest";
import { createQueryEngine } from "../packages/core/src/query.js";
import { openStore } from "../packages/core/src/store.js";
import { hash } from "../packages/core/src/util.js";
import { gameplayGraph } from "./gameplay/graph.js";
import { withWorkspace } from "./support/workspace.js";

it("keeps retained BOM bytes, parser ranges and source query columns consistent", async () =>
  withWorkspace(async (dir) => {
    const text = "\ufefflocal result = 1\n\ufeffreturn result\n";
    const graph = await gameplayGraph({ ByteOrderMark: text });
    const store = await openStore(join(dir, "graph.db"));
    try {
      await store.save(graph);
      expect(graph.coverage).toMatchObject({ partialImport: true, parsedScripts: 0 });
      const source = graph.sources[0];
      expect(source.text).toBe(text);
      expect(source.sha256).toBe(hash(text));
      const diagnostics = graph.diagnostics.filter((d) => d.code === "LUAU_PARSE_ERROR");
      expect(diagnostics).toHaveLength(2);
      expect(diagnostics[0].span).toMatchObject({
        startByte: 0,
        endByte: 3,
        startLine: 1,
        endLine: 1,
        startColumn: 1,
        endColumn: 2,
      });
      const engine = createQueryEngine(store);
      const query = { op: "source" as const, analysisId: graph.analysisId, sourceId: source.id };
      const prefix = (await engine.run({ ...query, startByte: 0, endByte: 3 })).sources[0];
      expect(prefix.sha256).toBe(source.sha256);
      expect(prefix.excerpts[0]).toEqual({ span: diagnostics[0].span, text: "\ufeff" });
      const found = (await engine.run({ ...query, text: "return" })).sources[0];
      const startByte = Buffer.byteLength(text.slice(0, text.indexOf("return")));
      expect(found.search?.match).toEqual({
        startByte,
        endByte: startByte + 6,
        startLine: 2,
        endLine: 2,
        startColumn: 2,
        endColumn: 8,
      });
    } finally {
      await store.close();
    }
  }));
