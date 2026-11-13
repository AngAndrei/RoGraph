import { it, expect } from "vitest";
import { compactContext } from "../apps/web/src/chat-context.js";
import { createContext } from "../packages/core/src/context.js";
import { openStore } from "../packages/core/src/store.js";
import { createQueryEngine } from "../packages/core/src/query.js";
import { resolveFixture } from "./support/resolve.js";
import { withWorkspace } from "./support/workspace.js";
import { join } from "node:path";

it("exports one canonical representation with provenance and explicit limits", async () => withWorkspace(async (dir) => {
  const graph = await resolveFixture("shop/place.rbxlx");
  const store = await openStore(join(dir, "graph.db"));
  try {
    await store.save(graph);
    const node = graph.nodes.find((n) => n.label === "ShopClient.BuySword")!;
    const result = await createQueryEngine(store).run({ op: "inspect", analysisId: graph.analysisId, nodeId: node.id, view: "code" });
    const compact = compactContext(createContext(result, { estimatedTokenBudget: 4000 }));
    expect(compact.data.analysisId).toBe(graph.analysisId);
    expect(compact.data.coverage).toEqual(result.coverage);
    expect(compact).not.toHaveProperty("markdown");
    expect(compact.utf8Bytes).toBe(Buffer.byteLength(JSON.stringify(compact)));
    expect(compact.utf8Bytes).toBeLessThanOrEqual(32000);
    for (const e of compact.data.evidence) if (e.sourceId) expect(compact.data.sources.find((s) => s.id === e.sourceId)?.sha256).toBeTruthy();
    const source = graph.sources[0];
    const sourceResult = await createQueryEngine(store).run({ op: "source", analysisId: graph.analysisId, sourceId: source.id });
    const sourcePack = compactContext(createContext(sourceResult, { estimatedTokenBudget: 4000 }));
    expect(sourcePack.data.sources[0]?.sha256).toBe(source.sha256);
    expect(sourcePack.data.sources[0]?.excerpts[0]?.text.length).toBeGreaterThan(0);
  } finally { await store.close(); }
}));
