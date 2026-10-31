import {
  readdir,
  readFile,
  mkdir,
  copyFile,
  writeFile,
} from "node:fs/promises";
import { join, resolve, basename } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
const stage = resolve(process.argv[2] ?? ""),
  destination = join(stage, "notices");
await mkdir(destination, { recursive: true });
const records: {
  name: string;
  version: string;
  license: string;
  component?: string;
}[] = [];
async function licenseTree(dir: string, target: string) {
  await mkdir(target, { recursive: true });
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isFile())
      await copyFile(join(dir, entry.name), join(target, entry.name));
    else if (entry.isDirectory())
      await licenseTree(join(dir, entry.name), join(target, entry.name));
  }
}
async function licenseFiles(dir: string, target: string) {
  await mkdir(target, { recursive: true });
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (
      entry.isFile() &&
      /^(license|licence|copying|notice|copyright)(\.|$|-)/i.test(entry.name)
    )
      await copyFile(join(dir, entry.name), join(target, entry.name));
    else if (
      entry.isDirectory() &&
      /^(licenses?|licences?|notices?|copyrights?)$/i.test(entry.name)
    )
      await licenseTree(join(dir, entry.name), join(target, entry.name));
  }
}
async function packages(root: string) {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || !entry.isDirectory()) continue;
    const path = join(root, entry.name);
    if (entry.name.startsWith("@")) {
      await packages(path);
      continue;
    }
    let pkg: any;
    try {
      pkg = JSON.parse(await readFile(join(path, "package.json"), "utf8"));
    } catch {
      continue;
    }
    if (!/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i.test(pkg.name)) continue;
    records.push({
      name: pkg.name,
      version: pkg.version,
      license:
        typeof pkg.license === "string"
          ? pkg.license
          : JSON.stringify(pkg.licenses ?? "See package notices"),
    });
    await licenseFiles(path, join(destination, "npm", pkg.name));
    try {
      await packages(join(path, "node_modules"));
    } catch {}
  }
}
await packages(resolve("node_modules"));
for (const [source, name] of [
  ["vendor/luau/LICENSE.txt", "Luau-MIT.txt"],
  ["vendor/json-LICENSE.MIT", "nlohmann-json-MIT.txt"],
  ["vendor/rojo-LICENSE.txt", "Rojo-MPL-2.0.txt"],
  ["vendor/node-LICENSE", "Node-and-bundled-components.txt"],
  ["vendor/rust-LICENSE-MIT", "Rust-MIT.txt"],
  ["vendor/rust-LICENSE-APACHE", "Rust-APACHE-2.0.txt"],
  [
    "vendor/rust-COPYRIGHT-library.html",
    "Rust-standard-library-copyright.html",
  ],
])
  await copyFile(source, join(destination, name));
const cargo = process.env.ROGRAPH_CARGO ?? "cargo";
const rojoLockHash = createHash("sha256")
  .update(await readFile("vendor/rojo-source/Cargo.lock"))
  .digest("hex");
if (
  rojoLockHash !==
  "a1d2927ea6f74d9f63d21dce5ff7bf2427fa4121e7e46a594a8f6c3bdaafcde3"
)
  throw Error("ROJO_SOURCE_LOCK_MISMATCH");
for (const [manifest, component] of [
  ["native/rbx-import/Cargo.toml", "rbx-import"],
  ["vendor/rojo-source/Cargo.toml", "rojo"],
]) {
  const metadata = JSON.parse(
    (
      await promisify(execFile)(
        process.env.ROGRAPH_CARGO ?? cargo,
        [
          "metadata",
          "--manifest-path",
          manifest,
          "--locked",
          "--offline",
          "--filter-platform",
          "x86_64-pc-windows-msvc",
          "--format-version",
          "1",
        ],
        { windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
      )
    ).stdout,
  );
  for (const pkg of metadata.packages) {
    if (!pkg.source) continue;
    records.push({
      name: pkg.name,
      version: pkg.version,
      license: pkg.license ?? "See crate notices",
      component,
    });
    await licenseFiles(
      resolve(pkg.manifest_path, ".."),
      join(destination, "rust", pkg.name + "-" + pkg.version),
    );
  }
}
await writeFile(
  join(destination, "rojo-source-version.json"),
  JSON.stringify(
    {
      version: "7.7.1",
      commit: "26b6cc6d83ef068d356aac689110ad89f3b05d65",
      cargoLockSha256: rojoLockHash,
      source:
        "https://github.com/rojo-rbx/rojo/tree/26b6cc6d83ef068d356aac689110ad89f3b05d65",
    },
    null,
    2,
  ),
);
await writeFile(
  join(destination, "dependency-inventory.json"),
  JSON.stringify(
    records.sort((a, b) => a.name.localeCompare(b.name)),
    null,
    2,
  ),
);
await writeFile(
  join(destination, "SOURCE-OFFERS.txt"),
  "Rojo 7.7.1 is redistributed unmodified under MPL-2.0. Corresponding source: https://github.com/rojo-rbx/rojo/tree/v7.7.1\nLuau source: https://github.com/luau-lang/luau/tree/a4818b6678822bb726a0eb2299cae751d3017a6a\nThe inventory includes build/test dependencies as well as bundled runtime dependencies.\n",
);
