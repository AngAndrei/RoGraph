import type {
  ContextPack,
  Query,
} from "../../../packages/contracts/src/query.js";

/** One graph representation, with the pinned query retained for an external reader. */
export function compactContext(pack: ContextPack, scope: Query) {
  const value = {
    format: "rograph-context",
    version: 1,
    scope,
    data: pack.json,
    estimateMethod: "characters/4",
    estimatedTokens: 0,
    utf8Bytes: 0,
  };
  for (let i = 0; i < 8; i++) {
    const text = JSON.stringify(value);
    value.estimatedTokens = Math.ceil(text.length / 4);
    value.utf8Bytes = new TextEncoder().encode(text).length;
  }
  if (value.utf8Bytes > 32000)
    throw Error("Context exceeds the supported export size. Narrow its scope.");
  return value;
}

export function contextMarkdown(pack: ContextPack, scope: Query) {
  return [
    "# Export scope",
    "Bounded context from one saved snapshot; not the complete game graph.",
    "Query: " + JSON.stringify(scope),
    "",
    pack.markdown,
  ].join("\n");
}
