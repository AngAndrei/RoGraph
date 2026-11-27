import { tmpdir } from "node:os";
import { readFile, realpath, mkdir, writeFile } from "node:fs/promises";
import { resolve, relative, join } from "node:path";
import { setImmediate } from "node:timers/promises";
import type { Instance, Snapshot, Source } from "../../contracts/src/model.js";
import {
  captureProject,
  inventoryDirectory,
  parseProject,
  removeProjectCapture,
  type ProjectCapture,
} from "../../adapters/src/capture.js";
import { runRojoBuild, type RojoBuild } from "../../adapters/src/rojo.js";
import { importPlace } from "./import.js";
import { hash, canonical } from "./util.js";
import { defaultLimits } from "./limits.js";

type CapturedFile = ProjectCapture["files"][number];
const isModel = (file: CapturedFile) => /\.rbxmx?$/i.test(file.originalPath);
const isLua = (file: CapturedFile) => /\.(lua|luau)$/i.test(file.originalPath);
const readOriginal = async (file: CapturedFile, signal?: AbortSignal) => {
  const bytes = await readFile(file.capturedPath, { signal });
  signal?.throwIfAborted();
  if (hash(bytes) !== file.sha256)
    throw new Error("Captured original changed before provenance retention");
  return bytes;
};
const readText = (bytes: Buffer) =>
  new TextDecoder("utf8", { fatal: true, ignoreBOM: true }).decode(bytes);

