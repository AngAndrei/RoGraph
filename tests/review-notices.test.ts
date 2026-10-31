import { it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { withWorkspace } from "./support/workspace.js";
it("inventories the bundled Rojo release dependency closure with component notices", async () =>
  withWorkspace(async (directory) => {
    const localCargo = join(
      process.env.USERPROFILE ?? "",
      ".rustup/toolchains/stable-x86_64-pc-windows-msvc/bin/cargo.exe",
    );
    await promisify(execFile)(
      process.execPath,
      ["--import", "tsx", "scripts/collect-notices.ts", directory],
      {
        windowsHide: true,
        env: {
          ...process.env,
          ROGRAPH_CARGO:
            process.env.ROGRAPH_CARGO ??
            (existsSync(localCargo) ? localCargo : "cargo"),
        },
        timeout: 60000,
        maxBuffer: 1024 * 1024,
      },
    );
    const inventory = JSON.parse(
      await readFile(
        join(directory, "notices", "dependency-inventory.json"),
        "utf8",
      ),
    );
    for (const name of ["clap", "hyper", "reqwest", "tokio"])
      expect(inventory.some((p: any) => p.name === name)).toBe(true);
    expect(
      await readFile(
        join(directory, "notices", "rojo-source-version.json"),
        "utf8",
      ),
    ).toContain("7.7.1");
  }));
