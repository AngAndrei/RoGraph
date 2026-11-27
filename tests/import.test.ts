import { it, expect } from "vitest";
import { importPlace } from "../packages/core/src/import.js";
import { fixturePath } from "./support/fixtures.js";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { withWorkspace } from "./support/workspace.js";
it("normalizes the same input repeatably without merging duplicate names", async () => {
  const a = await importPlace(fixturePath("adversarial/duplicates.rbxlx"));
  const b = await importPlace(fixturePath("adversarial/duplicates.rbxlx"));
  expect(a.instances.map((i) => i.id)).toEqual(b.instances.map((i) => i.id));
  const p = a.instances.filter((i) => i.name === "Purchase");
  expect(p).toHaveLength(2);
  expect(p[0].id).not.toBe(p[1].id);
  expect(a.sources.find((s) => s.text.includes("TryPurchase"))?.text).toContain(
    "Service.TryPurchase(player, itemId)",
  );
  expect(a.coverage.partialImport).toBe(false);
});
it("retains incomplete import diagnostics rather than declaring completeness", async () => {
  const s = await importPlace(fixturePath("adversarial/partial.rbxlx"));
  expect(s.coverage.partialImport).toBe(true);
  expect(s.diagnostics.map((d) => d.code)).toContain("DANGLING_REFERENT");
  expect(s.inventory.rawInput.sha256).toBe(s.snapshotId);
});
it("does not begin a canceled import", async () => {
  const c = new AbortController();
  c.abort();
  await expect(
    importPlace(fixturePath("shop/place.rbxlx"), c.signal),
  ).rejects.toBeDefined();
});

it("normalizes binary Content object references to stable saved object IDs", async () =>
  withWorkspace(async (directory) => {
    const path = join(directory, "content.rbxl");
    const fixture = await readFile(
      fixturePath("binary/content-reference.rbxl.base64"),
      "utf8",
    );
    await writeFile(path, Buffer.from(fixture, "base64"));
    const first = await importPlace(path);
    const second = await importPlace(path);
    const target = first.instances.find((i) => i.name === "TargetObject")!;
    const content = (snapshot: typeof first) =>
      snapshot.instances.find((i) => i.name === "ContentOwner")?.properties
        .MeshContent;
    expect(content(first)).toEqual({
      type: "Content",
      value: { Object: target.id },
    });
    expect(content(second)).toEqual(content(first));
    expect(first.coverage.partialImport).toBe(false);
  }));

it("retains a partial snapshot with an owned diagnostic for missing XML shared data", async () =>
  withWorkspace(async (directory) => {
    const path = join(directory, "missing-shared.rbxlx");
    const hash = "AAAAAAAAAAAAAAAAAAAAAA==";
    await writeFile(
      path,
      `<roblox version="4"><Item class="Folder" referent="f"><Properties><SharedString name="Payload">${hash}</SharedString></Properties></Item></roblox>`,
    );
    const snapshot = await importPlace(path);
    const folder = snapshot.instances.find((i) => i.className === "Folder")!;
    expect(snapshot.coverage.partialImport).toBe(true);
    expect(snapshot.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "DANGLING_SHARED_PAYLOAD",
        ownerId: folder.id,
      }),
    );
    expect(folder.properties.Payload).toEqual({
      type: "SharedString",
      value: { unresolvedHash: hash },
      unsupported: true,
    });
  }));
