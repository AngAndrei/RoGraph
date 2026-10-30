import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
export async function withWorkspace<T>(
  run: (path: string) => Promise<T>,
): Promise<T> {
  const path = await mkdtemp(join(tmpdir(), "rograph-test-"));
  try {
    return await run(path);
  } finally {
    if (
      !resolve(path).startsWith(resolve(tmpdir()) + "\\rograph-test-") &&
      !resolve(path).startsWith(resolve(tmpdir()) + "/rograph-test-")
    )
      throw new Error("Unsafe cleanup target");
    await rm(path, { recursive: true, force: true });
  }
}
