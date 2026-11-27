import { it, expect, vi } from "vitest";
import { mkdtemp, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { captureProject } from "../packages/adapters/src/capture.js";
import { withWorkspace } from "./support/workspace.js";

vi.mock("node:fs/promises", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs/promises")>();
  return { ...fs, mkdtemp: vi.fn(fs.mkdtemp), writeFile: vi.fn(fs.writeFile) };
});

it.each(["copy failure", "cancellation"])(
  "removes an incomplete capture and preserves the %s",
  async (failure) => {
    const fs = await vi.importActual<typeof import("node:fs/promises")>(
      "node:fs/promises",
    );
    await withWorkspace(async (directory) => {
      const projectPath = join(directory, "default.project.json");
      const contents = JSON.stringify({ name: "Cleanup", tree: { $className: "DataModel" } });
      await writeFile(projectPath, contents);
      const controller = new AbortController();
      const cause = new Error(`Expected ${failure}`);
      let owned: string | undefined;
      vi.mocked(mkdtemp).mockImplementationOnce(async (prefix) => {
        const directory = await fs.mkdtemp(prefix);
        owned = directory;
        if (failure === "cancellation") controller.abort(cause);
        return directory;
      });
      if (failure === "copy failure")
        vi.mocked(writeFile).mockRejectedValueOnce(cause);
      try {
        await expect(captureProject(projectPath, controller.signal)).rejects.toBe(cause);
        expect(owned).toBeDefined();
        await expect(stat(owned!)).rejects.toMatchObject({ code: "ENOENT" });
        expect(await fs.readFile(projectPath, "utf8")).toBe(contents);
      } finally {
        if (owned) {
          const target = resolve(owned);
          if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith("rograph-capture-"))
            throw new Error("Unexpected capture test cleanup target");
          await fs.rm(target, { recursive: true, force: true });
        }
      }
    });
  },
);
