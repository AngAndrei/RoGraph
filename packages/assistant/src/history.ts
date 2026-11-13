import type { AssistantResponse } from "../../contracts/src/assistant.js";
import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
export type HistoryTurn = { message: string; response: AssistantResponse };
export interface AssistantHistory {
  list(scope: string): Promise<HistoryTurn[]>;
  append(
    scope: string,
    message: string,
    response: AssistantResponse,
  ): Promise<void>;
  clear(scope: string): Promise<void>;
}
/** Private local history; scope strings never become paths or file names. */
export async function createHistory(root: string): Promise<AssistantHistory> {
  await mkdir(root, { recursive: true, mode: 0o700 });
  const stored = await Promise.all(
    (await readdir(root))
      .filter((name) => /^[a-f0-9]{64}\.json$/.test(name))
      .map(async (name) => ({
        key: name.slice(0, -5),
        modified: (await stat(join(root, name))).mtimeMs,
      })),
  );
  let keys = stored
    .sort((a, b) => a.modified - b.modified || a.key.localeCompare(b.key))
    .map((entry) => entry.key);
  for (const removed of keys.slice(0, Math.max(0, keys.length - 100)))
    await rm(join(root, `${removed}.json`), { force: true });
  keys = keys.slice(-100);
  const key = (scope: string) => {
    if (typeof scope !== "string" || scope.length === 0 || scope.length > 2048)
      throw Error("Invalid conversation scope");
    return createHash("sha256").update(scope).digest("hex");
  };
  let pending: Promise<unknown> = Promise.resolve();
  const enqueue = <T>(task: () => Promise<T>): Promise<T> => {
    const operation = pending.then(task);
    pending = operation.catch(() => {});
    return operation;
  };
  const read = async (id: string): Promise<HistoryTurn[]> => {
    try {
      const parsed: unknown = JSON.parse(
        await readFile(join(root, `${id}.json`), "utf8"),
      );
      if (
        !Array.isArray(parsed) ||
        parsed.some(
          (turn) =>
            !turn ||
            typeof turn.message !== "string" ||
            !turn.response ||
            typeof turn.response.text !== "string",
        )
      )
        throw Error("Invalid assistant history");
      return (parsed as HistoryTurn[]).slice(-20);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  };
  const save = async (id: string, turns: HistoryTurn[]) => {
    const temporary = join(root, `${id}-${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, JSON.stringify(turns), {
        encoding: "utf8",
        mode: 0o600,
        flag: "wx",
      });
      await rename(temporary, join(root, `${id}.json`));
      keys = [...keys.filter((item) => item !== id), id];
      for (const removed of keys.slice(0, Math.max(0, keys.length - 100)))
        await rm(join(root, `${removed}.json`), { force: true });
      keys = keys.slice(-100);
    } finally {
      await rm(temporary, { force: true });
    }
  };
  return {
    list: async (scope) => {
      const id = key(scope);
      await pending;
      return read(id);
    },
    append: async (scope, message, response) => {
      const id = key(scope),
        turn = structuredClone({ message, response });
      if (
        typeof message !== "string" ||
        !message.trim() ||
        message.length > 8000
      )
        throw Error("Invalid history message");
      await enqueue(async () => {
        const turns = [...(await read(id)), turn].slice(-20);
        await save(id, turns);
      });
    },
    clear: async (scope) => {
      const id = key(scope);
      await enqueue(async () => {
        await rm(join(root, `${id}.json`), { force: true });
        keys = keys.filter((item) => item !== id);
      });
    },
  };
}
