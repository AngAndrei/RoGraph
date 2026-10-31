import type {
  Snapshot,
  Facts,
  Resolution,
  Expr,
} from "../../contracts/src/model.js";
import { FlowResolver as ModuleResolver } from "./flow-resolver.js";
import { emptyResolution, mark, emit, addNode } from "./resolution.js";
import { resolveContexts } from "./execution-context.js";
export function resolveCalls(
  snapshot: Snapshot,
  facts: Facts[],
  instances: Resolution,
): Resolution {
  const result = emptyResolution(),
    resolver = new ModuleResolver(snapshot, facts),
    contexts = resolveContexts(snapshot, facts, instances),
    already = new Set(
      instances.sites.filter((s) => s.status === "resolved").map((s) => s.id),
    );
  for (const f of facts)
    for (const symbol of f.symbols)
      addNode(result, {
        id: symbol.id,
        kind: "function",
        ownerId: f.scriptId,
        label: `${resolver.objects.get(f.scriptId)!.name}.${symbol.name}`,
        contexts: contexts.get(f.scriptId) ?? ["unknown"],
        attributes: {
          scriptId: f.scriptId,
          sourceId: f.sourceId,
          span: symbol.span,
          parameters: symbol.parameters,
        },
      });
  const builtins = new Set([
    "print",
    "warn",
    "error",
    "assert",
    "type",
    "typeof",
    "tostring",
    "tonumber",
    "select",
    "unpack",
    "pairs",
    "ipairs",
    "next",
  ]);
  for (const f of facts)
    for (const raw of f.sites.filter(
      (s) => s.kind === "call" && !already.has(s.id),
    )) {
      const site = {
          ...raw,
          contexts: contexts.get(raw.ownerId) ?? ["unknown"],
        },
        callee = resolver.callable(
          resolver.get(site.expression.callee as Expr, f),
        );
      if (callee.kind === "intrinsic") {
        result.sites.push({
          ...site,
          status: "resolved",
          reason: undefined,
          targetIds: [],
          assumptions: [
            ...site.assumptions,
            `Recognized platform operation: ${callee.path}; not a project dependency.`,
          ],
        });
      } else if (callee.kind === "function") {
        const s = mark(result, site, callee);
        if (site.expression.colon)
          s.assumptions.push(
            "Colon call supplies its receiver as the first argument.",
          );
        emit(
          result,
          site.ownerId,
          callee.id!,
          "CALLS",
          s,
          "lexical-exported-function",
        );
      } else if (callee.kind === "builtin" && builtins.has(callee.name)) {
        const id = `external:builtin:${callee.name}`;
        addNode(result, {
          id,
          kind: "external",
          label: `Luau ${callee.name}`,
          contexts: ["unknown"],
          attributes: { builtin: true },
        });
        const s = mark(result, site, { kind: "external", id });
        emit(result, site.ownerId, id, "CALLS", s, "known-builtin");
      } else if (callee.kind !== "native" && callee.name !== "require")
        mark(
          result,
          site,
          callee.kind === "unknown"
            ? callee
            : { kind: "unknown", reason: "NON_CALLABLE_TARGET" },
        );
    }
  return result;
}
