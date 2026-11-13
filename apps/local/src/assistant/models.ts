import { mkdir, readFile, writeFile, rename, rm, stat, access, statfs } from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { join, basename } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { execFile } from "node:child_process";
import catalogFile from "../../../../tools/assistant-models.lock.json" with { type: "json" };
import type { BackendPreference, ModelCatalogEntry, ModelStatus } from "../../../../packages/contracts/src/assistant.js";

export interface RuntimeArtifact { id: string; fileName: string; url: string; bytes: number; sha256: string }
export const modelCatalog: ModelCatalogEntry[] = catalogFile.models;
export const runtimeCatalog: RuntimeArtifact[] = catalogFile.runtimes;
type DownloadJob = NonNullable<ModelStatus["download"]>;
interface Preferences { selectedId?: string; backend: BackendPreference }
interface ModelOptions {
  root: string; catalog?: ModelCatalogEntry[]; runtimes?: RuntimeArtifact[];
  fetch?: (url: string, init?: RequestInit) => Promise<Response>;
  extract?: (archive: string, destination: string) => Promise<void>;
}
async function exists(path: string) { try { await access(path); return true; } catch { return false; } }
async function atomicJson(path: string, value: unknown) {
  const temp = path + "." + randomUUID() + ".tmp";
  try { await writeFile(temp, JSON.stringify(value), { mode: 0o600 }); await rename(temp, path); }
  finally { await rm(temp, { force: true }); }
}
export async function verifyArtifact(path: string, artifact: { bytes: number; sha256: string }): Promise<boolean> {
  try {
    if ((await stat(path)).size !== artifact.bytes) return false;
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(path)) hash.update(chunk);
    return hash.digest("hex") === artifact.sha256;
  } catch { return false; }
}
function trustedDownload(url: string) {
  const u = new URL(url);
  const domains = ["github.com", "githubusercontent.com", "huggingface.co", "hf.co"];
  if (u.protocol !== "https:" || u.username || u.password || !domains.some((d) => u.hostname === d || u.hostname.endsWith("." + d)))
    throw Error("Unapproved download destination");
}
async function approvedFetch(url: string, signal: AbortSignal, fetcher: NonNullable<ModelOptions["fetch"]>) {
  for (let hop = 0; hop < 6; hop++) {
    trustedDownload(url);
    const response = await fetcher(url, { signal, redirect: "manual" });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location) throw Error("Download redirect has no location");
      url = new URL(location, url).href;
    } else return response;
  }
  throw Error("Too many download redirects");
}
async function extractRuntime(archive: string, destination: string) {
  if (process.platform !== "win32") throw Error("This runtime pack supports Windows x64. Other platforms are not packaged yet.");
  // .NET rejects traversal entries; both paths are app-owned and the ZIP is SHA-256 verified.
  const quote = (text: string) => "'" + text.replaceAll("'", "''") + "'";
  const script = "Add-Type -AssemblyName System.IO.Compression.FileSystem; [IO.Compression.ZipFile]::ExtractToDirectory(" + quote(archive) + "," + quote(destination) + ")";
  await new Promise<void>((accept, reject) => execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script],
    { windowsHide: true, timeout: 120000, maxBuffer: 1024 * 1024 }, (error) => error ? reject(error) : accept()));
}

