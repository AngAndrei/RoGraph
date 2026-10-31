import { it, expect } from "vitest";
import { join } from "node:path";
import { shopCase } from "./support/cases.js";
import { withWorkspace } from "./support/workspace.js";
import { resolveInstances } from "../packages/core/src/resolve-instances.js";
import { resolveCalls } from "../packages/core/src/resolve-calls.js";
import { resolveConfig } from "../packages/core/src/resolve-config.js";
import { resolveEvents } from "../packages/core/src/resolve-events.js";
import { assembleGraph } from "../packages/core/src/assemble.js";
import { openStore } from "../packages/core/src/store.js";
import { createQueryEngine } from "../packages/core/src/query.js";
import { createContext } from "../packages/core/src/context.js";
async function setup(
  run: (
    engine: ReturnType<typeof createQueryEngine>,
    graph: ReturnType<typeof assembleGraph>,
  ) => Promise<void>,
  diagnostics = false,
) {
  await withWorkspace(async (d) => {
    const c = await shopCase(
        "ShopServer",
        "local function Broken() unknownCall() end",
      ),
      i = resolveInstances(c.snapshot, c.facts),
      calls = resolveCalls(c.snapshot, c.facts, i),
      graph = assembleGraph(c.snapshot, c.facts, [
        i,
        calls,
        resolveConfig(c.snapshot, c.facts, i, calls),
        resolveEvents(c.snapshot, c.facts, i, calls),
      ]);
    if (diagnostics)
      graph.diagnostics = Array.from({ length: 101 }, (_, n) => ({
        code: "TEST_" + n,
        severity: "warning",
        message: "Diagnostic " + n,
        ownerId: c.facts[0].scriptId,
      }));
    const store = await openStore(join(d, "g.db"));
    try {
      await store.save(graph);
      await run(createQueryEngine(store), graph);
    } finally {
      await store.close();
    }
  });
}
it("retains selected-scope uncertainty and source hashes when trace has no path", async () =>
  setup(async (e, g) => {
    const start = g.nodes.find((n) => n.label === "ShopServer.Broken")!,
      target = g.nodes.find((n) => n.label === "ShopConfig.Prices.Sword")!;
    const r = await e.run({
      op: "trace",
      analysisId: g.analysisId,
      fromId: start.id,
      toId: target.id,
    });
    expect(r.paths).toHaveLength(0);
    expect(
      r.sites.some((s) => s.ownerId === start.id && s.status === "unresolved"),
    ).toBe(true);
    expect(
      r.sources.some((s) => s.scriptId === start.ownerId && s.sha256),
    ).toBe(true);
    expect(
      createContext(r, { estimatedTokenBudget: 2000 }).json.sites.some(
        (s) => s.ownerId === start.id,
      ),
    ).toBe(true);
  }));
it("rejects missing and stale IDs independently of filters", async () =>
  setup(async (e, g) => {
    const start = g.nodes.find((n) => n.label === "ShopServer.Broken")!;
    await expect(
      e.run({ op: "inspect", analysisId: g.analysisId }),
    ).rejects.toMatchObject({ code: "INVALID_QUERY" });
    await expect(
      e.run({ op: "inspect", analysisId: g.analysisId, nodeId: "missing" }),
    ).rejects.toMatchObject({ code: "NODE_NOT_FOUND" });
    await expect(
      e.run({
        op: "trace",
        analysisId: g.analysisId,
        fromId: start.id,
        toId: "missing",
        classes: ["Part"],
      }),
    ).rejects.toMatchObject({ code: "NODE_NOT_FOUND" });
    await expect(
      e.run({
        op: "inspect",
        analysisId: g.analysisId,
        nodeId: start.id,
        classes: ["Part"],
      }),
    ).resolves.toBeDefined();
  }));
it("discloses and pages all retained diagnostics", async () =>
  setup(async (e, g) => {
    const coverage = await e.run({ op: "coverage", analysisId: g.analysisId });
    expect(coverage.diagnostics).toHaveLength(100);
    expect(coverage.meta.truncated).toBe(true);
    expect(coverage.meta.omittedCounts.diagnostics).toBe(1);
    const first = await e.run({
      op: "diagnostics" as any,
      analysisId: g.analysisId,
      limit: 100,
    });
    expect(first.meta.nextCursor).toBeDefined();
    const second = await e.run({
      op: "diagnostics" as any,
      analysisId: g.analysisId,
      limit: 100,
      cursor: first.meta.nextCursor,
    });
    expect(second.diagnostics).toHaveLength(1);
    expect(second.diagnostics[0].code).toBe("TEST_100");
    expect(second.meta.truncated).toBe(false);
  }, true));
