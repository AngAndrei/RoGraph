import { it, expect } from "vitest";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { defaultLimits } from "../packages/core/src/limits.js";
import { buildRojoSnapshot } from "../packages/core/src/rojo-import.js";
import { hash } from "../packages/core/src/util.js";
import { withWorkspace } from "./support/workspace.js";

const moduleItem = (referent: string, text: string) =>
  `<Item class="ModuleScript" referent="${referent}"><Properties><string name="Name">Child</string><ProtectedString name="Source">${text}</ProtectedString></Properties></Item>`;

async function mountedModel(directory: string, ...children: string[]) {
  const model = `<roblox version="4"><Item class="Folder" referent="root"><Properties><string name="Name">Model</string></Properties>${children.join("")}</Item></roblox>`;
  const modelPath = join(directory, "mounted.rbxmx");
  await writeFile(modelPath, model);
  const projectPath = join(directory, "default.project.json");
  await writeFile(
    projectPath,
    JSON.stringify({
      name: "MountedModel",
      tree: {
        $className: "DataModel",
        ReplicatedStorage: {
          $className: "ReplicatedStorage",
          Model: { $path: "mounted.rbxmx" },
        },
      },
    }),
  );
  return { model, modelPath, projectPath };
}

it("retains the mounted model file for an unambiguous nested script", async () =>
  withWorkspace(async (directory) => {
    const { model, modelPath, projectPath } = await mountedModel(
      directory,
      moduleItem("one", "return 42"),
    );
    const snapshot = await buildRojoSnapshot(projectPath);
    expect(snapshot.sources).toHaveLength(1);
    expect(snapshot.sources[0]).toMatchObject({
      text: "return 42",
      origin: {
        kind: "generated",
        mapping: "unavailable",
        originalPath: modelPath,
        originalSha256: hash(model),
        originalText: model,
      },
    });
    expect(snapshot.diagnostics.map((d) => d.code)).not.toContain(
      "ROJO_MAP_AMBIGUOUS",
    );
    expect(snapshot.coverage.partialImport).toBe(false);
  }));

it("retains the project JSON for a verified inline script source", async () =>
  withWorkspace(async (directory) => {
    const projectPath = join(directory, "default.project.json");
    const project = JSON.stringify({
      name: "Inline",
      tree: {
        $className: "DataModel",
        ReplicatedStorage: {
          $className: "ReplicatedStorage",
          InlineScript: {
            $className: "ModuleScript",
            $properties: { Source: "return 16" },
          },
        },
      },
    });
    await writeFile(projectPath, project);
    const snapshot = await buildRojoSnapshot(projectPath);
    expect(snapshot.sources).toHaveLength(1);
    expect(snapshot.sources[0]).toMatchObject({
      text: "return 16",
      origin: {
        kind: "generated",
        mapping: "unavailable",
        originalPath: projectPath,
        originalSha256: hash(project),
        originalText: project,
      },
    });
  }));

it("reports indistinguishable model siblings and preserves their compiled source", async () =>
  withWorkspace(async (directory) => {
    const { projectPath } = await mountedModel(
      directory,
      moduleItem("one", "return 1"),
      moduleItem("two", "return 2"),
    );
    const snapshot = await buildRojoSnapshot(projectPath);
    expect(snapshot.sources.map((s) => s.text).sort()).toEqual([
      "return 1",
      "return 2",
    ]);
    expect(snapshot.sources.map((s) => s.origin)).toEqual(
      Array.from({ length: 2 }, () => ({
        kind: "generated",
        path: projectPath,
        mapping: "unavailable",
      })),
    );
    expect(snapshot.diagnostics.map((d) => d.code)).toContain(
      "ROJO_MAP_AMBIGUOUS",
    );
    expect(snapshot.coverage.limitations).toContainEqual(
      expect.stringMatching(/original file mapping/i),
    );
    expect(snapshot.coverage.partialImport).toBe(false);
  }));

it("reports authored root properties omitted by the built place", async () =>
  withWorkspace(async (directory) => {
    const projectPath = join(directory, "default.project.json");
    const project = JSON.stringify({
      name: "RootProperties",
      tree: { $className: "DataModel", $properties: { Archivable: false } },
    });
    await writeFile(projectPath, project);
    const snapshot = await buildRojoSnapshot(projectPath);
    expect(snapshot.coverage.partialImport).toBe(true);
    expect(snapshot.diagnostics.map((d) => d.code)).toContain(
      "ROJO_ROOT_PROPERTIES_OMITTED",
    );
    expect(snapshot.instances.find((object) => object.synthetic)!.properties).not.toHaveProperty(
      "Archivable",
    );
    expect((snapshot.inventory.rojo as { files: object[] }).files).toContainEqual(
      expect.objectContaining({ originalPath: projectPath, sha256: hash(project) }),
    );
  }));

it("bounds original text retained for a model mounted more than once", async () =>
  withWorkspace(async (directory) => {
    const modelPath = join(directory, "shared.rbxmx");
    const model = `<roblox version="4"><!--${" ".repeat(defaultLimits.scriptBytes / 2)}-->${moduleItem("one", "return 42")}</roblox>`;
    const expectedHash = hash(model);
    await writeFile(modelPath, model);
    const projectPath = join(directory, "default.project.json");
    await writeFile(
      projectPath,
      JSON.stringify({
        name: "SharedModel",
        tree: {
          $className: "DataModel",
          ReplicatedStorage: {
            $className: "ReplicatedStorage",
            First: { $path: "shared.rbxmx" },
            Second: { $path: "shared.rbxmx" },
          },
        },
      }),
    );

    const snapshot = await buildRojoSnapshot(projectPath);
    expect(snapshot.sources).toHaveLength(2);
    for (const source of snapshot.sources) {
      expect(source.text).toBe("return 42");
      expect(source.origin).toMatchObject({
        kind: "generated",
        mapping: "unavailable",
        originalPath: modelPath,
        originalSha256: expectedHash,
      });
    }
    expect(snapshot.sources.filter((source) => source.origin.originalText)).toHaveLength(1);
    expect(snapshot.coverage.limitations).toContainEqual(
      expect.stringMatching(/retained text exceeds the analysis budget/),
    );
    expect(snapshot.coverage.partialImport).toBe(false);
  }));
