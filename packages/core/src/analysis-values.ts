import type { Value } from "./resolver.js";
export const VALUE_LIMIT = 32;
export function alternatives(v: Value): Value[] {
  return v.kind === "alternatives" ? v.values : [v];
}
export function joinValues(values: Value[], open = false): Value {
  if (
    values.length === 1 &&
    values[0].kind !== "alternatives" &&
    !open &&
    !values[0].open
  )
    return values[0];
  const unique = new Map<string, Value>();
  for (const v of values.flatMap(alternatives))
    unique.set(JSON.stringify(v), v);
  const all = [...unique.values()],
    tail =
      open ||
      values.some((v) => v.open) ||
      all.length > VALUE_LIMIT ||
      all.some((v) => v.open);
  if (all.length === 1 && !tail) return all[0];
  return {
    kind: "alternatives",
    values: all.slice(0, VALUE_LIMIT),
    open: tail,
    reason: tail ? "CONDITIONAL_OR_OPEN_VALUE" : undefined,
  };
}
export function anchorIds(v: Value): string[] {
  return [
    ...new Set(
      alternatives(v)
        .flatMap((x) =>
          x.kind === "allocation"
            ? [x.templateId ?? x.id]
            : ["instance", "module", "runtime"].includes(x.kind)
              ? [x.id]
              : x.kind === "field"
                ? [x.scriptId]
                : [],
        )
        .filter(Boolean),
    ),
  ];
}
export function primitive(v: Value): Value {
  return ["field", "property"].includes(v.kind) &&
    v.value !== undefined &&
    !v.runtime
    ? { kind: "literal", value: v.value }
    : v;
}
