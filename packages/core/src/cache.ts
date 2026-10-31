import type { Source } from "../../contracts/src/model.js";
import type { ParsedSource } from "../../contracts/src/protocol.js";
import type { NativeSession } from "../../adapters/src/native.js";
import { mkdir, readFile, writeFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { parseSource, toolPath } from "../../adapters/src/native.js";
import { hash, canonical } from "./util.js";
const features =
  "comments-on-declaration-off-upstream-defaults-binary-nonfinite-diagnostics-v3";
let binary: Promise<string> | undefined;
export function createParseCache(
  dir: string,
  options?: {
    parserIdentity?: string;
    onParse?: (hit: boolean) => void;
    session?: NativeSession;
  },
) {
  return {
    async parseCached(
      source: Source,
      signal?: AbortSignal,
    ): Promise<ParsedSource> {
      signal?.throwIfAborted();
      if (hash(source.text) !== source.sha256)
        throw new Error("Source hash mismatch");
      const identity =
        options?.parserIdentity ??
        (await (binary ??= readFile(toolPath("luau-parser")).then(hash)));
      const key = hash(
          canonical({
            source: source.sha256,
            binary: identity,
            features,
            schema: 1,
          }),
        ),
        path = join(dir, key + ".json");
      await mkdir(dir, { recursive: true });
      try {
        const cached = JSON.parse(await readFile(path, "utf8"));
        if (
          cached.key !== key ||
          cached.payload.sha256 !== source.sha256 ||
          cached.payload.featureHash !== features ||
          hash(canonical(cached.payload)) !== cached.checksum
        )
          throw Error("Invalid cache");
        signal?.throwIfAborted();
        options?.onParse?.(true);
        return {
          ...cached.payload,
          scriptId: source.scriptId,
          sourceId: source.id,
        };
      } catch (e) {
        signal?.throwIfAborted();
      }
      options?.onParse?.(false);
      const { scriptId, sourceId, ...payload } = await parseSource(
          source,
          signal,
          options?.session,
        ),
        temporary = path + "." + randomUUID() + ".tmp";
      try {
        signal?.throwIfAborted();
        await writeFile(
          temporary,
          JSON.stringify({ key, payload, checksum: hash(canonical(payload)) }),
        );
        signal?.throwIfAborted();
        await rename(temporary, path);
      } finally {
        await rm(temporary, { force: true });
      }
      return { ...payload, scriptId: source.scriptId, sourceId: source.id };
    },
  };
}
const shared = createParseCache(join(tmpdir(), "rograph-parse-cache-v1"));
export const parseCached = shared.parseCached;
