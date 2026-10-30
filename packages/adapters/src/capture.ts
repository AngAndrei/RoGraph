import {
  readdir,
  lstat,
  readFile,
  writeFile,
  mkdir,
  mkdtemp,
} from "node:fs/promises";
import { resolve, dirname, relative, join, isAbsolute, sep } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { parse, type ParseError } from "jsonc-parser";
const digest = (b: Buffer | string) =>
  createHash("sha256").update(b).digest("hex");
export interface ProjectCapture {
  root: string;
  projectPath: string;
  manifestHash: string;
  files: {
    originalPath: string;
    capturedPath: string;
    sha256: string;
    byteLength: number;
  }[];
  directories: string[];
}
export const contained = (root: string, path: string) => {
  const r = relative(root, path);
  return r !== ".." && !r.startsWith(".." + sep) && !isAbsolute(r);
};
export async function inventoryDirectory(
  root: string,
  signal?: AbortSignal,
  excludedRoots: string[] = [],
) {
  const files: { path: string; sha256: string; byteLength: number }[] = [];
  const directories: string[] = [];
  let size = 0;
  const scan = async (dir: string) => {
    signal?.throwIfAborted();
    const entries = await readdir(dir, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name, "en"));
    for (const entry of entries) {
      if (entry.name === ".git" || entry.name === ".rograph") continue;
      const path = join(dir, entry.name);
      if (excludedRoots.some((ex) => contained(resolve(ex), path))) continue;
      const info = await lstat(path);
      if (info.isSymbolicLink())
        throw new Error(
          "Project contains a symlink/reparse escape; select a contained project.",
        );
      if (info.isDirectory()) {
        directories.push(relative(root, path));
        await scan(path);
      } else if (info.isFile()) {
        if ((size += info.size) > 512 * 1024 * 1024 || files.length > 200000)
          throw new Error("Project capture size limit exceeded");
        const data = await readFile(path, { signal });
        files.push({
          path: relative(root, path),
          sha256: digest(data),
          byteLength: data.length,
        });
      } else throw new Error("Unsupported project file type");
    }
  };
  await scan(root);
  return {
    files,
    directories,
    manifestHash: digest(JSON.stringify({ files, directories })),
  };
}
export function parseProject(text: string): any {
  const errors: ParseError[] = [];
  const value = parse(text, errors, { allowTrailingComma: true });
  if (errors.length || !value)
    throw new Error("Invalid Rojo project/configuration JSON");
  return value;
}
function checkMounts(
  value: any,
  base: string,
  root: string,
  excludedRoots: string[] = [],
) {
  if (!value || typeof value !== "object") return;
  for (const [key, v] of Object.entries(value)) {
    if (key === "$path") {
      const path = typeof v === "string" ? v : (v as any)?.optional;
      if (typeof path !== "string")
        throw new Error("Unsupported Rojo path declaration");
      if (
        excludedRoots.some((ex) => contained(resolve(ex), resolve(base, path)))
      )
        throw new Error(
          "Rojo mount points into the analysis workspace; move the workspace outside game sources",
        );
      if (isAbsolute(path) || !contained(root, resolve(base, path)))
        throw new Error(
          "Rojo mount escapes outside the selected project directory",
        );
    } else checkMounts(v, base, root, excludedRoots);
  }
}
export async function captureProject(
  projectPath: string,
  signal?: AbortSignal,
  excludedRoots: string[] = [],
): Promise<ProjectCapture> {
  projectPath = resolve(projectPath);
  const originalRoot = dirname(projectPath);
  const project = parseProject(await readFile(projectPath, "utf8"));
  if (project.tree?.$className !== "DataModel")
    throw new Error("Rojo input must declare a DataModel root");
  if (excludedRoots.some((ex) => resolve(ex) === resolve(originalRoot)))
    throw new Error(
      "Use a dedicated analysis workspace, not the project source root",
    );
  const before = await inventoryDirectory(originalRoot, signal, excludedRoots);
  for (const file of before.files)
    if (/\.(project|meta)\.jsonc?$/.test(file.path))
      checkMounts(
        parseProject(await readFile(join(originalRoot, file.path), "utf8")),
        dirname(join(originalRoot, file.path)),
        originalRoot,
        excludedRoots,
      );
  const owned = await mkdtemp(join(tmpdir(), "rograph-capture-")),
    root = join(owned, "input");
  await mkdir(root);
  for (const dir of before.directories)
    await mkdir(join(root, dir), { recursive: true });
  const files: ProjectCapture["files"] = [];
  for (const file of before.files) {
    signal?.throwIfAborted();
    const originalPath = join(originalRoot, file.path),
      capturedPath = join(root, file.path);
    const data = await readFile(originalPath, { signal });
    if (digest(data) !== file.sha256)
      throw new Error("Project changed during capture; retry import.");
    await writeFile(capturedPath, data);
    files.push({
      originalPath,
      capturedPath,
      sha256: file.sha256,
      byteLength: file.byteLength,
    });
  }
  const after = await inventoryDirectory(originalRoot, signal, excludedRoots);
  if (after.manifestHash !== before.manifestHash)
    throw new Error("Project directory changed during capture; retry import.");
  return {
    root,
    projectPath: join(root, relative(originalRoot, projectPath)),
    manifestHash: before.manifestHash,
    files,
    directories: before.directories,
  };
}
