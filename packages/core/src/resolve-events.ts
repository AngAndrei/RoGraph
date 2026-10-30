import type {
  Snapshot,
  Facts,
  Resolution,
  Expr,
  Site,
  Context,
} from "../../contracts/src/model.js";
import { ModuleResolver } from "./module-values.js";
import { unknown, type Value } from "./resolver.js";
import { emptyResolution, mark, emit } from "./resolution.js";
import { resolveContexts } from "./execution-context.js";
const sends: Record<string, string[]> = {
  RemoteEvent: ["FireServer", "FireClient", "FireAllClients"],
  UnreliableRemoteEvent: ["FireServer", "FireClient", "FireAllClients"],
  RemoteFunction: ["InvokeServer", "InvokeClient"],
  BindableEvent: ["Fire"],
  BindableFunction: ["Invoke"],
};
const signals: Record<string, string[]> = {
  RemoteEvent: ["OnServerEvent", "OnClientEvent"],
  UnreliableRemoteEvent: ["OnServerEvent", "OnClientEvent"],
  BindableEvent: ["Event"],
};
const callbacks: Record<string, string[]> = {
  RemoteFunction: ["OnServerInvoke", "OnClientInvoke"],
  BindableFunction: ["OnInvoke"],
};
const commonSignals = new Set([
  "Changed",
  "AncestryChanged",
  "Destroying",
  "ChildAdded",
  "ChildRemoved",
  "DescendantAdded",
  "DescendantRemoving",
]);
class EventResolver extends ModuleResolver {
  override member(
    base: Value,
    key: string,
    f: Facts,
    seen: Set<string>,
  ): Value {
    if (base.kind === "instance") {
      const i = this.objects.get(base.id!)!;
      if (
        (signals[i.className] ?? []).includes(key) ||
        commonSignals.has(key) ||
        (/Part$/.test(i.className) &&
          ["Touched", "TouchEnded"].includes(key)) ||
        (["TextButton", "ImageButton"].includes(i.className) &&
          ["Activated", "MouseButton1Click"].includes(key))
      )
        return {
          kind: "signal",
          id: i.id,
          signal: key,
          className: i.className,
        };
      if (key === "GetPropertyChangedSignal")
        return { kind: "native", method: key, receiver: i.id };
    }
    return super.member(base, key, f, seen);
  }
  override get(e: Expr | undefined, f: Facts, seen = new Set<string>()): Value {
    if (e?.kind === "call") {
      const callee = this.get(e.callee as Expr, f, seen);
      if (
        callee.kind === "native" &&
        callee.method === "GetPropertyChangedSignal"
      ) {
        const key = this.get((e.args as Expr[])[0], f, seen);
        return typeof key.value === "string"
          ? {
              kind: "signal",
              id: callee.receiver,
              signal: `PropertyChanged(${key.value})`,
              className: this.objects.get(callee.receiver)!.className,
            }
          : unknown("DYNAMIC_SIGNAL_PROPERTY");
      }
    }
    return super.get(e, f, seen);
  }
}
export function resolveEvents(
  snapshot: Snapshot,
  facts: Facts[],
  instances: Resolution,
  calls: Resolution,
): Resolution {
  const result = emptyResolution(),
    resolver = new EventResolver(snapshot, facts),
    contexts = resolveContexts(snapshot, facts, instances);
  const record = (
    raw: Site,
    channel: Value,
    method: string,
    source: string,
    type: "SENDS_VIA" | "HANDLES" | "CONNECTS_SIGNAL",
  ) => {
    let ctx = contexts.get(raw.ownerId) ?? ["unknown"];
    const role: Context | undefined = [
      "FireServer",
      "InvokeServer",
      "OnClientEvent",
      "OnClientInvoke",
    ].includes(method)
      ? "client"
      : [
            "FireClient",
            "FireAllClients",
            "InvokeClient",
            "OnServerEvent",
            "OnServerInvoke",
          ].includes(method)
        ? "server"
        : undefined;
    const site = {
      ...raw,
      contexts: ctx,
      assumptions: [
        ...raw.assumptions,
        "This records a potential channel/registration, not an observed execution.",
      ],
    };
    if (role && !ctx.includes(role) && !ctx.includes("unknown")) {
      mark(result, site, unknown("EXECUTION_CONTEXT_MISMATCH", [channel.id!]));
      result.diagnostics.push({
        code: "EXECUTION_CONTEXT_MISMATCH",
        severity: "warning",
        message: `${method} is incompatible with this saved script context`,
        siteId: site.id,
      });
      return;
    }
    if (role && ctx.includes(role)) site.contexts = [role];
    if (method === "OnServerEvent")
      site.assumptions.push(
        "The server callback receives an implicit player argument.",
      );
    const s = mark(result, site, { kind: "instance", id: channel.id });
    emit(
      result,
      source,
      channel.id!,
      type,
      s,
      "identified-channel",
      `${resolver.objects.get(channel.id!)!.className}.${method}`,
    );
  };
  for (const f of facts) {
    for (const raw of f.sites.filter((s) => s.kind === "call")) {
      const e = raw.expression,
        callee = e.callee as Expr;
      if (callee.kind !== "index") continue;
      const key = resolver.get(callee.key as Expr, f);
      if (typeof key.value !== "string") continue;
      const method = key.value,
        receiver = resolver.get(callee.base as Expr, f);
      if (
        [
          "FireServer",
          "FireClient",
          "FireAllClients",
          "InvokeServer",
          "InvokeClient",
          "Fire",
          "Invoke",
        ].includes(method)
      ) {
        if (
          receiver.kind === "instance" &&
          (sends[resolver.objects.get(receiver.id!)!.className] ?? []).includes(
            method,
          )
        )
          record(raw, receiver, method, raw.ownerId, "SENDS_VIA");
        else
          mark(
            result,
            raw,
            receiver.kind === "unknown"
              ? receiver
              : unknown("UNSUPPORTED_SEND_TARGET"),
          );
      } else if (["Connect", "Once"].includes(method)) {
        if (receiver.kind === "signal") {
          const handler = resolver.callable(
            resolver.get((e.args as Expr[])[0], f),
          );
          if (handler.kind === "function")
            record(
              raw,
              receiver,
              receiver.signal,
              handler.id!,
              (signals[receiver.className] ?? []).includes(receiver.signal)
                ? "HANDLES"
                : "CONNECTS_SIGNAL",
            );
          else mark(result, raw, unknown("HANDLER_TARGET_UNRESOLVED"));
        } else
          mark(
            result,
            raw,
            receiver.kind === "unknown"
              ? receiver
              : unknown("SIGNAL_TARGET_UNRESOLVED"),
          );
      }
    }
    for (const member of f.members as any[]) {
      const t = member.target as Expr;
      if (t.kind !== "index") continue;
      const key = resolver.get(t.key as Expr, f),
        receiver = resolver.get(t.base as Expr, f);
      if (
        typeof key.value !== "string" ||
        !Object.values(callbacks).some((v) => v.includes(String(key.value)))
      )
        continue;
      const site = f.sites.find(
        (s) => s.kind === "write" && s.span.startByte === t.span.startByte,
      );
      if (!site) continue;
      if (
        receiver.kind === "instance" &&
        (
          callbacks[resolver.objects.get(receiver.id!)!.className] ?? []
        ).includes(key.value)
      ) {
        const handler = resolver.callable(resolver.get(member.value, f));
        if (handler.kind === "function") {
          const count = (f.members as any[]).filter(
            (m) =>
              m.target.kind === "index" &&
              m.target.key?.value === key.value &&
              resolver.get(m.target.base, f).id === receiver.id,
          ).length;
          if (count > 1) {
            mark(result, site, unknown("REASSIGNED_CALLBACK", [receiver.id!]));
            continue;
          }
          record(site, receiver, key.value, handler.id!, "HANDLES");
        } else mark(result, site, unknown("HANDLER_TARGET_UNRESOLVED"));
      } else if (receiver.kind === "unknown") mark(result, site, receiver);
    }
  }
  return result;
}
