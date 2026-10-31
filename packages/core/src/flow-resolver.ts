import type { Expr, Facts, Instance } from "../../contracts/src/model.js";
import { ModuleResolver } from "./module-values.js";
import { unknown, type Value } from "./resolver.js";
import { apiMember } from "./api-members.js";
import {
  alternatives,
  anchorIds,
  joinValues,
  primitive,
} from "./analysis-values.js";
const methods = new Set([
  "Clone",
  "Destroy",
  "IsA",
  "PivotTo",
  "ScaleTo",
  "GetPivot",
  "FindFirstChildWhichIsA",
  "FindFirstChildOfClass",
  "FindFirstAncestor",
  "FindFirstAncestorOfClass",
  "GetChildren",
  "GetDescendants",
  "GetPlayers",
  "GetPlayerFromCharacter",
  "SetAttribute",
  "GetAttribute",
]);
const events = new Set([
  "Triggered",
  "MouseClick",
  "Activated",
  "MouseButton1Click",
  "Touched",
  "TouchEnded",
  "DescendantAdded",
  "ChildAdded",
  "PlayerAdded",
  "CharacterAdded",
  "OnServerEvent",
  "OnClientEvent",
  "Event",
]);
export class FlowResolver extends ModuleResolver {
  readonly created = new Map<string, Instance>();
  private readonly lexicalTargets = new Map<string, string | undefined>();
  private callerIndex?: Map<
    string,
    { owner: Facts; expression: Expr; direct: boolean; callback: boolean }[]
  >;
  private allocationParents?: { parent: string; value: Value }[];
  readonly alternatives = alternatives;
  readonly anchorIds = anchorIds;
  override get(e: Expr | undefined, f: Facts, seen = new Set<string>()): Value {
    if (!e) return unknown("MISSING_EXPRESSION");
    if (seen.size > 64) return unknown("ANALYSIS_BUDGET_EXHAUSTED");
    if (e.kind === "binary") {
      const left = this.get(e.left as Expr, f, seen),
        op = String(e.op);
      if (["Or", "or", "And", "and"].includes(op)) {
        const right = () => this.get(e.right as Expr, f, seen);
        return joinValues(
          alternatives(left).flatMap((v) => {
            const p = primitive(v);
            if (p.kind === "literal") {
              const truth =
                p.value !== null && p.value !== false && p.value !== undefined;
              return op === "Or" || op === "or"
                ? truth
                  ? [v]
                  : [right()]
                : truth
                  ? [right()]
                  : [v];
            }
            return [v, right()];
          }),
          !!left.open,
        );
      }
      return {
        kind: "scalar",
        type: "number",
        inputs: [
          ...anchorIds(left),
          ...anchorIds(this.get(e.right as Expr, f, seen)),
        ],
      };
    }
    if (e.kind === "conditional")
      return joinValues(
        [this.get(e.yes as Expr, f, seen), this.get(e.no as Expr, f, seen)],
        true,
      );
    if (e.kind === "unary")
      return { kind: "scalar", type: e.op === "Not" ? "boolean" : "number" };
    if (e.kind === "binding") {
      const b = this.bindings.get(String(e.bindingId));
      if (b && !b.initializer && !seen.has(b.id))
        return this.refine(
          this.parameter(b.id, f, new Set([...seen, b.id])),
          e,
          f,
        );
      if (b?.initializer) return this.refine(super.get(e, f, seen), e, f);
    }
    if (e.kind === "iteration") {
      const collection = this.get(e.iterable as Expr, f, seen);
      return collection.kind === "collection"
        ? joinValues(collection.values, collection.open)
        : unknown("UNMODELED_ITERATOR");
    }
    if (e.kind === "index") {
      const base = this.get(e.base as Expr, f, seen),
        keys = this.get(e.key as Expr, f, seen);
      return joinValues(
        alternatives(base).flatMap((b) =>
          alternatives(keys).map((k) => {
            const p = primitive(k);
            if (
              p.kind === "literal" &&
              ["string", "number"].includes(typeof p.value)
            )
              return this.member(b, p.value as string | number, f, seen);
            if (
              (k.runtime || k.kind === "property") &&
              (b.kind === "table" || b.kind === "module")
            ) {
              const table = b.kind === "module" ? this.exports(b.id!, seen) : b;
              if (table.kind === "table")
                return joinValues(
                  table.entries
                    .filter((x: any) => x.key !== null)
                    .map((x: any) => this.member(table, x.key, f, seen)),
                  true,
                );
            }
            return unknown("DYNAMIC_MEMBER_KEY");
          }),
        ),
        !!base.open || !!keys.open,
      );
    }
    if (e.kind === "call") {
      const callee = this.get(e.callee as Expr, f, seen),
        args = e.args as Expr[];
      if (callee.kind === "alternatives")
        return joinValues(
          alternatives(callee).map((c) => this.nativeCall(c, args, e, f, seen)),
          !!callee.open,
        );
      if (callee.kind === "intrinsic" && callee.path === "Instance.new") {
        const type = primitive(this.get(args[0], f, seen));
        if (typeof type.value !== "string")
          return unknown("DYNAMIC_INSTANCE_CLASS");
        const id = `created:${f.scriptId}:${e.span.startByte}`;
        let name = type.value;
        for (const m of f.members as any[]) {
          if (
            m.target?.key?.value !== "Name" ||
            m.value?.kind !== "literal" ||
            typeof m.value.value !== "string"
          )
            continue;
          const binding =
            m.target.base?.kind === "binding"
              ? this.bindings.get(m.target.base.bindingId)
              : undefined;
          if (binding?.initializer?.span.startByte === e.span.startByte)
            name = m.value.value;
        }
        const object: Instance = {
          id,
          name,
          className: type.value,
          parentId: null,
          siblingOrdinal: 0,
          properties: {},
          synthetic: true,
        };
        this.objects.set(id, object);
        this.created.set(id, object);
        return {
          kind: "allocation",
          id,
          sourceId: f.sourceId,
          scriptId: f.scriptId,
          span: e.span,
          className: type.value,
          created: true,
        };
      }
      if (
        callee.kind === "builtin" &&
        ["ipairs", "pairs"].includes(callee.name)
      )
        return this.get(args[0], f, seen);
      if (callee.kind === "native" || callee.kind === "signal-connect")
        return this.nativeCall(callee, args, e, f, seen);
      if (callee.kind === "function") {
        const owner = this.byScript.get(this.owners.get(callee.id!)!)!,
          symbol = owner.symbols.find((s) => s.id === callee.id);
        if (seen.has(callee.id!)) return unknown("RECURSIVE_CALL_SUMMARY");
        const returns = symbol?.returns as Expr[] | undefined;
        if (returns?.length)
          return joinValues(
            returns.map((v) =>
              this.get(v, owner, new Set([...seen, callee.id!])),
            ),
            returns.length > 1,
          );
      }
    }
    return super.get(e, f, seen);
  }
  private nativeCall(
    c: Value,
    args: Expr[],
    e: Expr,
    f: Facts,
    seen: Set<string>,
  ): Value {
    if (c.kind !== "native" && c.kind !== "signal-connect")
      return unknown("DYNAMIC_CALL_RESULT");
    if (c.kind === "native" && !e.colon)
      return unknown("DOT_STYLE_NATIVE_CALL");
    const base = c.receiverValue ?? { kind: "instance", id: c.receiver },
      id = anchorIds(base)[0],
      object = this.objects.get(id ?? base.id);
    if (c.method === "GetAttribute")
      return { ...super.get(e, f, seen), runtime: true };
    if (c.method === "Clone") {
      if (object?.properties.Archivable?.value === false)
        return { kind: "literal", value: null };
      return {
        kind: "allocation",
        id: `allocation:${f.scriptId}:${e.span.startByte}`,
        templateId: id,
        sourceId: f.sourceId,
        scriptId: f.scriptId,
        span: e.span,
        className: object?.className,
        open: !!base.open,
      };
    }
    if (["GetChildren", "GetDescendants"].includes(c.method)) {
      return {
        kind: "collection",
        values: this.objectSet(id, c.method === "GetDescendants"),
        open: true,
      };
    }
    if (c.method === "GetPlayerFromCharacter") return this.playerRole("Player");
    if (c.method === "GetPlayers")
      return {
        kind: "collection",
        values: [this.playerRole("Player")],
        open: true,
      };
    if (
      [
        "FindFirstChild",
        "WaitForChild",
        "FindFirstAncestor",
        "FindFirstAncestorOfClass",
        "FindFirstChildWhichIsA",
        "FindFirstChildOfClass",
      ].includes(c.method)
    ) {
      const key = this.get(args[0], f, seen);
      return joinValues(
        alternatives(key).map((k) => {
          const p = primitive(k);
          if (typeof p.value !== "string") return unknown("DYNAMIC_CHILD_NAME");
          if (
            c.method === "FindFirstChildWhichIsA" ||
            c.method === "FindFirstChildOfClass"
          ) {
            const list = [...this.objects.values()].filter(
              (o) =>
                o.parentId === id &&
                (o.className === p.value ||
                  (p.value === "BasePart" &&
                    apiMember(o.className, "Position") === "Property")),
            );
            return list.length
              ? joinValues(
                  list.map((o) => ({ kind: "instance", id: o.id })),
                  list.length > 1,
                )
              : unknown("MISSING_SAVED_CHILD");
          }
          if (c.method.startsWith("FindFirstAncestor")) {
            let current = object;
            while (current?.parentId) {
              current = this.objects.get(current.parentId);
              if (
                current &&
                (c.method.endsWith("OfClass")
                  ? current.className
                  : current.name) === p.value
              )
                return { kind: "instance", id: current.id };
            }
            return unknown("MISSING_SAVED_ANCESTOR");
          }
          const target = id
            ? this.child(id, p.value)
            : unknown("RUNTIME_PARENT_UNAVAILABLE");
          return k.kind === "field"
            ? {
                ...target,
                configFieldId: k.id,
                configScriptId: k.scriptId,
                configPath: k.path,
              }
            : target;
        }),
        !!key.open || !!base.open,
      );
    }
    if (c.method === "GetService") return super.get(e, f, seen);
    return {
      kind: "scalar",
      type: c.method === "IsA" ? "boolean" : "engine-result",
      platform: c.method,
    };
  }
  private playerRole(path: string): Value {
    const players = [...this.objects.values()].find(
      (o) => o.className === "Players",
    );
    return players
      ? {
          kind: "runtime",
          id: players.id,
          className:
            path === "Player" || path === "LocalPlayer" ? "Player" : "Instance",
          rolePath: path,
          open: true,
        }
      : unknown("PLAYER_SERVICE_NOT_SAVED");
  }
  private refine(value: Value, e: Expr, f: Facts): Value {
    const names: string[] = [];
    const inspect = (g: Expr) => {
      if (g.kind === "guard") {
        if (g.negated) return;
        const condition = (f.control as any[]).find(
          (c) =>
            c.condition?.span.startByte === g.span.startByte &&
            c.condition?.span.endByte === g.span.endByte,
        )?.condition;
        if (condition) inspect(condition);
        return;
      }
      if (g?.kind !== "binary") return;
      if (["And", "and"].includes(String(g.op))) {
        inspect(g.left as Expr);
        inspect(g.right as Expr);
        return;
      }
      if (!["CompareEq", "Equal", "=="].includes(String(g.op))) return;
      for (const [a, b] of [
        [g.left, g.right],
        [g.right, g.left],
      ] as [Expr, Expr][])
        if (
          a?.kind === "index" &&
          (a.base as Expr)?.bindingId === e.bindingId &&
          (a.key as Expr)?.value === "Name" &&
          b?.kind === "literal" &&
          typeof b.value === "string"
        )
          names.push(b.value);
    };
    for (const guard of (e.guards as Expr[]) ?? []) inspect(guard);
    if (!names.length) return value;
    return joinValues(
      alternatives(value).filter((v) => {
        const object = this.objects.get(anchorIds(v)[0]);
        return !object || names.includes(object.name);
      }),
      !!value.open,
    );
  }
  private parameter(id: string, f: Facts, seen: Set<string>): Value {
    const symbol = f.symbols.find((s) =>
      (s.parameterIds as string[] | undefined)?.includes(id),
    );
    if (!symbol) return unknown("UNBOUND_PARAMETER");
    const index = (symbol.parameterIds as string[]).indexOf(id),
      values: Value[] = [];
    let contexts = 0,
      exhausted = false;
    for (const { owner, expression: e, direct, callback } of this.callersFor(
      symbol.id,
    )) {
      if (++contexts > 4) {
        exhausted = true;
        break;
      }
      const args = e.colon
        ? [(e.callee as Expr).base as Expr, ...(e.args as Expr[])]
        : (e.args as Expr[]);
      if (direct) {
        if (args[index]) values.push(this.get(args[index], owner, seen));
      }
      const callee = callback
        ? this.get(e.callee as Expr, owner, seen)
        : undefined;
      if (callback && callee?.kind === "signal-connect") {
        const signal = callee.signal;
        if (
          ["Triggered", "MouseClick", "PlayerAdded", "OnServerEvent"].includes(
            signal.signal,
          ) &&
          index === 0
        )
          values.push(this.playerRole("Player"));
        if (
          ["DescendantAdded", "ChildAdded"].includes(signal.signal) &&
          index === 0
        ) {
          const object = this.objects.get(signal.id);
          if (object)
            values.push(
              ...this.objectSet(object.id, signal.signal === "DescendantAdded"),
            );
        }
      }
    }
    return values.length
      ? joinValues(values, exhausted)
      : unknown("UNBOUND_CALLBACK_PARAMETER");
  }
  private callersFor(symbolId: string) {
    if (!this.callerIndex) {
      this.callerIndex = new Map();
      const add = (
        id: string,
        record: {
          owner: Facts;
          expression: Expr;
          direct: boolean;
          callback: boolean;
        },
      ) => {
        const list = this.callerIndex!.get(id) ?? [];
        list.push(record);
        this.callerIndex!.set(id, list);
      };
      for (const owner of this.facts)
        for (const site of owner.sites) {
          if (site.kind !== "call") continue;
          const e = site.expression,
            direct = this.lexicalFunction(e.callee as Expr, owner);
          if (direct)
            add(direct, {
              owner,
              expression: e,
              direct: true,
              callback: false,
            });
          for (const id of new Set(
            (e.args as Expr[])
              .map((a) => this.lexicalFunction(a, owner))
              .filter((id): id is string => !!id),
          ))
            add(id, { owner, expression: e, direct: false, callback: true });
        }
    }
    return this.callerIndex.get(symbolId) ?? [];
  }
  private descendantOf(id: string, root: string): boolean {
    const seen = new Set<string>();
    let current = this.objects.get(id);
    while (current?.parentId && !seen.has(current.id)) {
      seen.add(current.id);
      if (current.parentId === root) return true;
      current = this.objects.get(current.parentId);
    }
    return false;
  }
  private objectSet(root: string, recursive: boolean): Value[] {
    if (!this.allocationParents) {
      this.allocationParents = [];
      for (const f of this.facts)
        for (const member of f.members as any[]) {
          if (member.target?.key?.value !== "Parent") continue;
          const parents = anchorIds(this.get(member.value, f));
          if (!parents.length) continue;
          for (const value of alternatives(this.get(member.target.base, f)))
            if (value.kind === "allocation")
              for (const parent of parents)
                this.allocationParents.push({
                  parent,
                  value: { ...value, open: true },
                });
        }
    }
    return [
      ...[...this.objects.values()]
        .filter((o) =>
          recursive ? this.descendantOf(o.id, root) : o.parentId === root,
        )
        .map((o) => ({ kind: "instance", id: o.id })),
      ...this.allocationParents
        .filter(
          (a) =>
            a.parent === root ||
            (recursive && this.descendantOf(a.parent, root)),
        )
        .map((a) => a.value),
    ];
  }
  private lexicalFunction(
    e: Expr | undefined,
    f: Facts,
    seen = new Set<string>(),
  ): string | undefined {
    if (!e || seen.size > 16) return;
    if (e.kind === "function") return String(e.symbolId);
    const key = f.scriptId + ":" + e.span.startByte + ":" + e.span.endByte;
    if (this.lexicalTargets.has(key)) return this.lexicalTargets.get(key);
    if (e.kind === "binding") {
      const b = this.bindings.get(String(e.bindingId));
      if (!b || b.assignments.length || seen.has(b.id)) {
        this.lexicalTargets.set(key, undefined);
        return;
      }
      const target = this.lexicalFunction(
        b.initializer,
        f,
        new Set([...seen, b.id]),
      );
      this.lexicalTargets.set(key, target);
      return target;
    }
    // Only a closed lexical/table expression can identify a function without
    // recursively demanding the parameters of unrelated callback receivers.
    const closed = (
      x: Expr | undefined,
      visited = new Set<string>(),
    ): boolean => {
      if (!x || visited.size > 16) return false;
      if (x.kind === "binding") {
        const b = this.bindings.get(String(x.bindingId));
        return (
          !!b &&
          !b.assignments.length &&
          !visited.has(b.id) &&
          closed(b.initializer, new Set([...visited, b.id]))
        );
      }
      if (x.kind === "index")
        return (
          closed(x.base as Expr, visited) && (x.key as Expr)?.kind === "literal"
        );
      if (x.kind === "call")
        return (
          closed(x.callee as Expr, visited) &&
          (x.args as Expr[]).every((a) => a.kind === "literal")
        );
      return ["global", "function", "table", "literal"].includes(x.kind);
    };
    if (!closed(e)) {
      this.lexicalTargets.set(key, undefined);
      return;
    }
    const value = super.get(e, f);
    const target = value.kind === "function" ? value.id : undefined;
    this.lexicalTargets.set(key, target);
    return target;
  }
  override member(
    base: Value,
    key: string | number,
    f: Facts,
    seen: Set<string>,
  ): Value {
    if (base.kind === "alternatives")
      return joinValues(
        alternatives(base).map((v) => this.member(v, key, f, seen)),
        !!base.open,
      );
    if (
      base.kind === "signal" &&
      ["Connect", "Once", "Wait"].includes(String(key))
    )
      return { kind: "signal-connect", signal: base };
    if (base.kind === "allocation") {
      const id = base.templateId ?? base.id;
      const result = this.member({ kind: "instance", id }, key, f, seen);
      return result.kind === "native"
        ? { ...result, receiverValue: base }
        : result;
    }
    if (base.kind === "runtime") {
      if (
        methods.has(String(key)) &&
        apiMember(base.className, String(key)) === "Function"
      )
        return {
          kind: "native",
          method: key,
          receiver: base.id,
          receiverValue: base,
        };
      if (key === "Parent") return unknown("RUNTIME_PARENT_UNAVAILABLE");
      return {
        ...base,
        rolePath: base.rolePath + "." + key,
        className:
          key === "Character"
            ? "Model"
            : key === "Backpack"
              ? "Backpack"
              : key === "PlayerGui"
                ? "PlayerGui"
                : "Instance",
      };
    }
    if (base.kind === "instance") {
      const object = this.objects.get(base.id!);
      if (!object) return unknown("OBJECT_NOT_AVAILABLE");
      if (object.className === "Players" && key === "LocalPlayer")
        return this.playerRole("LocalPlayer");
      if (
        events.has(String(key)) &&
        apiMember(object.className, String(key)) === "Event"
      )
        return {
          kind: "signal",
          id: base.id,
          signal: key,
          className: object.className,
        };
      if (
        (methods.has(String(key)) ||
          ["FindFirstChild", "WaitForChild", "GetService"].includes(
            String(key),
          )) &&
        apiMember(object.className, String(key)) === "Function"
      )
        return {
          kind: "native",
          method: key,
          receiver: base.id,
          receiverValue: base,
        };
      const api = apiMember(object.className, String(key));
      if (api === "Function")
        return {
          kind: "native",
          method: key,
          receiver: base.id,
          receiverValue: base,
          unsupportedEffect: true,
        };
      if (
        api === "Property" &&
        !object.properties[String(key)] &&
        key !== "Parent" &&
        key !== "Name" &&
        key !== "ClassName"
      )
        return {
          kind: "property",
          id: `${base.id}:property:${key}`,
          instanceId: base.id,
          key,
          runtime: true,
        };
    }
    const result = super.member(base, key, f, seen);
    return result.reason === "MODULE_MEMBER_NOT_FOUND"
      ? { kind: "literal", value: null }
      : result;
  }
}
