import { it, expect } from "vitest";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { withWorkspace } from "./support/workspace.js";
import { createModelManager } from "../apps/local/src/assistant/models.js";
import { parseGpuDevices, recommendModel } from "../apps/local/src/assistant/hardware.js";
import type { ModelCatalogEntry } from "../packages/contracts/src/assistant.js";

const weights = Buffer.from("verified local model weights");
const entry: ModelCatalogEntry = {
  id: "tiny", label: "Test model", parameters: "0.8B", description: "Fixture",
  fileName: "tiny.gguf", url: "https://huggingface.co/fixture/resolve/pinned/tiny.gguf",
  bytes: weights.length, sha256: createHash("sha256").update(weights).digest("hex"),
  recommendedRamGiB: 8, license: "Apache-2.0", upstream: "https://huggingface.co/fixture",
};
const download = async () => new Response(weights, { headers: { "Content-Length": String(weights.length) } });
async function finish(manager: Awaited<ReturnType<typeof createModelManager>>) {
  for (let i = 0; i < 200; i++) {
    const s = await manager.status();
    if (!s.download || ["complete", "failed", "cancelled"].includes(s.download.status)) return s;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw Error("Download did not finish");
}

it("installs verified weights atomically and persists the selected model/backend", async () => withWorkspace(async (dir) => {
  const manager = await createModelManager({ root: dir, catalog: [entry], runtimes: [], fetch: download });
  try {
    expect((await manager.status()).installed).toEqual([]);
    manager.install("tiny");
    expect((await finish(manager)).download?.status).toBe("complete");
    await manager.configure({ modelId: "tiny", backend: "cpu" });
    expect(await readFile(manager.modelPath("tiny"))).toEqual(weights);
    const reopened = await createModelManager({ root: dir, catalog: [entry], runtimes: [], fetch: download });
    try { expect(await reopened.status()).toMatchObject({ installed: ["tiny"], selectedId: "tiny", backend: "cpu" }); }
    finally { await reopened.close(); }
  } finally { await manager.close(); }
}));

it("rejects corrupt or oversized downloads and never selects incomplete weights", async () => withWorkspace(async (dir) => {
  const manager = await createModelManager({ root: dir, catalog: [entry], runtimes: [], fetch: async () => new Response(Buffer.alloc(weights.length + 1)) });
  try {
    manager.install("tiny");
    const status = await finish(manager);
    expect(status.download?.status).toBe("failed");
    expect(status.installed).toEqual([]);
    expect(status.selectedId).toBeUndefined();
    expect((await readdir(join(dir, "weights"))).filter((f) => f.endsWith(".part"))).toEqual([]);
    await expect(manager.configure({ modelId: "not-approved" })).rejects.toThrow();
    expect(() => manager.install("../escape")).toThrow();
  } finally { await manager.close(); }
}));

it("cancels an active stream and leaves the previously installed selection intact", async () => withWorkspace(async (dir) => {
  let slow = false;
  const second = { ...entry, id: "second", fileName: "second.gguf" };
  const manager = await createModelManager({ root: dir, catalog: [entry, second], runtimes: [], fetch: async () => slow
    ? new Response(new ReadableStream({ start(c) { c.enqueue(weights.subarray(0, 2)); }, cancel() {} }))
    : download() });
  try {
    manager.install("tiny"); await finish(manager);
    await manager.configure({ modelId: "tiny" });
    slow = true;
    const job = manager.install("second");
    await new Promise((r) => setTimeout(r, 20));
    manager.cancel(job.id);
    expect((await finish(manager)).download?.status).toBe("cancelled");
    expect(await manager.status()).toMatchObject({ installed: ["tiny"], selectedId: "tiny" });
  } finally { await manager.close(); }
}));

it("uses the runtime's actual compatible-device probe and gives memory guidance", () => {
  const devices = parseGpuDevices("Available devices:\n  Vulkan0: Intel(R) Iris(R) Xe Graphics (8040 MiB, 7382 MiB free)\n");
  expect(devices).toEqual([{ id: "Vulkan0", name: "Intel(R) Iris(R) Xe Graphics", memoryMiB: 8040 }]);
  expect(parseGpuDevices("Available devices:\n")).toEqual([]);
  expect(recommendModel([entry, { ...entry, id: "large", recommendedRamGiB: 32 }], 16)).toBe("tiny");
});
