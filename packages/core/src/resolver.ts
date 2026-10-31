import type {
  Snapshot,
  Facts,
  Expr,
  Instance,
} from "../../contracts/src/model.js";
import { apiMember } from "./api-members.js";
import { platformMember, platformResult } from "./semantics/luau.js";
export type Value = {
  kind: string;
  id?: string;
  ids?: string[];
  value?: unknown;
  reason?: string;
  [key: string]: any;
};
export const unknown = (reason: string, ids?: string[]): Value => ({
  kind: "unknown",
  reason,
  ids,
});
export class Resolver {
  readonly objects: Map<string, Instance>;
  readonly byScript: Map<string, Facts>;
  readonly owners = new Map<string, string>();
  readonly classes = new Map<string, Map<string, Instance[]>>();
  readonly children = new Map<string, Map<string, Instance[]>>();
  readonly bindings = new Map<string, any>();
  constructor(
    public snapshot: Snapshot,
    public facts: Facts[],
  ) {
    this.objects = new Map(snapshot.instances.map((i) => [i.id, i]));
    this.byScript = new Map(facts.map((f) => [f.scriptId, f]));
    for (const i of snapshot.instances) {
      if (i.parentId) {
        let classMap = this.classes.get(i.parentId);
        if (!classMap) this.classes.set(i.parentId, (classMap = new Map()));
        const classList = classMap.get(i.className) ?? [];
        classList.push(i);
        classMap.set(i.className, classList);
        let map = this.children.get(i.parentId);
        if (!map) this.children.set(i.parentId, (map = new Map()));
        const arr = map.get(i.name) ?? [];
        arr.push(i);
        map.set(i.name, arr);
      }
    }
    for (const f of facts) {
      this.owners.set(f.scriptId, f.scriptId);
      for (const s of f.symbols) this.owners.set(s.id, f.scriptId);
      for (const b of f.bindings) this.bindings.set(b.id, b);
    }
  }
  child(id: string, name: string): Value {
    const list = this.children.get(id)?.get(name) ?? [];
    return list.length === 1
      ? { kind: "instance", id: list[0].id }
      : unknown(
          list.length ? "DUPLICATE_CHILD_NAME" : "MISSING_SAVED_CHILD",
          list.map((i) => i.id),
        );
  }
  requireTarget(
    e: Expr | undefined,
    f: Facts,
    seen = new Set<string>(),
  ): Value {
    let v = this.get(e, f, seen);
    if (v.kind === "literal" && typeof v.value === "number")
      return {
        kind: "external",
        id: `external:require:${v.value}`,
        assetId: v.value,
      };
    if (v.kind === "literal" && typeof v.value === "string") {
      let path = v.value;
      let id: string | undefined;
      if (path.startsWith("@game/")) {
        id = this.snapshot.instances[0].id;
        path = path.slice(6);
      } else if (path.startsWith("@self/")) {
        id = f.scriptId;
        path = path.slice(6);
      } else if (path.startsWith("./") || path.startsWith("../")) {
        id = this.objects.get(f.scriptId)?.parentId ?? undefined;
        if (path.startsWith("./")) path = path.slice(2);
      } else return unknown("UNSUPPORTED_REQUIRE_STRING_PREFIX");
      v = id ? { kind: "instance", id } : unknown("MISSING_PARENT");
      for (const part of path.split("/")) {
        if (!part || part === ".") continue;
        if (v.kind !== "instance") break;
        v =
          part === ".."
            ? this.objects.get(v.id!)?.parentId
              ? { kind: "instance", id: this.objects.get(v.id!)!.parentId! }
              : unknown("MISSING_PARENT")
            : this.child(v.id!, part);
      }
    }
    if (v.kind === "property" && v.targetId)
      v = { kind: "instance", id: v.targetId };
    return v.kind === "instance"
      ? this.objects.get(v.id!)?.className === "ModuleScript"
        ? { kind: "module", id: v.id }
        : unknown("REQUIRE_TARGET_NOT_MODULE")
      : v;
  }
  get(e: Expr | undefined, f: Facts, seen = new Set<string>()): Value {
    if (!e) return unknown("MISSING_EXPRESSION");
    if (seen.size > 64) return unknown("RESOLUTION_DEPTH_LIMIT");
    switch (e.kind) {
      case "binary": {
        const a = this.get(e.left as Expr, f, seen);
        if (a.kind !== "literal") return unknown("SYMBOLIC_BINARY_VALUE");
        const truth =
          a.value !== null && a.value !== false && a.value !== undefined;
        if (["Or", "or"].includes(String(e.op)))
          return truth ? a : this.get(e.right as Expr, f, seen);
        if (["And", "and"].includes(String(e.op)))
          return truth ? this.get(e.right as Expr, f, seen) : a;
        return unknown("SYMBOLIC_BINARY_VALUE");
      }
      case "literal":
        return { kind: "literal", value: e.value };
      case "function":
        return { kind: "function", id: e.symbolId as string };
      case "unknown":
        return unknown(String(e.reason ?? "UNSUPPORTED_EXPRESSION"));
      case "binding": {
        const key = String(e.bindingId);
        if (seen.has(key)) return unknown("CYCLIC_BINDING");
        const b = this.bindings.get(key);
        if (!b) return unknown("UNKNOWN_BINDING");
        if (b.assignments.length) return unknown("REASSIGNED_ALIAS");
        return this.get(b.initializer, f, new Set([...seen, key]));
      }
      case "global": {
        const g = (f.globalAssignments as any[]).filter(
          (g) => g.name === e.name,
        );
        if (g.length)
          return g.length === 1 && g[0].value.kind === "function"
            ? this.get(g[0].value, f, seen)
            : unknown("REASSIGNED_GLOBAL");
        if (e.name === "script") return { kind: "instance", id: f.scriptId };
        if (e.name === "game")
          return { kind: "instance", id: this.snapshot.instances[0].id };
        if (e.name === "workspace") {
          const saved = this.snapshot.instances.find(
            (i) => i.className === "Workspace",
          );
          return saved
            ? { kind: "instance", id: saved.id }
            : unknown("SERVICE_NOT_SAVED");
        }
        return { kind: "builtin", name: e.name };
      }
      case "index": {
        const base = this.get(e.base as Expr, f, seen),
          key = this.get(e.key as Expr, f, seen);
        if (
          key.kind !== "literal" ||
          !["string", "number"].includes(typeof key.value)
        )
          return unknown("DYNAMIC_MEMBER_KEY");
        return this.member(base, key.value as string | number, f, seen);
      }
      case "call": {
        const callee = this.get(e.callee as Expr, f, seen);
        const args = e.args as Expr[];
        if (callee.kind === "intrinsic") return platformResult(callee.path);
        if (callee.kind === "builtin" && callee.name === "require")
          return this.requireTarget(args[0], f, seen);
        if (callee.kind === "native") {
          const arg = this.get(args[0], f, seen);
          if (typeof arg.value !== "string")
            return unknown("DYNAMIC_CHILD_NAME");
          if (callee.method === "GetService") {
            const list =
              this.classes.get(callee.receiver)?.get(arg.value) ?? [];
            return list.length === 1
              ? { kind: "instance", id: list[0].id }
              : unknown("SERVICE_NOT_SAVED");
          }
          return this.child(callee.receiver, arg.value);
        }
        return unknown("DYNAMIC_CALL_RESULT");
      }
      default:
        return unknown("UNSUPPORTED_VALUE");
    }
  }
  member(
    base: Value,
    key: string | number,
    f: Facts,
    seen: Set<string>,
  ): Value {
    if (base.kind === "builtin" || base.kind === "intrinsic") {
      const path = platformMember(base.path ?? base.name, key, f);
      return path ? { kind: "intrinsic", path } : unknown("UNRESOLVED_MEMBER");
    }
    if (base.kind !== "instance")
      return base.kind === "unknown" ? base : unknown("UNRESOLVED_MEMBER");
    if (typeof key !== "string")
      return unknown("UNSUPPORTED_INSTANCE_INDEX_KIND");
    const i = this.objects.get(base.id!)!;
    if (key === "Parent")
      return i.parentId
        ? { kind: "instance", id: i.parentId }
        : unknown("MISSING_PARENT");
    if (
      ["GetService", "FindFirstChild", "WaitForChild"].includes(key) &&
      apiMember(i.className, key)
    )
      return { kind: "native", method: key, receiver: i.id };
    if (key === "Name" || key === "ClassName")
      return {
        kind: "property",
        id: `${i.id}:property:${key}`,
        instanceId: i.id,
        key,
        value: key === "Name" ? i.name : i.className,
      };
    if (i.properties[key])
      return {
        kind: "property",
        id: `${i.id}:property:${key}`,
        instanceId: i.id,
        key,
        value: i.properties[key].value,
        ...(i.properties[key].type === "Ref"
          ? { targetId: i.properties[key].value }
          : {}),
      };
    const api = apiMember(i.className, key);
    if (api)
      return unknown(
        api === "Property" ? "UNSAVED_API_PROPERTY" : "UNMODELED_API_MEMBER",
      );
    return this.child(i.id, key);
  }
}
