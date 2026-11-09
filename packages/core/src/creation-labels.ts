import type { Expr, Facts, Span } from "../../contracts/src/model.js";

// Match the allocation expression itself, never a later alias of the object.
export function sameCreationCall(value: Expr | undefined, call: Expr) {
  if (value?.kind !== "call" || call.kind !== "call") return false;
  const a = value.callee as Expr,
    b = call.callee as Expr;
  const left = value.args as Expr[],
    right = call.args as Expr[];
  return (
    a.span.startByte === b.span.startByte &&
    a.span.endByte === b.span.endByte &&
    left.length === right.length &&
    left.every(
      (arg, i) =>
        arg.span.startByte === right[i].span.startByte &&
        arg.span.endByte === right[i].span.endByte,
    )
  );
}

export function creationBinding(facts: Facts, call: Expr) {
  const same = (e?: Expr) => sameCreationCall(e, call);
  const binding = facts.bindings.find(
    (binding) =>
      same(binding.initializer) ||
      binding.assignments.some((a) => same(a.value)),
  );
  if (binding) return binding.name;
  const global = (
    facts.globalAssignments as { name: string; value: Expr }[]
  ).find((a) => same(a.value));
  if (global) return global.name;
  const staticPath = (e: Expr): boolean =>
    e.kind === "binding" ||
    e.kind === "global" ||
    (e.kind === "index" &&
      (e.key as Expr).kind === "literal" &&
      typeof (e.key as Expr).value === "string" &&
      staticPath(e.base as Expr));
  const member = (facts.members as { target: Expr; value: Expr }[]).find(
    (a) => same(a.value) && staticPath(a.target),
  );
  return member ? String((member.target.key as Expr).value) : undefined;
}

// Compatibility for snapshots without binding metadata. The call offset comes
// from the original AST; only a direct assignment immediately before that call
// is accepted. Dynamic table slots and multi-value assignments stay unnamed.
export function retainedCreationBinding(
  source: Buffer,
  span: Pick<Span, "startByte" | "endByte"> | undefined,
) {
  const { startByte, endByte } = span ?? { startByte: -1, endByte: -1 };
  if (
    !Number.isSafeInteger(startByte) ||
    startByte < 0 ||
    startByte >= source.length
  )
    return undefined;
  if (
    !Number.isSafeInteger(endByte) ||
    endByte <= startByte ||
    endByte > source.length
  )
    return undefined;
  if (
    !/^[A-Za-z_]\w*(?:\s*\.\s*[A-Za-z_]\w*)*\s*\(/.test(
      source.subarray(startByte, startByte + 128).toString("utf8"),
    )
  )
    return undefined;
  let tail = source
    .subarray(endByte, endByte + 1024)
    .toString("utf8")
    .trimStart();
  while (tail.startsWith("--") && !/^--\[=*\[/.test(tail)) {
    const newline = tail.indexOf("\n");
    tail = newline < 0 ? "" : tail.slice(newline + 1).trimStart();
  }
  if (/^(?:\.|:|\[|\(|\+|-|\*|\/|%|\^|[~=<>|&?]|and\b|or\b)/.test(tail))
    return undefined;
  const before = source
    .subarray(Math.max(0, startByte - 1024), startByte)
    .toString("utf8");
  const target =
    /(?:^|[;\n])\s*(?:local\s+)?([A-Za-z_]\w*(?:(?:\s*\.\s*[A-Za-z_]\w*)|(?:\s*\[\s*"[A-Za-z_]\w*"\s*\])|(?:\s*\[\s*'[A-Za-z_]\w*'\s*\]))*)\s*(?::\s*[A-Za-z_][A-Za-z0-9_.?]*)?\s*=\s*$/.exec(
      before,
    )?.[1];
  return target?.match(/[A-Za-z_]\w*/g)?.at(-1);
}
