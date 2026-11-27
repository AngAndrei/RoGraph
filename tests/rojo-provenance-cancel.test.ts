import { basename } from "node:path";
import { readFile } from "node:fs/promises";
import { expect, it, vi } from "vitest";
import {
  captureProject,
  removeProjectCapture,
} from "../packages/adapters/src/capture.js";
import { runRojoBuild } from "../packages/adapters/src/rojo.js";
import { importPlace } from "../packages/core/src/import.js";
import { attachRojoProvenance } from "../packages/core/src/rojo-import.js";
import { fixturePath } from "./support/fixtures.js";

vi.mock("node:fs/promises", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs/promises")>();
  return { ...fs, readFile: vi.fn(fs.readFile) };
});

it("stops both before mapping and while retaining a Rojo original", async () => {
  const capture = await captureProject(fixturePath("rojo/default.project.json"));
  try {
    const build = await runRojoBuild(capture);
    const snapshot = await importPlace(build.placePath);
    const early = new AbortController();
    const earlyReason = new Error("Canceled before mapping");
    early.abort(earlyReason);
    await expect(
      attachRojoProvenance(snapshot, build, capture, early.signal),
    ).rejects.toBe(earlyReason);

    const late = new AbortController();
    const lateReason = new Error("Canceled while retaining original");
    const fs = await vi.importActual<typeof import("node:fs/promises")>(
      "node:fs/promises",
    );
    let sourceReads = 0;
    const original = vi.mocked(readFile);
    original.mockImplementation(async (...[path, options]: Parameters<typeof readFile>) => {
      const bytes = await fs.readFile(path, options);
      // The first read is the integrity inventory, the second retains provenance.
      if (
        typeof path === "string" &&
        basename(path) === "PurchaseService.luau" &&
        ++sourceReads === 2
      )
        late.abort(lateReason);
      return bytes;
    });
    try {
      await expect(
        attachRojoProvenance(snapshot, build, capture, late.signal),
      ).rejects.toBe(lateReason);
    } finally {
      original.mockImplementation(fs.readFile);
    }
    expect(sourceReads).toBe(2);
  } finally {
    await removeProjectCapture(capture.root);
  }
});
