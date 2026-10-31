import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { createHash } from "node:crypto";
import { inventoryDirectory, type ProjectCapture } from "./capture.js";
import { toolPath } from "./native.js";
const exec = promisify(execFile),
  hash = (b: Buffer) => createHash("sha256").update(b).digest("hex");
export interface RojoBuild {
  placePath: string;
  sourcemapPath: string;
  toolVersion: string;
  inputManifestHash: string;
  outputHashes: { place: string; map: string };
}
export async function runRojoBuild(
  capture: ProjectCapture,
  signal?: AbortSignal,
): Promise<RojoBuild> {
  const executable = process.env.ROGRAPH_ROJO ?? toolPath("rojo");
  const options = {
    cwd: capture.root,
    windowsHide: true,
    signal,
    timeout: 120000,
    maxBuffer: 8 * 1024 * 1024,
  };
  if (
    (await inventoryDirectory(capture.root, signal)).manifestHash !==
    capture.manifestHash
  )
    throw new Error("Captured project changed before build");
  const version = (
    await exec(executable, ["--version"], options)
  ).stdout.trim();
  if (version !== "Rojo 7.7.1")
    throw new Error("RoGraph requires the tested Rojo 7.7.1 release.");
  const out = join(dirname(capture.root), "output");
  await mkdir(out, { recursive: true });
  const placePath = join(out, "place.rbxlx"),
    sourcemapPath = join(out, "sourcemap.json");
  await exec(
    executable,
    ["--color", "never", "build", capture.projectPath, "--output", placePath],
    options,
  );
  await exec(
    executable,
    [
      "--color",
      "never",
      "sourcemap",
      capture.projectPath,
      "--output",
      sourcemapPath,
      "--include-non-scripts",
      "--absolute",
    ],
    options,
  );
  if (
    (await inventoryDirectory(capture.root, signal)).manifestHash !==
    capture.manifestHash
  )
    throw new Error("Captured inputs changed during build/map generation");
  return {
    placePath,
    sourcemapPath,
    toolVersion: version,
    inputManifestHash: capture.manifestHash,
    outputHashes: {
      place: hash(await readFile(placePath)),
      map: hash(await readFile(sourcemapPath)),
    },
  };
}
