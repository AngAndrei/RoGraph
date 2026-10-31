import { it, expect } from "vitest";
import { gameplayGraph, eggCode } from "./graph.js";
it("connects real chicken/config/egg objects with source-backed spawning effects", async () => {
  const g = await gameplayGraph(eggCode);
  expect(
    g.relations.some(
      (r) =>
        r.type === "SPAWNS" &&
        r.source === "script:ChickenController" &&
        r.target === "egg",
    ),
  ).toBe(true);
  expect(
    g.relations.some(
      (r) =>
        r.type === "CONFIGURED_BY" &&
        r.source === "chicken" &&
        r.target === "script:ChickenConfig",
    ),
  ).toBe(true);
  expect(
    g.nodes.some((n) =>
      /symbolic|spawned egg|egg.laying action/i.test(n.label),
    ),
  ).toBe(false);
  const semantic = g.relations.filter((r) => r.gameplay);
  expect(semantic.length).toBeGreaterThan(2);
  for (const r of semantic) {
    expect(r.gameplay!.supportSiteIds.length).toBeGreaterThan(0);
    expect(g.evidence.some((e) => e.relationId === r.id)).toBe(true);
  }
});
it("connects real prompts and players service to pickup code and actual item/model targets", async () => {
  const g = await gameplayGraph({
    PickupScript:
      'local chicken=script.Parent;local prompt=chicken.HumanoidRootPart.ProximityPrompt;prompt.Triggered:Connect(function(player) local tool=game:GetService("ServerStorage").ChickenItem:Clone();tool.Parent=player.Backpack;chicken:Destroy() end)',
  });
  expect(
    g.relations.some(
      (r) =>
        r.type === "TRIGGERS" &&
        r.source === "prompt" &&
        r.target === "script:PickupScript",
    ),
  ).toBe(true);
  expect(
    g.relations.some((r) => r.type === "DESTROYS" && r.target === "chicken"),
  ).toBe(true);
  expect(
    g.relations.some((r) => r.type === "SPAWNS" && r.target === "chickentool"),
  ).toBe(true);
  expect(g.relations.some((r) => r.source === "players" && r.gameplay)).toBe(
    true,
  );
});
it("does not connect two entities merely for shared utilities or configuration", async () => {
  const g = await gameplayGraph({
    ChickenController:
      'local n=math.random();local c=require(game:GetService("ReplicatedStorage").ChickenConfig);print(c.Rate)',
    EggPickup:
      'local c=require(game:GetService("ReplicatedStorage").ChickenConfig);print(c.Rate)',
    ChickenConfig: "return {Rate=2}",
  });
  expect(
    g.relations.some(
      (r) =>
        r.gameplay &&
        r.source === "script:ChickenController" &&
        r.target === "script:EggPickup",
    ),
  ).toBe(false);
  expect(
    g.relations.some(
      (r) =>
        r.gameplay &&
        g.nodes.find((n) => n.id === r.target)?.attributes.builtin,
    ),
  ).toBe(false);
});
it("links the actual GUI button through its exact remote to a player effect", async () => {
  const g = await gameplayGraph({
    HomeButtonScript:
      'local button=script.Parent.HomeButton;local remote=game:GetService("ReplicatedStorage").HomeTeleportEvent;button.MouseButton1Click:Connect(function() remote:FireServer() end)',
    GameServer:
      'local remote=game:GetService("ReplicatedStorage").HomeTeleportEvent;remote.OnServerEvent:Connect(function(player) player.Character:PivotTo(CFrame.new(0,0,0)) end)',
  });
  expect(
    g.relations.some(
      (r) =>
        r.type === "TRIGGERS" &&
        r.source === "button" &&
        r.target === "script:HomeButtonScript",
    ),
  ).toBe(true);
  expect(
    g.relations.some(
      (r) =>
        r.type === "TRIGGERS" &&
        r.source === "script:HomeButtonScript" &&
        r.target === "remote",
    ),
  ).toBe(true);
  expect(
    g.relations.some(
      (r) =>
        r.type === "TRIGGERS" &&
        r.source === "remote" &&
        r.target === "script:GameServer",
    ),
  ).toBe(true);
  expect(
    g.relations.some((r) => r.type === "TRANSFORMS" && r.target === "players"),
  ).toBe(true);
});
