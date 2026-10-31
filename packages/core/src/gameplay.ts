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
import type { GameplayRelation } from "../../contracts/src/gameplay.js";
import { emptyResolution, emit, addNode } from "./resolution.js";
import { hash } from "./util.js";
import { gameplayScopes } from "./gameplay-scopes.js";
const effects: Record<string, RelationType> = {
  Clone: "SPAWNS",
  Destroy: "DESTROYS",
  PivotTo: "TRANSFORMS",
  ScaleTo: "TRANSFORMS",
  MoveTo: "TRANSFORMS",
  SetAttribute: "MODIFIES",
};
export function resolveGameplay(
  snapshot: Snapshot,
  facts: Facts[],
  resolutions: Resolution[],
): Resolution {
  const result = emptyResolution(),
    resolver = new FlowResolver(snapshot, facts);
  const siteMap = new Map(facts.flatMap((f) => f.sites).map((s) => [s.id, s]));
  const relationIds = new Set<string>();
  const scopes = gameplayScopes(facts, resolutions, resolver);
  const factsBySource = new Map(facts.map((f) => [f.sourceId, f]));
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
    details: Partial<GameplayRelation> = {},
  ) => {
    if (
      source === target ||
      !resolver.objects.has(source) ||
      !resolver.objects.has(target)
    )
      return;
    const support = [
      raw.id,
      ...witness(raw.expression, f),
      ...(value?.payloadSiteIds ?? []),
    ].filter((id) => siteMap.has(id));
    const configInputs = new Map<
      string,
      NonNullable<GameplayRelation["configInputs"]>[number]
    >();
    const selectedScript =
      value?.configScriptId ??
      (value?.kind === "field" ? value.scriptId : undefined);
    const selectedRow = (
      value?.configPath ?? (value?.kind === "field" ? value.path : undefined)
    )?.slice(0, -1) as (string | number)[] | undefined;
    const addConfig = (v: Value) => {
      if (
        !["field", "table"].includes(v.kind) ||
        !v.scriptId ||
        v.scriptId === f.scriptId ||
        !v.sourceId ||
        !Array.isArray(v.path)
      )
        return;
      if (selectedScript && v.scriptId !== selectedScript) return;
      if (
        selectedRow?.length &&
        selectedRow.some((key, index) => v.path[index] !== key)
      )
        return;
      const span = v.fieldSpan ?? v.span,
        id = v.fieldId ?? v.id;
      if (!span || !id) return;
      configInputs.set(id, {
        fieldId: id,
        sourceId: v.sourceId,
        span,
        path:
          (resolver.objects.get(v.scriptId)?.name ?? "Config") +
          "." +
          v.path.join("."),
      });
    };
    if (value?.configFieldId && value.configSourceId && value.configSpan)
      configInputs.set(value.configFieldId, {
        fieldId: value.configFieldId,
        sourceId: value.configSourceId,
        span: value.configSpan,
        path:
          (resolver.objects.get(value.configScriptId)?.name ?? "Config") +
          "." +
          value.configPath.join("."),
      });
    for (const id of support) {
      const s = siteMap.get(id)!,
        owner = factsBySource.get(s.sourceId);
      if (owner && s.kind === "read")
        for (const v of alternatives(resolver.get(s.expression, owner)))
          addConfig(v);
    }
    const guards = ((raw.expression.guards as Expr[]) ?? []).map(
      (g) =>
        `${f.sourceId}:${g.span.startByte}-${g.span.endByte}:${g.negated ? "false" : "true"}`,
    );
    const conditional =
      !!value?.open ||
      value?.kind === "alternatives" ||
      guards.length > 0 ||
      value?.kind === "runtime";
    const id =
      "gameplay:" + hash([source, target, type, method, raw.id].join("|"));
    if (relationIds.has(id)) return;
    relationIds.add(id);
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
        ownerId: raw.ownerId,
        ownerLabel:
          f.symbols.find((s) => s.id === raw.ownerId)?.name ??
          resolver.objects.get(f.scriptId)?.name,
        configInputs: [...configInputs.values()],
        configPaths: [
          ...new Set([...configInputs.values()].map((i) => i.path)),
        ],
        supportSiteIds: [...new Set(support)],
        guards,
        conditional,
        rule: "typed-object-flow",
        version: "1",
        ...details,
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
        if (callee.kind === "intrinsic" && callee.path === "Instance.new")
          for (const v of alternatives(value))
            if (v.kind === "allocation" && v.created) {
              link(
                f.scriptId,
                v.id!,
                "SPAWNS",
                site,
                f,
                "Instance.new",
                "creates " + resolver.objects.get(v.id!)?.name,
                v,
              );
              if (v.parentId)
                link(
                  f.scriptId,
                  v.id!,
                  "REPARENTS",
                  site,
                  f,
                  "Instance.new parent",
                  "created in " + resolver.objects.get(v.parentId)?.name,
                  v,
                  { destinationId: v.parentId },
                );
            }
        const unsupported = alternatives(callee).filter(
          (c) =>
            c.kind === "native" &&
            c.unsupportedEffect &&
            !effects[c.method] &&
            ![
              "FireServer",
              "FireClient",
              "FireAllClients",
              "InvokeServer",
              "InvokeClient",
              "Fire",
              "Invoke",
              "GetPropertyChangedSignal",
            ].includes(c.method),
        );
        if (unsupported.length) {
          const message =
            "API member recognized, but its return-object and gameplay behavior are not modeled: " +
            [...new Set(unsupported.map((c) => c.method))].join(", ") +
            ".";
          result.diagnostics.push({
            code: "UNMODELED_PLATFORM_BEHAVIOR",
            severity: "info",
            message,
            siteId: site.id,
            ownerId: f.scriptId,
            sourceId: f.sourceId,
            span: (e.callee as Expr).span,
          });
          for (const c of unsupported)
            for (const id of anchorIds(
              c.receiverValue ?? { kind: "instance", id: c.receiver },
            ))
              link(
                f.scriptId,
                id,
                "USES_OBJECT",
                site,
                f,
                c.method,
                "API behavior not modeled",
                c.receiverValue,
              );
        }
        if (
          e.colon &&
          callee.kind === "signal-connect" &&
          !/^(Remote|UnreliableRemote|Bindable)/.test(
            String(callee.signal.className),
          )
        ) {
          const signal = callee.signal,
            trigger = String(signal.id);
          const callback = resolver.get((e.args as Expr[])[0], f);
          const handler =
            callback.kind === "function"
              ? {
                  handlerId: callback.id,
                  reachableOwnerIds: scopes(callback.id!).ownerIds,
                  scopeIncomplete: scopes(callback.id!).truncated,
                }
              : {};
          link(
            trigger,
            f.scriptId,
            "TRIGGERS",
            site,
            f,
            String(signal.signal),
            String(signal.signal) + " → handler",
            undefined,
            handler,
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
              undefined,
              handler,
            );
        }
        if (unsupported.length)
          result.sites.push({
            ...site,
            status: "candidate",
            targetIds: [
              ...new Set(
                unsupported.flatMap((c) =>
                  anchorIds(
                    c.receiverValue ?? { kind: "instance", id: c.receiver },
                  ),
                ),
              ),
            ],
            reason: "UNMODELED_PLATFORM_BEHAVIOR",
            assumptions: [
              ...site.assumptions,
              "Platform member recognition does not establish return-object or effect semantics.",
            ],
          });
        for (const c of alternatives(callee))
          if (e.colon && c.kind === "native" && effects[c.method]) {
            const receiver = c.receiverValue ?? {
              kind: "instance",
              id: c.receiver,
            };
            for (const id of anchorIds(receiver)) {
              const copy =
                c.method === "Clone"
                  ? alternatives(value).find(
                      (v) => v.kind === "allocation" && v.templateId === id,
                    )
                  : undefined;
              if (c.method === "Clone" && !copy) continue;
              link(
                f.scriptId,
                id,
                effects[c.method],
                site,
                f,
                c.method,
                c.method === "Clone" ? "clones" : c.method,
                c.method === "Clone"
                  ? {
                      ...copy,
                      open: !!value.open || !!callee.open || !!receiver.open,
                    }
                  : { ...receiver, open: !!callee.open || !!receiver.open },
              );
            }
          }
        if (
          alternatives(callee).every((c) =>
            ["intrinsic", "native", "signal-connect"].includes(c.kind),
          )
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
                value.open || callee.open || values.length > 1
                  ? "candidate"
                  : "resolved",
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
        const targets = alternatives(value);
        if (
          targets.length &&
          targets.every((v) =>
            [
              "instance",
              "module",
              "field",
              "table",
              "property",
              "runtime",
              "allocation",
              "signal",
              "intrinsic",
              "scalar",
              "literal",
            ].includes(v.kind),
          )
        ) {
          const conditional = !!value.open || targets.length > 1;
          result.sites.push({
            ...site,
            status: conditional ? "candidate" : "resolved",
            targetIds: [
              ...new Set(
                targets.flatMap((v) =>
                  v.fieldId
                    ? [v.fieldId]
                    : v.kind === "allocation"
                      ? anchorIds(v)
                      : v.id
                        ? [v.id]
                        : [],
                ),
              ),
            ],
            reason: conditional ? "CONDITIONAL_RUNTIME_VALUE" : undefined,
            assumptions: [
              ...site.assumptions,
              "Reference identity recognized; symbolic values and alternatives do not establish runtime execution.",
            ],
          });
        }
        const subject = entity(f.scriptId);
        if (
          subject &&
          subject !== f.scriptId &&
          anchorIds(value).some((id) => entity(id) === subject)
        )
          link(
            subject,
            f.scriptId,
            "HAS_BEHAVIOR",
            site,
            f,
            "owned-controller",
            "behavior implemented by",
            undefined,
            {
              handlerId: f.scriptId,
              reachableOwnerIds: scopes(f.scriptId).ownerIds,
              scopeIncomplete: scopes(f.scriptId).truncated,
            },
          );
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
        if (anchorIds(base).length && typeof key === "string")
          result.sites.push({
            ...site,
            status:
              base.kind === "allocation" || base.kind === "runtime" || base.open
                ? "candidate"
                : "resolved",
            reason:
              base.kind === "allocation"
                ? "RUNTIME_ALLOCATION_EFFECT"
                : base.kind === "runtime"
                  ? "RUNTIME_ROLE_EFFECT"
                  : undefined,
            targetIds: anchorIds(base),
            assumptions: [
              ...site.assumptions,
              "Known write target; changes refer to code-created copies or runtime roles where indicated.",
            ],
          });
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
          for (const variant of alternatives(base))
            for (const id of anchorIds(variant)) {
              const member = (f.members as any[]).find(
                (m) =>
                  m.target.span.startByte === site.span.startByte &&
                  m.target.span.endByte === site.span.endByte,
              );
              const destination =
                key === "Parent" && member
                  ? resolver.get(member.value, f)
                  : undefined;
              const playerDestination = destination
                ? alternatives(destination).find(
                    (v) =>
                      v.kind === "runtime" &&
                      String(v.rolePath).endsWith(".Backpack"),
                  )
                : undefined;
              const toPlayer = !!playerDestination;
              link(
                f.scriptId,
                id,
                key === "Parent"
                  ? toPlayer
                    ? "TRANSFERS"
                    : "REPARENTS"
                  : ["CFrame", "Position", "Size", "PrimaryPart"].includes(
                        String(key),
                      )
                    ? "TRANSFORMS"
                    : "MODIFIES",
                site,
                f,
                "write " + key,
                toPlayer ? "gives to Backpack" : "sets " + key,
                {
                  ...variant,
                  open: !!base.open || !!variant.open || !!destination?.open,
                },
                destination
                  ? {
                      destinationId:
                        playerDestination?.id ?? anchorIds(destination)[0],
                      destinationRole:
                        playerDestination?.rolePath ?? destination.rolePath,
                    }
                  : undefined,
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
          undefined,
          {
            handlerId: relation.source,
            reachableOwnerIds: scopes(relation.source).ownerIds,
            scopeIncomplete: scopes(relation.source).truncated,
          },
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
