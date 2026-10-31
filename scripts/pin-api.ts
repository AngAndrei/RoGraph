import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const raw = await readFile("build/roblox-api-dump.json"),
  version = (await readFile("build/roblox-api-version.txt", "utf8")).trim();
const dump = JSON.parse(raw.toString("utf8"));
const data = {
  version,
  sha256: createHash("sha256").update(raw).digest("hex"),
  source: `https://setup.rbxcdn.com/${version}-API-Dump.json`,
  classes: Object.fromEntries(
    dump.Classes.map((c: any) => [
      c.Name,
      {
        parent: c.Superclass,
        members: Object.fromEntries(
          c.Members.map((m: any) => [m.Name, m.MemberType]),
        ),
      },
    ]),
  ),
};
await writeFile("packages/core/src/api-members.json", JSON.stringify(data));
process.stdout.write(
  JSON.stringify({
    version,
    sha256: data.sha256,
    classes: Object.keys(data.classes).length,
  }) + "\n",
);
