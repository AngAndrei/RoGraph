import type { ContextPack } from "../../../packages/contracts/src/query.js";

/** A single representation for external-model input; legacy API envelopes stay unchanged. */
export function compactContext(pack: ContextPack) {
  const value = { format: "rograph-context", version: 1, data: pack.json,
    estimateMethod: "characters/4", estimatedTokens: 0, utf8Bytes: 0 };
  for (let i = 0; i < 8; i++) {
    const text = JSON.stringify(value);
    value.estimatedTokens = Math.ceil(text.length / 4);
    value.utf8Bytes = new TextEncoder().encode(text).length;
  }
  if (value.utf8Bytes > 32000) throw Error("Context exceeds the supported export size. Narrow its scope.");
  return value;
}
