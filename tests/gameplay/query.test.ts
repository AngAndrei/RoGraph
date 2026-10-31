import { it, expect } from "vitest";
import { join } from "node:path";
import { gameplayGraph, eggCode } from "./graph.js";
import { withWorkspace } from "../support/workspace.js";
import { openStore } from "../../packages/core/src/store.js";
import { createQueryEngine } from "../../packages/core/src/query.js";
import { createContext } from "../../packages/core/src/context.js";
it("returns linked concrete gameplay views and preserves Code as the compatibility default", async () =>
  withWorkspace(async (dir) => {
    const graph = await gameplayGraph(eggCode),
      store = await openStore(join(dir, "graph.db"));
    try {
      await store.save(graph);
      const engine = createQueryEngine(store);
      const gameplay = await engine.run({
        analysisId: graph.analysisId,
        op: "overview",
        view: "gameplay",
      });
      expect(gameplay.projection?.view).toBe("gameplay");
      expect(gameplay.nodes.some((n) => n.id === "chicken")).toBe(true);
      expect(gameplay.nodes.some((n) => n.id === "egg")).toBe(true);
      expect(gameplay.relations.some((r) => r.type === "SPAWNS")).toBe(true);
      expect(gameplay.nodes.every((n) => n.kind === "instance")).toBe(true);
      const eggFlow = await engine.run({
        analysisId: graph.analysisId,
        op: "trace",
        view: "gameplay",
        fromId: "chicken",
        toId: "egg",
        depth: 6,
      });
      expect(eggFlow.paths.length).toBeGreaterThan(0);
      const code = await engine.run({
        analysisId: graph.analysisId,
        op: "overview",
      });
      expect(code.relations.every((r) => !r.gameplay)).toBe(true);
      const context = createContext(gameplay, {
        estimatedTokenBudget: 4000,
        maxBytes: 32000,
      });
      expect(context.markdown).toContain("Gameplay");
      expect(context.markdown).toContain("static");
      expect(context.markdown).not.toContain("Symbolic spawned egg");
    } finally {
      await store.close();
    }
  }));
it("does not turn FireServer into a path to an OnClientEvent listener on the same remote", async () =>
  withWorkspace(async (dir) => {
    const graph = await gameplayGraph({
        HomeButtonScript:
          'local r=game:GetService("ReplicatedStorage").HomeTeleportEvent;script.Parent.HomeButton.MouseButton1Click:Connect(function()r:FireServer()end)',
        ListenerClient:
          'game:GetService("ReplicatedStorage").HomeTeleportEvent.OnClientEvent:Connect(function()print("client")end)',
      }),
      store = await openStore(join(dir, "graph.db"));
    try {
      await store.save(graph);
      const r = await createQueryEngine(store).run({
        analysisId: graph.analysisId,
        op: "trace",
        view: "gameplay",
        fromId: "button",
        toId: "script:ListenerClient",
        depth: 6,
      });
      expect(r.paths).toHaveLength(0);
    } finally {
      await store.close();
    }
  }));
it("traces GUI gameplay through the exact channel without traversing utility or config hubs", async () =>
  withWorkspace(async (dir) => {
    const graph = await gameplayGraph({
        HomeButtonScript:
          'local r=game:GetService("ReplicatedStorage").HomeTeleportEvent;script.Parent.HomeButton.MouseButton1Click:Connect(function()r:FireServer()end)',
        GameServer:
          'game:GetService("ReplicatedStorage").HomeTeleportEvent.OnServerEvent:Connect(function(player)player.Character:PivotTo(CFrame.new(0,0,0))end)',
      }),
      store = await openStore(join(dir, "graph.db"));
    try {
      await store.save(graph);
      const r = await createQueryEngine(store).run({
        analysisId: graph.analysisId,
        op: "trace",
        view: "gameplay",
        fromId: "button",
        toId: "players",
        depth: 6,
      });
      expect(r.paths.length).toBeGreaterThan(0);
      expect(r.relations.every((e) => !!e.gameplay)).toBe(true);
    } finally {
      await store.close();
    }
  }));