export async function attachRojoProvenance(
  snapshot: Snapshot,
  build: RojoBuild,
  capture: ProjectCapture,
  signal?: AbortSignal,
): Promise<Snapshot> {
  signal?.throwIfAborted();
  const mapBytes = await readFile(build.sourcemapPath, { signal });
  signal?.throwIfAborted();
  if (
    snapshot.snapshotId !== build.outputHashes.place ||
    hash(mapBytes) !== build.outputHashes.map ||
    (await inventoryDirectory(capture.root, signal)).manifestHash !==
      build.inputManifestHash
  )
    throw new Error("Stale or mixed Rojo build/sourcemap revision");
  const map = JSON.parse(mapBytes.toString("utf8"));
  if (map?.className !== "DataModel")
    throw new Error("Invalid Rojo sourcemap root");
  const root = snapshot.instances.find((i) => i.synthetic)!;
  const diagnostics = snapshot.diagnostics;
  const canonicalRoot = await realpath(capture.root);
  signal?.throwIfAborted();
  const filesByPath = new Map<string, CapturedFile>();
  for (const file of capture.files) {
    filesByPath.set(resolve(file.capturedPath), file);
    // Rojo canonicalizes the capture root, which can change the spelling of
    // a Windows path. Keep the exact captured suffix in both indexes.
    filesByPath.set(
      join(canonicalRoot, relative(capture.root, file.capturedPath)),
      file,
    );
  }
  const projectFile = filesByPath.get(resolve(capture.projectPath))!;
  const projectText = readText(await readOriginal(projectFile, signal));
  const project = parseProject(projectText);
  const sourcesById = new Map(snapshot.sources.map((s) => [s.id, s]));
  const children = new Map<string, Map<string, Instance[]>>();
  const key = (o: { name: string; className: string }) =>
    JSON.stringify([o.name, o.className]);
  for (const object of snapshot.instances) {
    if (!object.parentId) continue;
    let siblings = children.get(object.parentId);
    if (!siblings) children.set(object.parentId, (siblings = new Map()));
    const signature = key(object);
    const matches = siblings.get(signature) ?? [];
    matches.push(object);
    siblings.set(signature, matches);
  }
  // Rojo's generated place is temporary. Keep an honest origin even when
  // its sourcemap cannot identify a unique original for a script.
  for (const source of snapshot.sources)
    source.origin = {
      kind: "generated",
      path: projectFile.originalPath,
      mapping: "unavailable",
    };
  const visitedSources = new Set<string>();
  const binaryOrigins = new Map<string, Source["origin"]["originalBinary"]>();
  let remainingSharedText = defaultLimits.scriptBytes,
    sharedTextOmitted = false,
    ambiguous = false;
  const reportAmbiguity = (message: string, ownerId: string) => {
    ambiguous = true;
    diagnostics.push({
      code: "ROJO_MAP_AMBIGUOUS",
      severity: "warning",
      message,
      ownerId,
    });
  };
  const retainOrigin = async (source: Source, file: CapturedFile) => {
    const binary = /\.rbxm$/i.test(file.originalPath);
    const sharedText = file === projectFile || isModel(file);
    let originalBinary = binaryOrigins.get(file.sha256);
    let text: string | undefined;
    if (binary && !originalBinary) {
      const bytes = await readOriginal(file, signal);
      const directory = join(tmpdir(), "rograph-blobs");
      await mkdir(directory, { recursive: true });
      const blobPath = join(directory, file.sha256 + ".rbxm");
      signal?.throwIfAborted();
      // Once writing starts, finish the content-addressed blob for other imports.
      await writeFile(blobPath, bytes);
      signal?.throwIfAborted();
      originalBinary = {
        encoding: "binary",
        mediaType: "application/x-roblox-model",
        sha256: file.sha256,
        byteLength: file.byteLength,
        blobPath,
      };
      binaryOrigins.set(file.sha256, originalBinary);
    } else if (!binary) {
      if (sharedText && file.byteLength > remainingSharedText)
        sharedTextOmitted = true;
      else {
        text =
          file === projectFile
            ? projectText
            : readText(await readOriginal(file, signal));
        if (sharedText) remainingSharedText -= file.byteLength;
      }
    }
    const matches = isLua(file) && text?.replace(/\r\n/g, "\n") === source.text;
    source.origin = {
      kind: matches ? "file" : "generated",
      path: file.originalPath,
      originalPath: file.originalPath,
      originalSha256: file.sha256,
      originalText: text,
      ...(originalBinary ? { originalBinary } : {}),
      mapping: matches
        ? text === source.text
          ? "identity"
          : "crlf-to-lf"
        : "unavailable",
    };
  };
  let mappedNodes = 0;
  const walk = async (
    m: any,
    object: Instance,
    projectNode: any,
    enclosingModel?: CapturedFile,
  ) => {
    if (signal && ++mappedNodes % defaultLimits.cancelBatchRecords === 0)
      await setImmediate();
    signal?.throwIfAborted();
    if (typeof m.name !== "string" || typeof m.className !== "string")
      throw new Error("Invalid sourcemap node");
    const paths = (m.filePaths ?? []).filter(
      (p: unknown): p is string => typeof p === "string",
    ) as string[];
    const candidates = [
      ...new Set(
        paths.flatMap((path) => {
          const file = filesByPath.get(resolve(path));
          return file &&
            /\.(lua|luau|jsonc?|toml|rbxmx?)$/i.test(file.originalPath)
            ? [file]
            : [];
        }),
      ),
    ];
    const direct = candidates.length === 1 ? candidates[0] : undefined;
    const inherited =
      !paths.length && !projectNode ? enclosingModel : undefined;
    const model = direct && isModel(direct) ? direct : inherited;
    if (object.sourceId) {
      const source = sourcesById.get(object.sourceId)!;
      visitedSources.add(source.id);
      const inline = projectNode?.$properties?.Source;
      if (
        typeof inline === "string" &&
        inline.replace(/\r\n/g, "\n") === source.text
      )
        await retainOrigin(source, projectFile);
      else if (direct || inherited)
        await retainOrigin(source, direct ?? inherited!);
      else
        reportAmbiguity(
          `No unique original file mapping for ${object.name}`,
          object.id,
        );
    }
    const mapChildren = m.children ?? [];
    const mapCounts = new Map<string, number>();
    for (const child of mapChildren) {
      const signature = key(child);
      mapCounts.set(signature, (mapCounts.get(signature) ?? 0) + 1);
    }
    for (const child of mapChildren) {
      const signature = key(child);
      const objects = children.get(object.id)?.get(signature);
      if (objects?.length === 1 && mapCounts.get(signature) === 1)
        await walk(child, objects[0], projectNode?.[child.name], model);
      else if (mapCounts.has(signature)) {
        mapCounts.delete(signature);
        reportAmbiguity(
          `Ambiguous hierarchy mapping for ${child.name}`,
          object.id,
        );
      }
    }
  };
  await walk(map, root, project.tree);
  signal?.throwIfAborted();
  for (const source of snapshot.sources)
    if (!visitedSources.has(source.id))
      reportAmbiguity(
        "No unique sourcemap node for this script",
        source.scriptId,
      );
  if (ambiguous)
    snapshot.coverage.limitations.push(
      "Some Rojo objects lack a unique sourcemap or original file mapping. Available built script text is still analyzed.",
    );
  if (sharedTextOmitted)
    snapshot.coverage.limitations.push(
      "Some repeated Rojo project or model originals are represented by file path and hash because their retained text exceeds the analysis budget.",
    );
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
    projectPath: projectFile.originalPath,
  };
  snapshot.versions.rojo = build.toolVersion;
  snapshot.versions.rojoProvenance = "2";
  const normalizeMap = (v: any): any =>
    Array.isArray(v)
      ? v.map(normalizeMap)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.entries(v).map(([k, x]) => [
              k,
              k === "filePaths" && Array.isArray(x)
                ? x.map(
                    (p) =>
                      filesByPath.get(resolve(String(p)))?.originalPath ??
                      String(p),
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
  let snapshot: Snapshot;
  try {
    const build = await runRojoBuild(capture, signal);
    snapshot = await attachRojoProvenance(
      await importPlace(build.placePath, signal),
      build,
      capture,
      signal,
    );
  } catch (error) {
    await removeProjectCapture(capture.root).catch(() => {});
    throw error;
  }
  await removeProjectCapture(capture.root);
  signal?.throwIfAborted();
  return snapshot;
}
