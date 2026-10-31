import type { Facts, Expr } from "../../contracts/src/model.js";
import { Resolver, unknown, type Value } from "./resolver.js";
export class ModuleResolver extends Resolver {
  readonly tables = new Map<string, Value>();
  private writes?: Map<string, { member: any; facts: Facts; key: unknown }[]>;
  private indexingWrites = false;
  private mutations(id: string) {
    if (this.indexingWrites) return [];
    if (!this.writes) {
      this.writes = new Map();
      this.indexingWrites = true;
      try {
        for (const facts of this.facts)
          for (const member of facts.members as any[]) {
            const base = this.callable(this.get(member.target.base, facts));
            if (base.kind !== "table") continue;
            const value = this.get(member.target.key, facts);
            const key =
              value.kind === "literal" &&
              ["string", "number"].includes(typeof value.value)
                ? value.value
                : undefined;
            const records = this.writes.get(base.id!) ?? [];
            records.push({ member, facts, key });
            this.writes.set(base.id!, records);
          }
      } finally {
        this.indexingWrites = false;
      }
    }
    return this.writes.get(id) ?? [];
  }
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
    if ((base.entries as any[]).some((e) => e.key === null))
      return unknown("DYNAMIC_TABLE_KEY");
    const declarations = (base.entries as any[]).filter((e) => e.key === key);
    const writes = this.mutations(base.id!);
    if (writes.some((w) => w.key === undefined))
      return unknown("DYNAMIC_MEMBER_WRITE");
    const assigned = writes.filter((w) => w.key === key);
    if (assigned.some((w) => w.facts.scriptId !== base.scriptId))
      return unknown("EXTERNAL_MEMBER_WRITE");
    if (declarations.length + assigned.length > 1)
      return unknown("REASSIGNED_OR_AMBIGUOUS_MEMBER");
    const entry = declarations[0] ?? assigned[0]?.member;
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
