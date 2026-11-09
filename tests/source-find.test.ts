import { it, expect } from "vitest";
import { join } from "node:path";
import { gameplayGraph } from "./gameplay/graph.js";
import { openStore } from "../packages/core/src/store.js";
import { createQueryEngine } from "../packages/core/src/query.js";
import { hash } from "../packages/core/src/util.js";
import { withWorkspace } from "./support/workspace.js";
import { findSourceMatch } from "../packages/core/src/source-find.js";

it("keeps ASCII fast-path and Unicode matching offsets consistent", () => {
  expect(findSourceMatch("a".repeat(5000), "aaaaaaa", 100)).toMatchObject({
    total: 714,
    index: 100,
    range: { startByte: 700, endByte: 707 },
  });
  expect(findSourceMatch("ſ S s K K k 🐕", "s", 0)).toMatchObject({
    total: 3,
    index: 0,
    range: { startByte: 0, endByte: 2 },
  });
  expect(findSourceMatch("ſ S s K K k 🐕", "k", -1)).toMatchObject({
    total: 3,
    index: 2,
  });
  expect(findSourceMatch("abc", "", 0)).toMatchObject({ total: 0, index: 0 });
});

it("finds literal matches in the complete source with wrapped navigation and bounded UTF-8 excerpts", async () =>
  withWorkspace(async (dir) => {
    const text =
      '-- 🐕\nprint("Needle")\n' +
      "-- padding\n".repeat(4000) +
      'print("needle")\nprint("NEEDLE")\nprint("a.b")';
    const g = await gameplayGraph({ Combat: text }),
      source = g.sources[0];
    source.origin.originalText = "original needle needle";
    source.origin.originalSha256 = hash(source.origin.originalText);
    const store = await openStore(join(dir, "graph.db"));
    try {
      await store.save(g);
      const engine = createQueryEngine(store);
      const q = {
        op: "source" as const,
        analysisId: g.analysisId,
        sourceId: source.id,
        text: "needle",
      };
      const result = await engine.run({ ...q, matchIndex: 1 } as any);
      const view = result.sources[0];
      expect(view.search).toMatchObject({ term: "needle", total: 3, index: 1 });
      expect(view.search!.match!.startByte).toBe(
        Buffer.byteLength(text.slice(0, text.indexOf('print("needle")') + 7)),
      );
      expect(view.excerpts[0].span.startByte).toBeGreaterThan(8000);
      expect(Buffer.byteLength(view.excerpts[0].text)).toBeLessThanOrEqual(
        32000,
      );
      expect(
        (await engine.run({ ...q, matchIndex: -1 } as any)).sources[0].search
          ?.index,
      ).toBe(2);
      expect(
        (await engine.run({ ...q, matchIndex: 3 } as any)).sources[0].search
          ?.index,
      ).toBe(0);
      expect(
        (await engine.run({ ...q, text: "a.b" })).sources[0].search?.total,
      ).toBe(1);
      expect(
        (await engine.run({ ...q, text: "absent" })).sources[0].search,
      ).toMatchObject({ total: 0, index: 0 });
      expect(
        (await engine.run({ ...q, original: true })).sources[0].search?.total,
      ).toBe(2);
    } finally {
      await store.close();
    }
  }));
