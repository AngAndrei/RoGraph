import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
export const fixturePath = (name: string) => resolve("fixtures", name);
export async function readExpected(name: string): Promise<unknown> {
  return JSON.parse(await readFile(fixturePath(name), "utf8"));
}
