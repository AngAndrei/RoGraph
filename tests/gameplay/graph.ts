import { gameplayCase } from "./support.js";
import { assembleGraph } from "../../packages/core/src/assemble.js";
import { resolveInstances } from "../../packages/core/src/resolve-instances.js";
import { resolveCalls } from "../../packages/core/src/resolve-calls.js";
import { resolveConfig } from "../../packages/core/src/resolve-config.js";
import { resolveEvents } from "../../packages/core/src/resolve-events.js";
export async function gameplayGraph(
  code: Record<string, string>,
  edit?: (
    snapshot: import("../../packages/contracts/src/model.js").Snapshot,
  ) => void,
) {
  const c = await gameplayCase(code);
  edit?.(c.snapshot);
  const i = resolveInstances(c.snapshot, c.facts),
    calls = resolveCalls(c.snapshot, c.facts, i);
  return assembleGraph(c.snapshot, c.facts, [
    i,
    calls,
    resolveConfig(c.snapshot, c.facts, i, calls),
    resolveEvents(c.snapshot, c.facts, i, calls),
  ]);
}
export const eggCode = {
  ChickenConfig:
    'return {Standard={EggTemplateName="Egg",EggSpawnIntervalMin=1,EggSpawnIntervalMax=3,EggScaleFactorMin=1,EggScaleFactorMax=2}}',
  ChickenController:
    'local chicken=script.Parent;local ChickenConfig=require(game:GetService("ReplicatedStorage").ChickenConfig);task.spawn(function() while true do local chickenType=chicken:GetAttribute("ChickenType") or "Standard";local config=ChickenConfig[chickenType] or ChickenConfig.Standard;task.wait(math.random(config.EggSpawnIntervalMin,config.EggSpawnIntervalMax));local root=chicken:FindFirstChild("HumanoidRootPart");if not root then continue end;local template=game:GetService("ServerStorage"):FindFirstChild(config.EggTemplateName);if not template then continue end;local egg=template:Clone();if egg:IsA("Model") then egg:PivotTo(CFrame.new(root.Position));egg:ScaleTo(config.EggScaleFactorMin) end;egg.Parent=workspace end end)',
};
