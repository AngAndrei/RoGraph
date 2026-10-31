import type { Snapshot, Instance } from "../../packages/contracts/src/model.js";
import { extractFacts } from "../../packages/core/src/facts.js";
import { hash } from "../../packages/core/src/util.js";
export const object = (
  id: string,
  name: string,
  className: string,
  parentId: string | null,
): Instance => ({
  id,
  name,
  className,
  parentId,
  siblingOrdinal: 0,
  properties: {},
  synthetic: false,
});
export async function gameplayCase(code: Record<string, string> = {}) {
  const instances = [
    object("root", "Game", "DataModel", null),
    object("workspace", "Workspace", "Workspace", "root"),
    object("server", "ServerStorage", "ServerStorage", "root"),
    object("replicated", "ReplicatedStorage", "ReplicatedStorage", "root"),
    object("players", "Players", "Players", "root"),
    object("scripts", "ServerScriptService", "ServerScriptService", "root"),
    object("gui", "HomeGui", "ScreenGui", "root"),
    object("button", "HomeButton", "TextButton", "gui"),
    object("remote", "HomeTeleportEvent", "RemoteEvent", "replicated"),
    object("chicken", "Chicken", "Model", "workspace"),
    object("part", "HumanoidRootPart", "Part", "chicken"),
    object("prompt", "ProximityPrompt", "ProximityPrompt", "part"),
    object("egg", "Egg", "Model", "server"),
    object("eggpart", "EggPart", "Part", "egg"),
    object("eggtool", "EggTool", "Tool", "server"),
    object("chickentool", "ChickenItem", "Tool", "server"),
  ];
  const sources = Object.entries(code).map(([name, text]) => {
    const id = "script:" + name;
    instances.push(
      object(
        id,
        name,
        name.endsWith("Config")
          ? "ModuleScript"
          : name === "HomeButtonScript"
            ? "LocalScript"
            : "Script",
        name === "ChickenController" || name === "PickupScript"
          ? "chicken"
          : name === "HomeButtonScript"
            ? "gui"
            : name.endsWith("Config")
              ? "replicated"
              : "scripts",
      ),
    );
    return {
      id: "source:" + name,
      scriptId: id,
      text,
      sha256: hash(text),
      origin: { kind: "place" as const, path: "authored-gameplay.rbxlx" },
    };
  });
  const snapshot: Snapshot = {
    snapshotId: hash(JSON.stringify(code)),
    input: { kind: "place", path: "authored-gameplay.rbxlx" },
    versions: { importer: "authored" },
    instances,
    sources,
    diagnostics: [],
    inventory: {
      items: [],
      rawInput: { sha256: hash(""), byteLength: 0, bytesBase64: "" },
    },
    coverage: {
      importedInstances: instances.length,
      discoveredScripts: sources.length,
      parsedScripts: 0,
      discoveredSites: 0,
      resolvedSites: 0,
      candidateSites: 0,
      unresolvedSites: 0,
      partialImport: false,
      limitations: [],
    },
  };
  return { snapshot, facts: await extractFacts(snapshot) };
}