export async function createModelManager(options: ModelOptions) {
  const root = options.root, catalog = options.catalog ?? modelCatalog, runtimes = options.runtimes ?? runtimeCatalog;
  await mkdir(join(root, "weights"), { recursive: true });
  await mkdir(join(root, "downloads"), { recursive: true });
  const preferencesPath = join(root, "preferences.json");
  let preferences: Preferences = { backend: "auto" };
  try {
    const saved = JSON.parse(await readFile(preferencesPath, "utf8"));
    if (["auto", "cpu", "gpu"].includes(saved.backend)) preferences.backend = saved.backend;
    if (catalog.some((m) => m.id === saved.selectedId)) preferences.selectedId = saved.selectedId;
  } catch { /* First run or invalid preferences: no model is implicitly selected. */ }
  let job: DownloadJob | undefined, controller: AbortController | undefined, pending: Promise<void> | undefined, closing = false;
  const entry = (id: string) => { const value = catalog.find((m) => m.id === id); if (!value) throw Error("Choose an approved model from the catalog."); return value; };
  const modelPath = (id: string) => join(root, "weights", entry(id).fileName);
  const runtimePath = (id: string) => join(root, "runtimes", id, "llama-server.exe");
  const installed = async () => {
    const ids: string[] = [];
    for (const model of catalog) {
      try {
        const receipt = JSON.parse(await readFile(modelPath(model.id) + ".json", "utf8"));
        if (receipt.sha256 === model.sha256 && (await stat(modelPath(model.id))).size === model.bytes) ids.push(model.id);
      } catch { /* A partial file or absent receipt is not installed. */ }
    }
    return ids;
  };
  async function download(artifact: RuntimeArtifact | ModelCatalogEntry, path: string, signal: AbortSignal) {
    const part = path + ".part";
    let received = 0;
    try {
      const response = await approvedFetch(artifact.url, signal, options.fetch ?? fetch);
      if (!response.ok || !response.body) throw Error("Download failed (HTTP " + response.status + ")");
      const length = response.headers.get("content-length");
      if (length && Number(length) !== artifact.bytes) { await response.body.cancel(); throw Error("Unexpected artifact download size"); }
      const hash = createHash("sha256");
      const meter = new Transform({ transform(chunk, _encoding, callback) {
        received += chunk.length;
        if (received > artifact.bytes) return callback(Error("Download exceeds approved size"));
        hash.update(chunk);
        if (job) job.receivedBytes += chunk.length;
        callback(null, chunk);
      } });
      await pipeline(Readable.fromWeb(response.body as any), meter, createWriteStream(part, { flags: "w" }), { signal });
      if (job) job.status = "verifying";
      if (received !== artifact.bytes || hash.digest("hex") !== artifact.sha256) throw Error("Download checksum or size verification failed");
      signal.throwIfAborted();
      await rename(part, path);
    } finally { await rm(part, { force: true }); }
  }
  const api = {
    root, catalog, runtimes, modelPath, runtimePath,
    async status() {
      const ready = await installed();
      return { installed: ready, selectedId: ready.includes(preferences.selectedId ?? "") ? preferences.selectedId : undefined,
        backend: preferences.backend, download: job ? { ...job } : undefined };
    },
    async configure(value: { modelId?: string; backend?: BackendPreference }) {
      if (value.backend && !["auto", "cpu", "gpu"].includes(value.backend)) throw Error("Invalid backend preference");
      if (value.modelId !== undefined) {
        entry(value.modelId);
        if (!(await installed()).includes(value.modelId)) throw Error("Download this model before selecting it.");
      }
      preferences = { selectedId: value.modelId ?? preferences.selectedId, backend: value.backend ?? preferences.backend };
      await atomicJson(preferencesPath, preferences);
      return api.status();
    },
    install(modelId: string): DownloadJob {
      const model = entry(modelId);
      if (closing) throw Error("RoGraph is stopping");
      if (pending) throw Error("A model download is already active. Cancel or wait for it.");
      controller = new AbortController();
      const signal = controller.signal;
      job = { id: randomUUID(), modelId, status: "downloading", receivedBytes: 0,
        totalBytes: model.bytes + runtimes.reduce((n, r) => n + r.bytes, 0) };
      const current = job;
      pending = (async () => {
        try {
          const disk = await statfs(root);
          if (disk.bavail * disk.bsize < current.totalBytes * 1.1) throw Error("Not enough free disk space for this model and runtime.");
          for (const runtime of runtimes) {
            const target = join(root, "runtimes", runtime.id);
            const receiptPath = join(target, "installed.json");
            let ready = false;
            try { ready = JSON.parse(await readFile(receiptPath, "utf8")).sha256 === runtime.sha256 && await exists(runtimePath(runtime.id)); } catch { /* download */ }
            if (ready) { current.receivedBytes += runtime.bytes; continue; }
            const archive = join(root, "downloads", basename(runtime.fileName));
            if (await verifyArtifact(archive, runtime)) current.receivedBytes += runtime.bytes;
            else await download(runtime, archive, signal);
            const stage = target + "." + randomUUID() + ".tmp";
            await mkdir(stage, { recursive: true });
            try {
              await (options.extract ?? extractRuntime)(archive, stage);
              signal.throwIfAborted();
              if (!(await exists(join(stage, "llama-server.exe")))) throw Error("Runtime pack has no server executable");
              await mkdir(join(root, "runtimes"), { recursive: true });
              // Only app-owned catalog ID directories are replaced; no user paths are accepted.
              await rm(target, { recursive: true, force: true });
              await rename(stage, target);
              await atomicJson(receiptPath, { sha256: runtime.sha256 });
            } finally { await rm(stage, { recursive: true, force: true }); }
            current.status = "downloading";
          }
          if (await verifyArtifact(modelPath(modelId), model)) current.receivedBytes += model.bytes;
          else await download(model, modelPath(modelId), signal);
          signal.throwIfAborted();
          await atomicJson(modelPath(modelId) + ".json", { sha256: model.sha256, bytes: model.bytes });
          if (!preferences.selectedId) await api.configure({ modelId });
          current.status = "complete";
        } catch (error) {
          current.status = signal.aborted ? "cancelled" : "failed";
          current.error = signal.aborted ? undefined : (error as Error).message;
        } finally { pending = undefined; controller = undefined; }
      })();
      return { ...current };
    },
    cancel(id: string) { if (job?.id !== id) throw Error("Download was not found"); controller?.abort(); },
    async close() { closing = true; controller?.abort(); await pending; },
  };
  return api;
}
export type ModelManager = Awaited<ReturnType<typeof createModelManager>>;
