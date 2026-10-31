import { it, expect } from "vitest";
import { gameplayCase } from "./support.js";
import { FlowResolver as ModuleResolver } from "../../packages/core/src/flow-resolver.js";
it("follows a config fallback into a real egg template and distinct clone allocation", async () => {
  const c = await gameplayCase({
    ChickenConfig:
      'return {Standard={EggTemplateName="Egg",EggScaleFactorMin=1}}',
    ChickenController:
      'local chicken=script.Parent;local ChickenConfig=require(game:GetService("ReplicatedStorage").ChickenConfig);local chickenType=chicken:GetAttribute("ChickenType") or "Standard";local config=ChickenConfig[chickenType] or ChickenConfig["Standard"];local eggTemplate=game:GetService("ServerStorage"):FindFirstChild(config.EggTemplateName);local newEgg=eggTemplate:Clone();newEgg.Parent=workspace',
  });
  const r = new ModuleResolver(c.snapshot, c.facts),
    f = c.facts.find((f) => f.scriptId === "script:ChickenController")!;
  const template = r.get(
    f.bindings.find((b) => b.name === "eggTemplate")!.initializer,
    f,
  );
  expect(template.kind).not.toBe("unknown");
  const egg = r.get(
    f.bindings.find((b) => b.name === "newEgg")!.initializer,
    f,
  );
  expect(egg.kind).not.toBe("unknown");
  expect(egg).not.toEqual(template);
  expect(JSON.stringify(egg)).toContain("egg");
});
it("keeps named creation sites and callback player roles anchored to project/code objects", async () => {
  const c = await gameplayCase({
    EggPickup:
      'local prompt=Instance.new("ProximityPrompt");prompt.Name="PickupPrompt";prompt.Triggered:Connect(function(player) local bag=player.Backpack end)',
  });
  const r = new ModuleResolver(c.snapshot, c.facts),
    f = c.facts[0];
  r.get(f.bindings.find((b) => b.name === "prompt")!.initializer, f);
  expect([...r.created.values()].map((x) => x.name)).toContain("PickupPrompt");
  const player = f.bindings.find((b) => b.name === "player")!;
  const value = r.get(
    {
      kind: "binding",
      bindingId: player.id,
      span: player.assignments[0]?.span ?? f.symbols[0].span,
    },
    f,
  );
  expect(r.anchorIds(value)).toContain("players");
  expect(JSON.stringify(value)).toContain("Player");
});
it("preserves variant target alternatives instead of deciding an unknown attribute is Standard", async () => {
  const c = await gameplayCase({
    ChickenConfig:
      'return {Standard={EggTemplateName="Egg"},Golden={EggTemplateName="GoldenEgg"}}',
    ChickenController:
      'local C=require(game:GetService("ReplicatedStorage").ChickenConfig);local variant=script.Parent:GetAttribute("ChickenType") or "Standard";local row=C[variant] or C.Standard;local name=row.EggTemplateName',
  });
  const r = new ModuleResolver(c.snapshot, c.facts),
    f = c.facts.find((f) => f.scriptId === "script:ChickenController")!;
  const value = r.get(
    f.bindings.find((b) => b.name === "name")!.initializer,
    f,
  );
  expect(r.alternatives(value).map((v) => v.value)).toEqual(
    expect.arrayContaining(["Egg", "GoldenEgg"]),
  );
  expect(value.open).toBe(true);
});
it("keeps nil distinct from unknown when selecting a fallback", async () => {
  const c = await gameplayCase({
    ChickenController:
      'local c={};local a=c.Missing or "Standard";local b=unknownValue or "Standard"',
  });
  const r = new ModuleResolver(c.snapshot, c.facts),
    f = c.facts[0];
  expect(
    r.get(f.bindings.find((b) => b.name === "a")!.initializer, f).value,
  ).toBe("Standard");
  expect(
    r.get(f.bindings.find((b) => b.name === "b")!.initializer, f).value,
  ).not.toBe("Standard");
});
