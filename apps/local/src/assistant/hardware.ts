import { cpus, totalmem, freemem, platform, arch } from "node:os";
import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import type { HardwareInfo, ModelCatalogEntry } from "../../../../packages/contracts/src/assistant.js";

export function parseGpuDevices(text: string): HardwareInfo["gpus"] {
  return [...text.matchAll(/^\s*(Vulkan\d+|CUDA\d+|Metal\d+):\s*(.+?)\s*\((\d+)\s*MiB[^\n]*\)/gm)]
    .map((m) => ({ id: m[1], name: m[2].trim(), memoryMiB: Number(m[3]) }));
}

export async function detectHardware(gpuRuntime?: string): Promise<HardwareInfo> {
  const info: HardwareInfo = {
    platform: platform(), arch: arch(), cpu: cpus()[0]?.model ?? "Unknown CPU",
    logicalCpus: cpus().length || 1, totalRamGiB: totalmem() / 2 ** 30,
    freeRamGiB: freemem() / 2 ** 30, gpus: [], gpuProbe: "not-installed", notes: [],
  };
  if (!gpuRuntime) { info.notes.push("Install a model to check compatible GPU support."); return info; }
  try { await access(gpuRuntime); }
  catch { info.notes.push("GPU runtime is not installed. CPU operation remains available."); return info; }
  try {
    const text = await new Promise<string>((accept, reject) => execFile(gpuRuntime, ["--list-devices"],
      { windowsHide: true, timeout: 10000, maxBuffer: 1024 * 1024 },
      (error, stdout, stderr) => error ? reject(error) : accept(stdout + "\n" + stderr)));
    info.gpus = parseGpuDevices(text);
    info.gpuProbe = info.gpus.length ? "available" : "unavailable";
    if (!info.gpus.length) info.notes.push("No compatible Vulkan GPU reported by the installed runtime.");
  } catch { info.gpuProbe = "unavailable"; info.notes.push("GPU driver/runtime probe failed. Auto can use CPU."); }
  return info;
}

export function recommendModel(catalog: ModelCatalogEntry[], ramGiB: number): string | undefined {
  const fitting = catalog.filter((m) => m.recommendedRamGiB <= ramGiB + 0.5);
  return (fitting.find((m) => m.parameters === "2B") ?? fitting[0] ?? catalog[0])?.id;
}
