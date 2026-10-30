import { it, expect } from "vitest";
import { join } from "node:path";
import { resolveFixture } from "./support/resolve.js";
import { withWorkspace } from "./support/workspace.js";
import { openStore } from "../packages/core/src/store.js";
import { createQueryEngine } from "../packages/core/src/query.js";
async function setup(
  run: (
    engine: ReturnType<typeof createQueryEngine>,
    g: Awaited<ReturnType<typeof resolveFixture>>,
  ) => Promise<void>,
) {
  await withWorkspace(async (d) => {
    const g = await resolveFixture("shop/place.rbxlx"),
      s = await openStore(join(d, "g.db"));
    try {
      await s.save(g);
      await s.publish(g.analysisId);
      await run(createQueryEngine(s), g);
    } finally {
      await s.close();
    }
  });
}
it("traces the potential remote path with four evidence-backed hops", async () =>
  setup(async (e, g) => {
    const id = (s: string) => g.nodes.find((n) => n.label === s)!.id;
    const r = await e.run({
      op: "trace",
      analysisId: g.analysisId,
      fromId: id("ShopClient.BuySword"),
      toId: id("ShopConfig.Prices.Sword"),
      depth: 6,
    });
    expect(r.paths[0]).toHaveLength(4);
    expect(
      r.paths[0].some((h) => h.transition === "potential-communication"),
    ).toBe(true);
    for (const h of r.paths[0])
      expect(r.evidence.some((ev) => ev.relationId === h.relationId)).toBe(
        true,
      );
    const impact = await e.run({
      op: "impact",
      analysisId: g.analysisId,
      nodeId: id("ShopConfig.Prices.Sword"),
      depth: 6,
    });
    expect(impact.nodes.map((n) => n.label)).toEqual(
      expect.arrayContaining([
        "PurchaseService.TryPurchase",
        "ShopServer.onPurchase",
        "ShopClient.BuySword",
      ]),
    );
    expect(
      impact.paths.some((p) =>
        p.some((h) => h.transition === "potential-impact"),
      ),
    ).toBe(true);
  }));
it("bounds traversal, filters pagination and source excerpts to the pinned analysis", async () =>
  setup(async (e, g) => {
    const q = {
      op: "search" as const,
      analysisId: g.analysisId,
      text: "Shop",
      limit: 1,
    };
    const a = await e.run(q);
    expect(a.meta.truncated).toBe(true);
    const b = await e.run({ ...q, cursor: a.meta.nextCursor });
    expect(b.nodes[0].id).not.toBe(a.nodes[0].id);
    await expect(
      e.run({ ...q, text: "Sword", cursor: a.meta.nextCursor }),
    ).rejects.toMatchObject({ code: "INVALID_CURSOR" });
    const tree = await e.run({
      op: "tree",
      analysisId: g.analysisId,
      parentId: null,
    });
    expect(tree.nodes[0].label).toBe("DataModel");
    const price = g.nodes.find((n) => n.label === "ShopConfig.Prices.Sword")!;
    const impact = await e.run({
      op: "impact",
      analysisId: g.analysisId,
      nodeId: price.id,
      depth: 1,
      limit: 2,
    });
    expect(impact.nodes.length).toBeLessThanOrEqual(2);
    expect(
      impact.relations.every((r) => !["CONTAINS", "DECLARES"].includes(r.type)),
    ).toBe(true);
    const filtered = await e.run({
      op: "search",
      analysisId: g.analysisId,
      text: "Shop",
      classes: ["LocalScript"],
    });
    expect(
      filtered.nodes.every(
        (n) =>
          n.attributes.className === "LocalScript" ||
          n.attributes.scriptClassName === "LocalScript",
      ),
    ).toBe(true);
    const source = await e.run({
      op: "source",
      analysisId: g.analysisId,
      sourceId: g.sources[0].id,
      startByte: 0,
      endByte: 10,
    });
    expect(source.sources[0].omittedBytes).toBeGreaterThan(0);
    expect(source.sources[0].sha256).toBe(g.sources[0].sha256);
    expect(source.sources[0].text).toBeUndefined();
  }));
