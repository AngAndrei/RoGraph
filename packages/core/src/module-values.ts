import type { Facts, Expr } from "../../contracts/src/model.js";
import { Resolver, unknown, type Value } from "./resolver.js";
export class ModuleResolver extends Resolver {
  readonly tables = new Map<string, Value>();
  override get(e: Expr | undefined, f: Facts, seen = new Set<string>()): Value {
    if (e?.kind === "table") {
      const id = `${f.scriptId}:table:${e.span.startByte}`;
      if (!this.tables.has(id))
        this.tables.set(id, {
          kind: "table",
          id,
          scriptId: f.scriptId,
          sourceId: f.sourceId,
          entries: e.entries,
          span: e.span,
          path: [],
        });
      return this.tables.get(id)!;
    }
    if (e?.kind === "call") {
      const callee = this.get(e.callee as Expr, f, seen);
      if (
        callee.kind === "native" &&
        ["GetAttribute", "SetAttribute"].includes(callee.method)
      ) {
        const key = this.get((e.args as Expr[])[0], f, seen);
        if (typeof key.value !== "string")
          return unknown("DYNAMIC_ATTRIBUTE_KEY");
        const i = this.objects.get(callee.receiver)!;
        const attributes = (i.properties.Attributes?.value ?? {}) as Record<
          string,
          unknown
        >;
        const raw = attributes[key.value];
        const value =
          raw && typeof raw === "object" && Object.keys(raw).length === 1
            ? Object.values(raw)[0]
            : raw;
        return {
          kind: "property",
          id: `${i.id}:attribute:${encodeURIComponent(key.value)}`,
          instanceId: i.id,
          key: `Attribute.${key.value}`,
          value,
          saved: raw !== undefined,
        };
      }
    }
    return super.get(e, f, seen);
  }
  exports(id: string, seen = new Set<string>()): Value {
    const key = `module:${id}`;
    if (seen.has(key) || seen.size > 64)
      return unknown("CYCLIC_OR_DEEP_MODULE_EXPORT");
    const f = this.byScript.get(id);
    if (!f) return unknown("MODULE_SOURCE_UNAVAILABLE");
    const value = this.get(f.returnExpr as Expr, f, new Set([...seen, key]));
    return value.kind === "module"
      ? this.exports(value.id!, new Set([...seen, key]))
      : value;
  }
  callable(value: Value): Value {
    return value.kind === "module" ? this.exports(value.id!) : value;
  }
  override member(
    base: Value,
    key: string | number,
    f: Facts,
    seen: Set<string>,
  ): Value {
    if (base.kind === "module")
      return this.member(
        this.exports(base.id!, seen),
        key,
        f,
        new Set([...seen, `module:${base.id}`]),
      );
    if (base.kind !== "table") {
      if (
        base.kind === "instance" &&
        typeof key === "string" &&
        ["GetAttribute", "SetAttribute"].includes(key)
      )
        return { kind: "native", method: key, receiver: base.id };
      return super.member(base, key, f, seen);
    }
    const guard = `member:${base.id}:${typeof key}:${key}`;
    if (seen.has(guard) || seen.size > 64) return unknown("CYCLIC_MEMBER");
    const next = new Set([...seen, guard]),
      owner = this.byScript.get(base.scriptId)!;
    const declarations = (base.entries as any[]).filter((e) => e.key === key);
    const assigned = (owner.members as any[]).filter((m) => {
      const k = m.target.key;
      if (k?.kind !== "literal" || k.value !== key) return false;
      const table = this.get(m.target.base, owner, next);
      return table.kind === "table" && table.id === base.id;
    });
    if (declarations.length + assigned.length > 1)
      return unknown("REASSIGNED_OR_AMBIGUOUS_MEMBER");
    const entry = declarations[0] ?? assigned[0];
    if (!entry) return unknown("MODULE_MEMBER_NOT_FOUND");
    const value = this.get(entry.value, owner, next),
      path = [...base.path, key],
      fieldId = `${base.id}:field:${typeof key}:${encodeURIComponent(key)}`;
    if (value.kind === "table") {
      if (!value.anchored) {
        value.path = path;
        value.fieldId = fieldId;
        value.fieldSpan = entry.span ?? entry.target.span;
        value.anchored = true;
      }
      return value;
    }
    if (value.kind === "literal")
      return {
        kind: "field",
        id: fieldId,
        scriptId: base.scriptId,
        sourceId: base.sourceId,
        path,
        span: entry.span ?? entry.target.span,
        value: value.value,
      };
    return value;
  }
}
