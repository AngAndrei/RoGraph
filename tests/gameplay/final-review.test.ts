import { it, expect } from "vitest";
import { gameplayGraph, eggCode } from "./graph.js";
import { object } from "./support.js";
import { openStore } from "../../packages/core/src/store.js";
import { createQueryEngine } from "../../packages/core/src/query.js";
import { createContext } from "../../packages/core/src/context.js";
import type { Graph } from "../../packages/contracts/src/model.js";
import type { Query } from "../../packages/contracts/src/query.js";
import { gameplayScopes } from "../../packages/core/src/gameplay-scopes.js";
it("bounds wide callback reachability and discloses the remainder", () => {
  const children = Array.from({ length: 300 }, (_, i) => "fn:" + i);
  const scope = gameplayScopes(
    [],
    [
      {
        relations: children.map((target) => ({
          type: "CALLS",
          source: "root",
          target,
        })),
      } as any,
    ],
    { owners: new Map(children.map((id) => [id, "script"])) } as any,
  )("root") as any;
  expect(scope.ownerIds).toHaveLength(256);
  expect(scope.truncated).toBe(true);
});
async function query(g: Graph, q: Omit<Query, "analysisId">) {
  const s = await openStore(":memory:");
  try {
    await s.save(g);
    return await createQueryEngine(s).run({ ...q, analysisId: g.analysisId });
  } finally {
    await s.close();
  }
}
const prompt = "workspace.Chicken.HumanoidRootPart.ProximityPrompt";
it.each([
  "e.EggPart:Destroy()",
  'e:FindFirstChild("EggPart"):Destroy()',
  "for _,p in ipairs(e:GetChildren()) do p:Destroy() end",
])("retains cloned-child allocation identity: %s", async (operation) => {
  const g = await gameplayGraph({
    GameServer:
      'local e=game:GetService("ServerStorage").Egg:Clone();' + operation,
  });
  const effect = g.relations.find(
    (r) => r.type === "DESTROYS" && r.target === "eggpart",
  );
  expect(effect?.gameplay?.allocationId).toBeTruthy();
  expect(g.nodes.find((n) => n.id === effect?.target)?.label).toBe("EggPart");
});
it("retains allocation identity for variant-selected parenting", async () => {
  const g = await gameplayGraph(eggCode);
  const r = g.relations.find(
    (r) => r.type === "REPARENTS" && r.target === "egg",
  );
  expect(r?.gameplay?.allocationId).toBeTruthy();
});
it.each([
  'task.spawn(function()game:GetService("ServerStorage").Egg:Destroy()end)',
  'local function unused()game:GetService("ServerStorage").Egg:Destroy()end',
])(
  "does not turn unrelated code into a prompt continuation: %s",
  async (unrelated) => {
    const g = await gameplayGraph({
      GameServer: `${prompt}.Triggered:Connect(function()print("noop")end);${unrelated}`,
    });
    const r = await query(g, {
      op: "trace",
      view: "gameplay",
      fromId: "prompt",
      toId: "egg",
      depth: 6,
    });
    expect(r.paths).toHaveLength(0);
  },
);
it.each(["remove()", "task.spawn(remove)"])(
  "follows an explicitly called/scheduled helper: %s",
  async (call) => {
    const g = await gameplayGraph({
      GameServer: `local function remove() game:GetService("ServerStorage").Egg:Destroy() end;${prompt}.Triggered:Connect(function() ${call} end)`,
    });
    const r = await query(g, {
      op: "trace",
      view: "gameplay",
      fromId: "prompt",
      toId: "egg",
      depth: 6,
    });
    expect(r.paths.length).toBeGreaterThan(0);
    const reverse = await query(g, {
      op: "impact",
      view: "gameplay",
      nodeId: "egg",
      depth: 6,
    });
    expect(reverse.nodes.some((n) => n.id === "prompt")).toBe(true);
  },
);
it("keeps unsupported platform behavior visible through query and agent export", async () => {
  const g = await gameplayGraph({
    GameServer: 'game:GetService("ServerStorage").Egg:BreakJoints()',
  });
  expect(
    g.diagnostics.some((d) => d.code === "UNMODELED_PLATFORM_BEHAVIOR"),
  ).toBe(true);
  const r = await query(g, { op: "inspect", view: "gameplay", nodeId: "egg" });
  expect(
    r.diagnostics.some((d) => d.code === "UNMODELED_PLATFORM_BEHAVIOR"),
  ).toBe(true);
  expect(createContext(r, { estimatedTokenBudget: 4000 }).markdown).toContain(
    "UNMODELED_PLATFORM_BEHAVIOR",
  );
});
it("retrieves callback-owned support sites and config-definition provenance", async () => {
  const g = await gameplayGraph(eggCode),
    r = await query(g, { op: "inspect", view: "gameplay", nodeId: "egg" });
  const wanted = new Set(
    r.relations.flatMap((e) => e.gameplay?.supportSiteIds ?? []),
  );
  const missing = [...wanted].filter((id) => !r.sites.some((s) => s.id === id));
  expect(missing.length).toBeLessThanOrEqual(
    r.meta.omittedCounts.supportSites ?? 0,
  );
  const spawn = r.relations.find((e) => e.type === "SPAWNS")!;
  expect(
    spawn.gameplay?.configPaths?.some((p) =>
      p.includes("Standard.EggTemplateName"),
    ),
  ).toBe(true);
  expect(r.sources.some((s) => s.id === "source:ChickenConfig")).toBe(true);
});
it("keeps row-specific config provenance for distinct selected templates", async () => {
  const g = await gameplayGraph(
    {
      ChickenConfig:
        'return {Standard={EggTemplateName="Egg",Scale=1},Golden={EggTemplateName="GoldenEgg",Scale=3}}',
      ChickenController:
        'local C=require(game:GetService("ReplicatedStorage").ChickenConfig);local row=C[script.Parent:GetAttribute("ChickenType") or "Standard"] or C.Standard;local e=game:GetService("ServerStorage"):FindFirstChild(row.EggTemplateName):Clone();e:ScaleTo(row.Scale)',
    },
    (s) => {
      s.instances.push(object("gold", "GoldenEgg", "Model", "server"));
    },
  );
  const r = g.relations.find(
    (r) => r.type === "SPAWNS" && r.target === "gold",
  )!;
  expect(
    r.gameplay?.configPaths?.some((p) => p.includes("Golden.EggTemplateName")),
  ).toBe(true);
  expect(r.gameplay?.configPaths?.some((p) => p.includes("Standard."))).toBe(
    false,
  );
});
it("does not claim a spawn when the saved template is not Archivable", async () => {
  const g = await gameplayGraph(
    { GameServer: 'local e=game:GetService("ServerStorage").Egg:Clone()' },
    (s) => {
      s.instances.find((i) => i.id === "egg")!.properties.Archivable = {
        type: "Bool",
        value: false,
      };
    },
  );
  expect(g.relations.filter((r) => r.type === "SPAWNS")).toHaveLength(0);
});
it("shows a named constructor with its source and supplied parent", async () => {
  const g = await gameplayGraph({
      GameServer: 'local p=Instance.new("Part",workspace);p.Name="Gift"',
    }),
    gift = g.nodes.find((n) => n.label === "Gift")!;
  const r = await query(g, { op: "overview", view: "gameplay" });
  expect(r.nodes.some((n) => n.id === gift.id)).toBe(true);
  expect(
    r.relations.some((e) => e.target === gift.id && e.type === "SPAWNS"),
  ).toBe(true);
  expect(
    r.relations.some(
      (e) => e.target === gift.id && e.gameplay?.destinationId === "workspace",
    ),
  ).toBe(true);
});
it("binds a known FireServer payload after the implicit player argument", async () => {
  const g = await gameplayGraph({
    HomeButtonScript: `local r=game:GetService("ReplicatedStorage").HomeTeleportEvent;script.Parent.HomeButton.MouseButton1Click:Connect(function()r:FireServer(workspace.Chicken)end)`,
    GameServer:
      'game:GetService("ReplicatedStorage").HomeTeleportEvent.OnServerEvent:Connect(function(player,target)target:Destroy()end)',
  });
  expect(
    g.relations.some((r) => r.type === "DESTROYS" && r.target === "chicken"),
  ).toBe(true);
  const r = await query(g, {
    op: "trace",
    view: "gameplay",
    fromId: "button",
    toId: "chicken",
    depth: 6,
  });
  expect(r.paths.length).toBeGreaterThan(0);
});
it("binds a BindableEvent payload without adding a player offset", async () => {
  const g = await gameplayGraph(
    {
      GameServer:
        'local r=game:GetService("ReplicatedStorage").HomeTeleportEvent;r.Event:Connect(function(target)target:Destroy()end);r:Fire(workspace.Chicken)',
    },
    (s) => {
      s.instances.find((i) => i.id === "remote")!.className = "BindableEvent";
    },
  );
  expect(
    g.relations.some((r) => r.type === "DESTROYS" && r.target === "chicken"),
  ).toBe(true);
});
it("does not attribute an unrelated timer effect to the prompt during reverse impact", async () => {
  const g = await gameplayGraph({
    GameServer: `${prompt}.Triggered:Connect(function()print("noop")end);task.spawn(function()game:GetService("ServerStorage").Egg:Destroy()end)`,
  });
  const r = await query(g, {
    op: "impact",
    view: "gameplay",
    nodeId: "egg",
    depth: 6,
  });
  expect(r.nodes.some((n) => n.id === "prompt")).toBe(false);
});
it("keeps remote payloads on their actual saved channel", async () => {
  const g = await gameplayGraph(
    {
      HomeButtonScript:
        'game:GetService("ReplicatedStorage").Other:FireServer(workspace.Chicken)',
      GameServer:
        'game:GetService("ReplicatedStorage").HomeTeleportEvent.OnServerEvent:Connect(function(player,target)target:Destroy()end)',
    },
    (s) =>
      s.instances.push(object("other", "Other", "RemoteEvent", "replicated")),
  );
  expect(
    g.relations.some((r) => r.type === "DESTROYS" && r.target === "chicken"),
  ).toBe(false);
});
it("skips the FireClient recipient when binding client payloads", async () => {
  const g = await gameplayGraph({
    GameServer:
      'game:GetService("Players").PlayerAdded:Connect(function(player)game:GetService("ReplicatedStorage").HomeTeleportEvent:FireClient(player,workspace.Chicken)end)',
    HomeButtonScript:
      'game:GetService("ReplicatedStorage").HomeTeleportEvent.OnClientEvent:Connect(function(target)target:Destroy()end)',
  });
  expect(
    g.relations.some((r) => r.type === "DESTROYS" && r.target === "chicken"),
  ).toBe(true);
});
it("binds InvokeServer payloads in a callback assignment", async () => {
  const g = await gameplayGraph(
    {
      HomeButtonScript:
        'game:GetService("ReplicatedStorage").HomeTeleportEvent:InvokeServer(workspace.Chicken)',
      GameServer:
        'game:GetService("ReplicatedStorage").HomeTeleportEvent.OnServerInvoke=function(player,target)target:Destroy()end',
    },
    (s) => {
      s.instances.find((i) => i.id === "remote")!.className = "RemoteFunction";
    },
  );
  expect(
    g.relations.some((r) => r.type === "DESTROYS" && r.target === "chicken"),
  ).toBe(true);
});
