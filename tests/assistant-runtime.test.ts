import { it, expect } from "vitest";
import { parseIntentOutput, chooseBackend, usesGpuLayers, LocalModelRuntime } from "../apps/local/src/assistant/runtime.js";
import { createModelManager } from "../apps/local/src/assistant/models.js";
import { withWorkspace } from "./support/workspace.js";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

it("accepts only a bounded intent rather than executable model output or a replacement snapshot", () => {
  expect(parseIntentOutput('{"op":"trace","from":"BuySword","to":"Prices.Sword","view":"code"}'))
    .toEqual({ op: "trace", from: "BuySword", to: "Prices.Sword", view: "code" });
  expect(() => parseIntentOutput('{"op":"search","analysisId":"another-game"}')).toThrow();
  expect(() => parseIntentOutput('{"op":"shell","command":"anything"}')).toThrow();
  expect(() => parseIntentOutput('{"op":"search","text":"' + "x".repeat(9000) + '"}')).toThrow();
  expect(() => parseIntentOutput("No JSON here")).toThrow();
  expect(() => parseIntentOutput('{"op":"search","view":"code"}')).toThrow(/search/i);
});

it("chooses compatible offload only when available and reports explicit GPU unavailability", () => {
  expect(chooseBackend("auto", false)).toBe("cpu");
  expect(chooseBackend("cpu", true)).toBe("cpu");
  expect(chooseBackend("auto", true)).toBe("gpu");
  expect(() => chooseBackend("gpu", false)).toThrow(/GPU/);
});

it("recognizes layer placement in legacy and current runtime diagnostics", () => {
  expect(usesGpuLayers("offloaded 25/25 layers to GPU")).toBe(true);
  expect(usesGpuLayers("resolve_fused_ops: layer 3 is assigned to device Vulkan0 but Flash Attention is assigned to device CPU")).toBe(true);
  expect(usesGpuLayers("offloaded 0/25 layers to GPU")).toBe(false);
  expect(usesGpuLayers("Available devices: Vulkan0")).toBe(false);
});

it("refreshes an absent-runtime probe after installation makes the GPU runtime available", async () => withWorkspace(async (root) => {
  const manager = await createModelManager({ root, catalog: [], runtimes: [] });
  let installed = false;
  const runtime = new LocalModelRuntime(manager, async () => ({ platform: "win32", arch: "x64", cpu: "Fixture CPU",
    logicalCpus: 4, totalRamGiB: 16, freeRamGiB: 8, notes: [], gpuProbe: installed ? "available" : "not-installed",
    gpus: installed ? [{ id: "Vulkan0", name: "Fixture GPU" }] : [] }));
  try {
    expect((await runtime.hardware()).gpuProbe).toBe("not-installed");
    await mkdir(dirname(manager.runtimePath("vulkan")), { recursive: true });
    await writeFile(manager.runtimePath("vulkan"), "test boundary, never executed"); installed = true;
    expect((await runtime.hardware()).gpus).toEqual([{ id: "Vulkan0", name: "Fixture GPU" }]);
  } finally { await runtime.close(); await manager.close(); }
}));
