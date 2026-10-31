import { it, expect } from "vitest";
import { join } from "node:path";
import { resolveFixture } from "./support/resolve.js";
import { withWorkspace } from "./support/workspace.js";
import { openStore } from "../packages/core/src/store.js";
import { createQueryEngine } from "../packages/core/src/query.js";
it("filters evidence without removing its saved source owners or neutral channels", async () =>
  withWorkspace(async (d) => {
    const store = await openStore(join(d, "g.db"));
    try {
      const g = await resolveFixture("adversarial/dynamic.rbxlx");
      await store.save(g);
      const e = createQueryEngine(store),
        unknown = await e.run({
          op: "overview",
          analysisId: g.analysisId,
          statuses: ["unresolved"],
        });
      expect(unknown.relations.length).toBeGreaterThan(0);
      expect(unknown.evidence.every((e) => e.status === "unresolved")).toBe(
        true,
      );
      expect(unknown.nodes.some((n) => n.kind === "unresolved")).toBe(true);
      const client = await e.run({
        op: "overview",
        analysisId: g.analysisId,
        contexts: ["client"],
      });
      expect(client.relations.some((r) => r.type === "SENDS_VIA")).toBe(true);
      expect(
        client.nodes.some((n) => n.attributes.className === "RemoteEvent"),
      ).toBe(true);
    } finally {
      await store.close();
    }
  }));
