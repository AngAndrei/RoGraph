import { it, expect } from "vitest";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { analyze } from "../packages/core/src/pipeline.js";
import { openStore } from "../packages/core/src/store.js";
import { withWorkspace } from "./support/workspace.js";
import { hash } from "../packages/core/src/util.js";
it("retains binary Rojo originals as exact owned blobs rather than UTF8", async () =>
  withWorkspace(async (d) => {
    const project = join(d, "project");
    await mkdir(project);
    await writeFile(join(project, "module.luau"), "return {Value=42}");
    await writeFile(
      join(project, "model.project.json"),
      JSON.stringify({ name: "BinarySource", tree: { $path: "module.luau" } }),
    );
    const model = join(project, "source.rbxm");
    await promisify(execFile)(
      resolve("build/bin/rojo.exe"),
      ["build", join(project, "model.project.json"), "--output", model],
      { windowsHide: true },
    );
    const bytes = await readFile(model);
    await writeFile(
      join(project, "default.project.json"),
      JSON.stringify({
        name: "Mounted",
        tree: {
          $className: "DataModel",
          ReplicatedStorage: {
            $className: "ReplicatedStorage",
            Model: { $path: "source.rbxm" },
          },
        },
      }),
    );
    const store = await openStore(join(d, "analysis", "g.db"));
    try {
      const graph = await analyze(
        { kind: "rojo", projectPath: join(project, "default.project.json") },
        store,
      );
      const source = graph.sources.find((s) => s.text.includes("Value"))!;
      expect(source.origin.originalText).toBeUndefined();
      const original = (source.origin as any).originalBinary;
      expect(original).toMatchObject({
        encoding: "binary",
        sha256: hash(bytes),
        byteLength: bytes.length,
      });
      expect(await readFile(original.blobPath)).toEqual(bytes);
      const reopened = await store.readGraph(graph.analysisId),
        saved = (
          reopened.sources.find((s) => s.id === source.id)!.origin as any
        ).originalBinary;
      expect(saved.blobPath.startsWith(join(d, "analysis", "blobs"))).toBe(
        true,
      );
      expect(await readFile(saved.blobPath)).toEqual(bytes);
    } finally {
      await store.close();
    }
  }));
