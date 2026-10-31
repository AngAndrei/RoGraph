import type {
  Snapshot,
  Facts,
  Resolution,
  Expr,
  Node,
} from "../../contracts/src/model.js";
import { FlowResolver as ModuleResolver } from "./flow-resolver.js";
import { emptyResolution, addNode, mark, emit } from "./resolution.js";
import { resolveContexts } from "./execution-context.js";
import { unknown, type Value } from "./resolver.js";
const fieldLabel = (objectName: string, v: Value) =>
  objectName +
  (v.key
    ? "." + v.key
    : v.path
        .map((key: string | number) =>
          typeof key === "number"
            ? `[${key}]`
            : /^[a-z_][a-z_0-9]*$/i.test(key)
              ? "." + key
              : `[${JSON.stringify(key)}]`,
        )
        .join(""));
export function resolveConfig(
  snapshot: Snapshot,
  facts: Facts[],
  instances: Resolution,
  calls: Resolution,
): Resolution {
  const result = emptyResolution(),
    resolver = new ModuleResolver(snapshot, facts),
    contexts = resolveContexts(snapshot, facts, instances);
  const field = (v: Value): Node | undefined => {
    if (
      !["field", "property"].includes(v.kind) &&
      !(v.kind === "table" && v.fieldId)
    )
      return;
    const object = v.instanceId
      ? resolver.objects.get(v.instanceId)
      : resolver.objects.get(v.scriptId);
    const node: Node = {
      id: v.kind === "table" ? v.fieldId : v.id!,
      kind: "field",
      ownerId: v.instanceId ?? v.scriptId,
      label: fieldLabel(object?.name ?? "Config", v),
      contexts: contexts.get(v.instanceId ?? v.scriptId) ?? ["unknown"],
      attributes: {
        scriptId: v.scriptId ?? v.instanceId,
        initializer: v.value ?? null,
        initializerAvailable: v.value !== undefined,
        initializerMeaning:
          "Saved value or literal initializer; runtime value may change.",
        ...(v.sourceId
          ? {
              sourceId: v.sourceId,
              span: v.kind === "table" ? v.fieldSpan : v.span,
            }
          : {}),
        ...(v.instanceId
          ? { instanceId: v.instanceId, propertyName: v.key }
          : {}),
        fieldPath: v.path ?? [v.key],
      },
    };
    addNode(result, node);
    return node;
  };
  const collect = (v: Value, seen = new Set<string>()) => {
    if (v.kind !== "table" || seen.has(v.id!)) return;
    seen.add(v.id!);
    field(v);
    const owner = resolver.byScript.get(v.scriptId)!;
    for (const entry of v.entries) {
      if (entry.key === null) continue;
      const child = resolver.member(v, entry.key, owner, new Set());
      field(child);
      collect(child, seen);
    }
  };
  for (const f of facts) {
    collect(resolver.exports(f.scriptId));
    for (const b of f.bindings)
      if (b.initializer?.kind === "table")
        collect(resolver.get(b.initializer, f));
  }
  for (const f of facts)
    for (const raw of f.sites) {
      let type: "READS" | "WRITES" | undefined =
        raw.kind === "read"
          ? "READS"
          : raw.kind === "write"
            ? "WRITES"
            : undefined;
      let value = resolver.get(raw.expression, f);
      if (raw.kind === "call") {
        const callee = resolver.get(raw.expression.callee as Expr, f);
        if (
          callee.kind === "native" &&
          ["GetAttribute", "SetAttribute"].includes(callee.method)
        )
          type = callee.method === "GetAttribute" ? "READS" : "WRITES";
      }
      if (!type) continue;
      if (
        raw.expression.kind === "index" &&
        value.kind === "unknown" &&
        value.reason === "DYNAMIC_MEMBER_KEY"
      ) {
        const base = resolver.get(raw.expression.base as Expr, f);
        if (base.kind === "module" || base.kind === "table")
          value = unknown("DYNAMIC_CONFIG_KEY");
      }
      if (raw.expression.kind === "index" && value.kind === "unknown") {
        const base = resolver.get(raw.expression.base as Expr, f),
          key = resolver.get(raw.expression.key as Expr, f);
        const object = resolver.objects.get(base.id!);
        if (
          base.kind === "table" &&
          key.kind === "literal" &&
          ["string", "number"].includes(typeof key.value)
        ) {
          const entry = base.entries.find((e: any) => e.key === key.value);
          value = {
            kind: "field",
            id: `${base.id}:field:${typeof key.value}:${encodeURIComponent(String(key.value))}`,
            scriptId: base.scriptId,
            sourceId: base.sourceId,
            path: [...base.path, key.value],
            span: entry?.span ?? raw.span,
            value:
              entry?.value?.kind === "literal" ? entry.value.value : undefined,
          };
        }
        const known =
          object &&
          ((["Script", "LocalScript"].includes(object.className) &&
            ["Disabled", "Enabled", "RunContext"].includes(
              String(key.value),
            )) ||
            (object.className.endsWith("Value") && key.value === "Value"));
        if (base.kind === "instance" && known)
          value = {
            kind: "property",
            id: `${base.id}:property:${key.value}`,
            instanceId: base.id,
            key: key.value,
          };
      }
      const node = field(value),
        site = { ...raw, contexts: contexts.get(raw.ownerId) ?? ["unknown"] };
      if (node) {
        const s = mark(result, site, { kind: "field", id: node.id });
        emit(result, site.ownerId, node.id, type, s, "literal-config-access");
      } else if (
        value.reason === "DYNAMIC_CONFIG_KEY" ||
        value.reason === "DYNAMIC_ATTRIBUTE_KEY" ||
        value.reason === "REASSIGNED_ALIAS"
      )
        mark(result, site, value);
    }
  return result;
}
