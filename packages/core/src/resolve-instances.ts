import type {
  Snapshot,
  Facts,
  Resolution,
  Expr,
} from "../../contracts/src/model.js";
import { FlowResolver as Resolver } from "./flow-resolver.js";
import { emptyResolution, mark, emit, addNode } from "./resolution.js";
import { resolveContexts } from "./execution-context.js";
import { alternatives } from "./analysis-values.js";
export function resolveInstances(
  snapshot: Snapshot,
  facts: Facts[],
): Resolution {
  const result = emptyResolution(),
    resolver = new Resolver(snapshot, facts);
  for (const f of facts)
    for (const site of f.sites) {
      const e = site.expression;
      if (site.kind === "call") {
        const callee = resolver.get(e.callee as Expr, f);
        if (callee.kind === "builtin" && callee.name === "require") {
          const target = resolver.requireTarget((e.args as Expr[])[0], f);
          const s = mark(result, site, target);
          for (const value of alternatives(target))
            if (value.kind === "external")
              addNode(result, {
                id: value.id!,
                kind: "external",
                label: `Asset module ${value.assetId}`,
                contexts: ["unknown"],
                attributes: { assetId: value.assetId, sourceAvailable: false },
              });
          if (target.kind === "module" || target.kind === "external")
            emit(
              result,
              site.ownerId,
              target.id!,
              "REQUIRES",
              s,
              target.kind === "module"
                ? "require-saved-module"
                : "require-asset-id",
            );
        } else if (callee.kind === "native") {
          const target = resolver.get(e, f),
            s = mark(result, site, target);
          if (target.kind === "instance")
            emit(
              result,
              site.ownerId,
              target.id!,
              "REFERENCES",
              s,
              "saved-instance-lookup",
            );
        }
      }
      if (site.kind === "read") {
        const target = resolver.get(e, f);
        if (target.kind === "instance") {
          const s = mark(result, site, target);
          emit(
            result,
            site.ownerId,
            target.id!,
            "REFERENCES",
            s,
            "saved-instance-path",
          );
        } else if (target.kind === "unknown" || target.kind === "alternatives")
          mark(result, site, target);
      }
    }
  const contexts = resolveContexts(snapshot, facts, result);
  for (const s of result.sites)
    s.contexts = contexts.get(s.ownerId) ?? ["unknown"];
  for (const e of result.evidence)
    e.contexts = contexts.get(
      result.sites.find((s) => s.id === e.siteId)?.ownerId ?? "",
    ) ?? ["unknown"];
  return result;
}
