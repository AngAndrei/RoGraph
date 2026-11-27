import { expect, it } from "vitest";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createJobs } from "../apps/local/src/jobs.js";
import { runNative } from "../packages/adapters/src/native.js";
import { openStore } from "../packages/core/src/store.js";
import { fixturePath } from "./support/fixtures.js";
import { withWorkspace } from "./support/workspace.js";

it("reports malformed and over-depth places separately without publishing either", async () =>
  withWorkspace(async (dir) => {
    const store = await openStore(join(dir, "graph.db"));
    const jobs = createJobs(store, dir);
    try {
      const fixture = fixturePath("shop/place.rbxlx");
      const first = jobs.start({ kind: "place", path: fixture }, "Original");
      await jobs.wait(first.id);
      const original = jobs.get(first.id);
      expect(original.status).toBe("complete");

      const cases = [
        {
          name: "malformed",
          xml: '<roblox version="4"><Item',
          code: "PLACE_DECODE_FAILED",
        },
        {
          name: "over depth",
          xml: `<roblox version="4">${'<Item class="Folder">'.repeat(260)}${"</Item>".repeat(260)}</roblox>`,
          code: "XML_DEPTH_LIMIT",
        },
      ];
      for (const { name, xml, code } of cases) {
        const path = join(dir, `${name}.rbxlx`);
        await writeFile(path, xml);
        const job = jobs.start({ kind: "place", path }, name);
        await jobs.wait(job.id);
        expect(jobs.get(job.id)).toMatchObject({
          status: "failed",
          progress: { stage: "import" },
          error: { code, message: expect.any(String) },
        });
        expect(jobs.get(job.id).analysisId).toBeUndefined();
        expect(await store.current()).toBe(original.analysisId);
      }
      expect((await store.listAnalyses(100)).items).toHaveLength(1);
    } finally {
      await jobs.close();
      await store.close();
    }
  }));

it("preserves the last complete snapshot on cancellation and allows a new import", async () =>
  withWorkspace(async (dir) => {
    const store = await openStore(join(dir, "graph.db"));
    const jobs = createJobs(store, dir);
    try {
      const seed = fixturePath("shop/place.rbxlx");
      const first = jobs.start({ kind: "place", path: seed }, "Original");
      await jobs.wait(first.id);
      const original = jobs.get(first.id).analysisId;
      expect(jobs.get(first.id).status).toBe("complete");

      const edited = join(dir, "edited.rbxlx");
      const xml = await readFile(seed, "utf8");
      await writeFile(
        edited,
        xml.replace("Config.Prices.Sword", "Config.Prices.Shield"),
      );
      const input = { kind: "place" as const, path: edited };
      const canceled = jobs.start(input, "Canceled");
      expect(jobs.cancel(canceled.id).status).toBe("canceling");
      await jobs.wait(canceled.id);
      expect(jobs.get(canceled.id)).toMatchObject({
        status: "canceled",
        error: { code: "CANCELED" },
      });
      expect(await store.current()).toBe(original);

      const retry = jobs.start(input, "Retry");
      await jobs.wait(retry.id);
      expect(jobs.get(retry.id).status).toBe("complete");
      expect(jobs.get(retry.id).analysisId).not.toBe(original);
      expect(await store.current()).toBe(jobs.get(retry.id).analysisId);
    } finally {
      await jobs.close();
      await store.close();
    }
  }));

it("distinguishes an unavailable helper from a place decoding failure", async () => {
  await expect(
    runNative("rograph-qa-nonexistent-helper", {}),
  ).rejects.toMatchObject({
    code: "NATIVE_HELPER_UNAVAILABLE",
  });
});
