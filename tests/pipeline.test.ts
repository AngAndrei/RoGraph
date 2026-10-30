import { it, expect } from "vitest";
import { join } from "node:path";
import { openStore } from "../packages/core/src/store.js";
import { analyze } from "../packages/core/src/pipeline.js";
import { createParseCache } from "../packages/core/src/cache.js";
import { fixturePath } from "./support/fixtures.js";
import { withWorkspace } from "./support/workspace.js";
import { hash } from "../packages/core/src/util.js";
it("reuses unchanged syntax without changing the graph and retains current on cancellation", async () =>
  withWorkspace(async (d) => {
    const s = await openStore(join(d, "g.db")),
      stats = { hits: 0, misses: 0 },
      options = {
        cacheDir: join(d, "cache"),
        onParse: (hit: boolean) => (hit ? stats.hits++ : stats.misses++),
      };
    try {
      const input = {
        kind: "place" as const,
        path: fixturePath("shop/place.rbxlx"),
      };
      const a = await analyze(input, s, undefined, options);
      expect(stats.misses).toBe(4);
      stats.misses = 0;
      const b = await analyze(input, s, undefined, options);
      expect(b.analysisId).toBe(a.analysisId);
      expect(b.evidence).toEqual(a.evidence);
      expect(stats.misses).toBe(0);
      expect(stats.hits).toBe(4);
      const c = new AbortController();
      await expect(
        analyze(input, s, c.signal, {
          ...options,
          onProgress: (p) => {
            if (p.stage === "resolve") c.abort();
          },
        }),
      ).rejects.toBeDefined();
      expect(await s.current()).toBe(a.analysisId);
    } finally {
      await s.close();
    }
  }));
it("rebinds identical source syntax to distinct owners and invalidates parser identity", async () =>
  withWorkspace(async (d) => {
    let misses = 0;
    const text = "local function f() return 1 end\nf()",
      make = (id: string) => ({
        id: id + ":source",
        scriptId: id,
        text,
        sha256: hash(text),
        origin: { kind: "place" as const },
      });
    const c = createParseCache(d, {
      onParse: (hit) => {
        if (!hit) misses++;
      },
    });
    const a = await c.parseCached(make("first")),
      b = await c.parseCached(make("second"));
    expect(a.scriptId).toBe("first");
    expect(b.scriptId).toBe("second");
    expect(misses).toBe(1);
    await createParseCache(d, {
      parserIdentity: "different-binary",
      onParse: (hit) => {
        if (!hit) misses++;
      },
    }).parseCached(make("third"));
    expect(misses).toBe(2);
  }));
