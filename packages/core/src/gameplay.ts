import type {
  Snapshot,
  Facts,
  Resolution,
  Site,
  Expr,
  RelationType,
  Instance,
} from "../../contracts/src/model.js";
import { FlowResolver } from "./flow-resolver.js";
import { alternatives, anchorIds } from "./analysis-values.js";
import type { Value } from "./resolver.js";
import { emptyResolution, emit, addNode } from "./resolution.js";
import { hash } from "./util.js";
const effects: Record<string, RelationType> = {
  Clone: "SPAWNS",
  Destroy: "DESTROYS",
  PivotTo: "TRANSFORMS",
  ScaleTo: "TRANSFORMS",
  MoveTo: "TRANSFORMS",
};
export function resolveGameplay(
  snapshot: Snapshot,
  facts: Facts[],
  resolutions: Resolution[],
): Resolution {
  const result = emptyResolution(),
    resolver = new FlowResolver(snapshot, facts);
  const siteMap = new Map(facts.flatMap((f) => f.sites).map((s) => [s.id, s]));
  const scriptOf = (id: string) => resolver.owners.get(id) ?? id;
  const entity = (id: string): string | undefined => {
    let current = resolver.objects.get(id),
      fallback = current?.id;
    while (current) {
      if (
        ["Model", "Tool", "ScreenGui", "SurfaceGui", "BillboardGui"].includes(
          current.className,
        )
      )
        return current.id;
      current = resolver.objects.get(current.parentId ?? "");
    }
    return fallback;
  };
  const witness = (e: Expr, f: Facts, seen = new Set<string>()): string[] => {
    if (seen.size > 32) return [];
    const found = f.sites
      .filter(
        (s) =>
          s.span.startByte === e.span.startByte &&
          s.span.endByte === e.span.endByte,
      )
      .map((s) => s.id);
    if (e.kind === "binding") {
      const id = String(e.bindingId);
      if (seen.has(id)) return found;
      const binding = resolver.bindings.get(id);
      if (binding?.initializer)
        found.push(...witness(binding.initializer, f, new Set([...seen, id])));
    }
    for (const key of [
      "base",
      "key",
      "callee",
      "left",
      "right",
      "value",
      "condition",
      "yes",
      "no",
    ]) {
      const value = e[key] as Expr | undefined;
      if (value && typeof value === "object" && value.kind && value.span)
        found.push(...witness(value, f, seen));
    }
    for (const arg of (e.args as Expr[]) ?? [])
      found.push(...witness(arg, f, seen));
    return [...new Set(found)];
  };
  const link = (
    source: string,
    target: string,
    type: RelationType,
    raw: Site,
    f: Facts,
    method: string,
    label: string,
    value?: Value,
  ) => {
    if (
      source === target ||
      !resolver.objects.has(source) ||
      !resolver.objects.has(target)
    )
      return;
    const support = [raw.id, ...witness(raw.expression, f)].filter((id) =>
      siteMap.has(id),
    );
    const guards = ((raw.expression.guards as Expr[]) ?? []).map(
      (g) => `${f.sourceId}:${g.span.startByte}-${g.span.endByte}`,
    );
    const conditional =
      !!value?.open ||
      value?.kind === "alternatives" ||
      guards.length > 0 ||
      value?.kind === "runtime";
    const id =
      "gameplay:" + hash([source, target, type, method, raw.id].join("|"));
    if (result.relations.some((r) => r.id === id)) return;
    const occurrence = emptyResolution();
    emit(
      occurrence,
      source,
      target,
      type,
      raw,
      "gameplay-" + type.toLowerCase(),
      method,
    );
    const lastEvidence = occurrence.evidence[0];
    lastEvidence.relationId = id;
    lastEvidence.id = raw.id + ":" + id;
    lastEvidence.status = conditional ? "candidate" : "resolved";
    if (value?.kind === "allocation")
      lastEvidence.assumptions.push(
        "This operation concerns objects created from the template, not mutation or existence of the saved template instance.",
      );
    if (conditional)
      lastEvidence.assumptions.push(
        "Conditional static flow; runtime values or branch conditions may select another target.",
      );
    result.evidence.push(lastEvidence);
    result.relations.push({
      id,
      source,
      target,
      type,
      gameplay: {
        label,
        method,
        sourceScriptId: f.scriptId,
        supportSiteIds: [...new Set(support)],
        guards,
        conditional,
        rule: "typed-object-flow",
        version: "1",
        ...(value?.kind === "allocation"
          ? { allocationId: value.id, templateId: value.templateId }
          : {}),
        ...(value?.rolePath ? { rolePath: value.rolePath } : {}),
      },
    });
  };
  for (const f of facts)
    for (const site of f.sites) {
      const e = site.expression;
      if (site.kind === "call") {
        const callee = resolver.get(e.callee as Expr, f),
          value = resolver.get(e, f);
        if (callee.kind === "signal-connect") {
          const signal = callee.signal,
            trigger = String(signal.id);
          link(
            trigger,
            f.scriptId,
            "TRIGGERS",
            site,
            f,
            String(signal.signal),
            String(signal.signal) + " → handler",
          );
          const players = snapshot.instances.find(
            (i) => i.className === "Players",
          );
          if (
            players &&
            [
              "Triggered",
              "MouseClick",
              "Activated",
              "MouseButton1Click",
            ].includes(signal.signal)
          ) {
            link(
              players.id,
              trigger,
              "CAN_INTERACT",
              site,
              f,
              signal.signal,
              "player can activate " + signal.signal,
            );
          }
          const subject = entity(trigger);
          if (subject && subject !== trigger)
            link(
              subject,
              f.scriptId,
              "TRIGGERS",
              site,
              f,
              String(signal.signal),
              "interaction handled by",
            );
        }
        for (const c of alternatives(callee))
          if (c.kind === "native" && effects[c.method]) {
            const receiver = c.receiverValue ?? {
              kind: "instance",
              id: c.receiver,
            };
            for (const id of anchorIds(receiver))
              link(
                f.scriptId,
                id,
                effects[c.method],
                site,
                f,
                c.method,
                c.method === "Clone" ? "clones" : c.method,
                receiver,
              );
          }
        if (
          callee.kind === "intrinsic" ||
          ["native", "signal-connect"].includes(callee.kind)
        ) {
          const values = alternatives(value),
            known = values.filter((v) =>
              [
                "instance",
                "allocation",
                "property",
                "scalar",
                "runtime",
                "signal",
                "collection",
              ].includes(v.kind),
            );
          if (known.length)
            result.sites.push({
              ...site,
              status:
                value.open || values.length > 1 ? "candidate" : "resolved",
              targetIds: anchorIds(value),
              reason: value.open ? "CONDITIONAL_RUNTIME_VALUE" : undefined,
              assumptions: [
                ...site.assumptions,
                "Platform operation recognized; static object/value flow is not an execution observation.",
              ],
            });
        }
      }
      if (site.kind === "read") {
        const value = resolver.get(e, f);
        for (const v of alternatives(value)) {
          if (
            (v.kind === "field" || (v.kind === "table" && v.fieldId)) &&
            v.scriptId &&
            v.scriptId !== f.scriptId
          ) {
            link(
              f.scriptId,
              v.scriptId,
              "READS_CONFIG",
              site,
              f,
              "config-read",
              "reads configuration",
              value,
            );
            const subject = entity(f.scriptId);
            if (subject && subject !== f.scriptId)
              link(
                subject,
                v.scriptId,
                "CONFIGURED_BY",
                site,
                f,
                "controller-config-read",
                "configured through " + resolver.objects.get(f.scriptId)?.name,
                value,
              );
          }
        }
      }
      if (site.kind === "write" && e.kind === "index") {
        const key = (e.key as Expr).value,
          base = resolver.get(e.base as Expr, f);
        if (
          [
            "Parent",
            "CFrame",
            "Position",
            "Size",
            "PrimaryPart",
            "Value",
            "Visible",
            "Text",
          ].includes(String(key))
        )
          for (const id of anchorIds(base)) {
            link(
              f.scriptId,
              id,
              key === "Parent" ? "REPARENTS" : "TRANSFORMS",
              site,
              f,
              "write " + key,
              "sets " + key,
              base,
            );
          }
      }
    }
  // Identity-matched channels carry their existing context/argument semantics.
  for (const pass of resolutions)
    for (const relation of pass.relations) {
      if (!["SENDS_VIA", "HANDLES", "CONNECTS_SIGNAL"].includes(relation.type))
        continue;
      const ev = pass.evidence.find((e) => e.relationId === relation.id),
        site = ev?.siteId ? siteMap.get(ev.siteId) : undefined;
      const source = scriptOf(relation.source),
        f = facts.find((f) => f.scriptId === source);
      if (!site || !f) continue;
      if (relation.type === "SENDS_VIA")
        link(
          source,
          relation.target,
          "TRIGGERS",
          site,
          f,
          ev?.mechanism ?? "send",
          "sends via",
        );
      else
        link(
          relation.target,
          source,
          "TRIGGERS",
          site,
          f,
          ev?.mechanism ?? "handler",
          "handled by",
        );
    }
  for (const object of resolver.created.values()) {
    const allocation = facts
      .flatMap((f) => f.sites.map((site) => ({ f, site })))
      .find(
        ({ f, site }) =>
          `created:${f.scriptId}:${site.span.startByte}` === object.id,
      );
    addNode(result, {
      id: object.id,
      kind: "instance",
      label: object.name,
      contexts: ["unknown"],
      attributes: {
        ...object,
        runtimeDefined: true,
        sourceId: allocation?.f.sourceId,
        scriptId: allocation?.f.scriptId,
        span: allocation?.site.span,
        meaning:
          "Named object defined by source; not present in the saved hierarchy.",
      },
    });
  }
  return result;
}
