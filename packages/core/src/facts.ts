import type { Snapshot, Facts } from "../../contracts/src/model.js";
import { parseSource } from "../../adapters/src/native.js";
import { lowerAst } from "./ast-lowering.js";
export { lowerAst };
export async function extractFacts(
  snapshot: Snapshot,
  signal?: AbortSignal,
): Promise<Facts[]> {
  const facts: Facts[] = [];
  for (const source of snapshot.sources) {
    signal?.throwIfAborted();
    facts.push(lowerAst(await parseSource(source, signal)));
  }
  return facts;
}
