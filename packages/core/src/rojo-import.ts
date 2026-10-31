import { tmpdir } from "node:os";
import { readFile, rm } from "node:fs/promises";
import { resolve, extname, dirname, basename, sep } from "node:path";
import type { Snapshot } from "../../contracts/src/model.js";
import {
  captureProject,
  inventoryDirectory,
  parseProject,
  type ProjectCapture,
} from "../../adapters/src/capture.js";
import { runRojoBuild, type RojoBuild } from "../../adapters/src/rojo.js";
import { importPlace } from "./import.js";
import { hash, canonical } from "./util.js";
export async function attachRojoProvenance(
  snapshot: Snapshot,
  build: RojoBuild,
  capture: ProjectCapture,
): Promise<Snapshot> {
  if (
    snapshot.snapshotId !== build.outputHashes.place ||
    hash(await readFile(build.sourcemapPath)) !== build.outputHashes.map ||
    (await inventoryDirectory(capture.root)).manifestHash !==
      build.inputManifestHash
  )
    throw new Error("Stale or mixed Rojo build/sourcemap revision");
  const map = JSON.parse(await readFile(build.sourcemapPath, "utf8"));
  if (map?.className !== "DataModel")
    throw new Error("Invalid Rojo sourcemap root");
  const root = snapshot.instances.find((i) => i.synthetic)!;
  const diagnostics = snapshot.diagnostics;
  const walk = async (m: any, id: string) => {
    if (typeof m.name !== "string" || typeof m.className !== "string")
      throw new Error("Invalid sourcemap node");
    const object = snapshot.instances.find((i) => i.id === id)!;
    if (object.sourceId) {
      const source = snapshot.sources.find((s) => s.id === object.sourceId)!;
      const paths = (m.filePaths ?? []).filter(
        (p: unknown) => typeof p === "string",
      );
      const candidates = capture.files.filter(
        (f) =>
          paths.some((p: string) => resolve(p) === resolve(f.capturedPath)) &&
          /\.(lua|luau|json|jsonc|toml|rbxm|rbxmx)$/.test(f.originalPath),
      );
      if (candidates.length === 1) {
        const file = candidates[0],
          text = await readFile(file.capturedPath, "utf8"),
          code = /\.(lua|luau)$/.test(file.originalPath),
          normalized = text.replace(/\r\n/g, "\n"),
          matches = code && normalized === source.text;
        source.origin = {
          kind: matches ? "file" : "generated",
          path: file.originalPath,
          originalPath: file.originalPath,
          originalSha256: file.sha256,
          originalText: text,
          mapping: matches
            ? text === source.text
              ? "identity"
              : "crlf-to-lf"
            : "unavailable",
        };
      } else
        diagnostics.push({
          code: "ROJO_MAP_AMBIGUOUS",
          severity: "warning",
          message: `No unique original file mapping for ${object.name}`,
          ownerId: id,
        });
    }
    for (const child of m.children ?? []) {
      const objects = snapshot.instances.filter(
        (i) =>
          i.parentId === id &&
          i.name === child.name &&
          i.className === child.className,
      );
      const mapMatches = (m.children ?? []).filter(
        (v: any) => v.name === child.name && v.className === child.className,
      );
      if (objects.length === 1 && mapMatches.length === 1)
        await walk(child, objects[0].id);
      else
        diagnostics.push({
          code: "ROJO_MAP_AMBIGUOUS",
          severity: "warning",
          message: `Ambiguous hierarchy mapping for ${child.name}`,
          ownerId: id,
        });
    }
  };
  await walk(map, root.id);
  const project = parseProject(await readFile(capture.projectPath, "utf8"));
  if (
    project.tree?.$properties &&
    Object.keys(project.tree.$properties).length
  ) {
    snapshot.coverage.partialImport = true;
    diagnostics.push({
      code: "ROJO_ROOT_PROPERTIES_OMITTED",
      severity: "warning",
      message:
        "Rojo place output does not serialize custom project-root properties.",
    });
  }
  snapshot.input = {
    kind: "rojo",
    projectPath: capture.files.find(
      (f) => f.capturedPath === capture.projectPath,
    )!.originalPath,
  };
  snapshot.versions.rojo = build.toolVersion;
  const originalPaths = new Map(
    capture.files.map((f) => [resolve(f.capturedPath), f.originalPath]),
  );
  const normalizeMap = (v: any): any =>
    Array.isArray(v)
      ? v.map(normalizeMap)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.entries(v).map(([k, x]) => [
              k,
              k === "filePaths" && Array.isArray(x)
                ? x.map(
                    (p) => originalPaths.get(resolve(String(p))) ?? String(p),
                  )
                : normalizeMap(x),
            ]),
          )
        : v;
  snapshot.inventory.rojo = {
    normalizedMapHash: hash(canonical(normalizeMap(map))),
    manifestHash: capture.manifestHash,
    outputHashes: build.outputHashes,
    files: capture.files.map(({ originalPath, sha256, byteLength }) => ({
      originalPath,
      sha256,
      byteLength,
    })),
  };
  snapshot.coverage.limitations.push(
    "Rojo input covers its configured project only; objects managed only inside Studio are not included.",
  );
  return snapshot;
}
export async function buildRojoSnapshot(
  projectPath: string,
  signal?: AbortSignal,
  excludedRoots: string[] = [],
): Promise<Snapshot> {
  const capture = await captureProject(projectPath, signal, excludedRoots);
  try {
    const build = await runRojoBuild(capture, signal),
      snapshot = await importPlace(build.placePath, signal);
    return await attachRojoProvenance(snapshot, build, capture);
  } finally {
    const owned = resolve(dirname(capture.root)),
      temporary = resolve(tmpdir());
    if (
      !owned.startsWith(temporary + sep) ||
      !/^rograph-capture-[a-z0-9_-]+$/i.test(basename(owned))
    )
      throw new Error("Unsafe capture cleanup target");
    await rm(owned, { recursive: true, force: true });
  }
}
