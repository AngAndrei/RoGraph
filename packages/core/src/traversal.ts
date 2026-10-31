import type { GraphStore } from "./store.js";
import type { Query, QueryResult, PathHop } from "../../contracts/src/query.js";
import type {
  Evidence,
  Relation,
  RelationType,
} from "../../contracts/src/model.js";
import { gameplayTypes } from "../../contracts/src/gameplay.js";
export const dependencyTypes: RelationType[] = [
  "CALLS",
  "REQUIRES",
  "READS",
  "WRITES",
  "REFERENCES",
];
const pairs: Record<string, string> = {
  "RemoteEvent.FireServer": "RemoteEvent.OnServerEvent",
  "RemoteEvent.FireClient": "RemoteEvent.OnClientEvent",
  "RemoteEvent.FireAllClients": "RemoteEvent.OnClientEvent",
  "UnreliableRemoteEvent.FireServer": "UnreliableRemoteEvent.OnServerEvent",
  "UnreliableRemoteEvent.FireClient": "UnreliableRemoteEvent.OnClientEvent",
  "UnreliableRemoteEvent.FireAllClients": "UnreliableRemoteEvent.OnClientEvent",
  "RemoteFunction.InvokeServer": "RemoteFunction.OnServerInvoke",
  "RemoteFunction.InvokeClient": "RemoteFunction.OnClientInvoke",
  "BindableEvent.Fire": "BindableEvent.Event",
  "BindableFunction.Invoke": "BindableFunction.OnInvoke",
};
export function compatible(send: Evidence[], handlers: Evidence[]): boolean {
  return send.some((s) =>
    handlers.some(
      (h) =>
        pairs[s.mechanism ?? ""] === h.mechanism &&
        (!s.mechanism?.startsWith("Bindable") ||
          s.contexts.includes("unknown") ||
          h.contexts.includes("unknown") ||
          s.contexts.some((c) => h.contexts.includes(c))),
    ),
  );
}
export async function traverse(
  store: GraphStore,
  q: Query,
  result: QueryResult,
  roots: string[],
  targets: string[],
  maxNodes: number,
  signal?: AbortSignal,
) {
  const depth = Math.min(q.depth ?? 3, 6),
    impact = q.op === "impact",
    nodeIds = new Set(roots),
    rels = new Map<string, Relation>(),
    evidence = new Map<string, Evidence>(),
    visited = new Set<string>();
  type State = {
    id: string;
    path: PathHop[];
    pending?: Evidence[];
    potential: boolean;
    scope?: string[];
  };
  let frontier: State[] = roots.map((id) => ({
    id,
    path: [],
    potential: false,
  }));
  const allowed = (t: RelationType) =>
    !q.relationTypes || q.relationTypes.includes(t);
  for (let level = 0; frontier.length && level < depth; level++) {
    signal?.throwIfAborted();
    const ids = [...new Set(frontier.map((s) => s.id))];
    const ordinary = (
      q.view === "gameplay"
        ? [...gameplayTypes].filter(
            (t) =>
              q.op !== "trace" ||
              q.traceGoal === "influence" ||
              !["READS_CONFIG", "CONFIGURED_BY"].includes(t),
          )
        : dependencyTypes
    ).filter(allowed);
    const directions =
      q.view === "gameplay"
        ? [
            {
              direction: impact ? ("in" as const) : ("out" as const),
              types: ordinary,
            },
          ]
        : impact
          ? [
              {
                direction: "in" as const,
                types: [
                  ...ordinary,
                  ...(allowed("SENDS_VIA") ? ["SENDS_VIA" as const] : []),
                ],
              },
              {
                direction: "out" as const,
                types: allowed("HANDLES") ? ["HANDLES" as const] : [],
              },
            ]
          : [
              {
                direction: "out" as const,
                types: [
                  ...ordinary,
                  ...(allowed("SENDS_VIA") ? ["SENDS_VIA" as const] : []),
                ],
              },
              {
                direction: "in" as const,
                types: allowed("HANDLES") ? ["HANDLES" as const] : [],
              },
            ];
    const batches = await Promise.all(
      directions.map((d) =>
        d.types.length
          ? store.select({
              op: "adjacent",
              analysisId: q.analysisId,
              nodeIds: ids,
              direction: d.direction,
              relationTypes: d.types,
              limit: 1000,
            })
          : Promise.resolve({
              ...result,
              relations: [],
              meta: { ...result.meta, truncated: false },
            }),
      ),
    );
    const all = batches.flatMap((b) => b.relations),
      ev = await store.select({
        op: "evidence",
        analysisId: q.analysisId,
        relationIds: all.map((r) => r.id),
        limit: 5000,
      });
    const evMap = new Map<string, Evidence[]>();
    for (const e of ev.evidence) {
      if (
        (q.statuses?.length && !q.statuses.includes(e.status)) ||
        (q.contexts?.length && !e.contexts.some((c) => q.contexts!.includes(c)))
      )
        continue;
      const list = evMap.get(e.relationId) ?? [];
      list.push(e);
      evMap.set(e.relationId, list);
    }
    if (batches.some((b) => b.meta.truncated) || ev.meta.truncated) {
      result.meta.truncated = true;
      result.meta.omittedCounts.adjacencyOrEvidenceAtLeast = 1;
    }
    const endpoints = [...new Set(all.flatMap((r) => [r.source, r.target]))];
    const selected = await store.select({
      op: "nodes",
      analysisId: q.analysisId,
      ids: endpoints,
      limit: 1000,
      classes: q.classes,
    });
    const available = new Map(selected.nodes.map((n) => [n.id, n]));
    const next: State[] = [];
    for (const state of frontier)
      for (let batch = 0; batch < batches.length; batch++)
        for (const r of batches[batch].relations) {
          const direction = directions[batch].direction,
            isOut = direction === "out";
          if ((isOut ? r.source : r.target) !== state.id) continue;
          if (q.view === "gameplay" && r.gameplay?.scopeIncomplete) {
            result.meta.truncated = true;
            result.meta.omittedCounts.handlerReachabilityAtLeast = 1;
          }
          const id = isOut ? r.target : r.source,
            occ = evMap.get(r.id) ?? [];
          if (q.view === "gameplay" && r.type === "USES_OBJECT") continue;
          if (
            q.view === "gameplay" &&
            isOut &&
            state.scope &&
            r.gameplay?.sourceScriptId === state.id &&
            !state.scope.includes(
              r.gameplay.ownerId ?? r.gameplay.sourceScriptId,
            )
          )
            continue;
          if (
            q.view === "gameplay" &&
            !isOut &&
            state.scope &&
            r.gameplay?.handlerId &&
            !(r.gameplay.reachableOwnerIds ?? [r.gameplay.handlerId]).some(
              (owner) => state.scope!.includes(owner),
            )
          )
            continue;
          if (!occ.length || !available.has(id)) continue;
          const channelHop = impact
            ? r.type === "SENDS_VIA" ||
              (!!r.gameplay && r.gameplay.method in pairs)
            : r.type === "HANDLES" ||
              (!!r.gameplay &&
                Object.values(pairs).includes(r.gameplay.method));
          if (
            channelHop &&
            state.pending &&
            !compatible(
              impact ? occ : state.pending,
              impact ? state.pending : occ,
            )
          )
            continue;
          if (state.path.some((h) => h.fromId === id)) continue;
          if (!nodeIds.has(id) && nodeIds.size >= maxNodes) {
            result.meta.truncated = true;
            result.meta.omittedCounts.nodesAtLeast = 1;
            continue;
          }
          if (evidence.size >= 5000 && !rels.has(r.id)) {
            result.meta.truncated = true;
            result.meta.omittedCounts.evidenceAtLeast = 1;
            continue;
          }
          nodeIds.add(id);
          rels.set(r.id, r);
          for (const e of occ)
            if (evidence.has(e.id) || evidence.size < 5000)
              evidence.set(e.id, e);
            else {
              result.meta.truncated = true;
              result.meta.omittedCounts.evidenceAtLeast = 1;
            }
          const potential =
            state.potential ||
            !!r.gameplay ||
            r.type === "HANDLES" ||
            r.type === "SENDS_VIA";
          const transition: PathHop["transition"] = potential
            ? impact
              ? "potential-impact"
              : "potential-communication"
            : "dependency";
          const path = [
            ...state.path,
            {
              relationId: r.id,
              fromId: state.id,
              toId: id,
              direction: isOut ? ("forward" as const) : ("reverse" as const),
              transition,
            },
          ];
          if (q.op !== "trace" || targets.includes(id)) {
            if (result.paths.length < 5) result.paths.push(path);
            else {
              result.meta.truncated = true;
              result.meta.omittedCounts.pathsAtLeast = 1;
            }
          }
          const pending = (
            impact
              ? r.type === "HANDLES" ||
                (!!r.gameplay &&
                  Object.values(pairs).includes(r.gameplay.method))
              : r.type === "SENDS_VIA" ||
                (!!r.gameplay && r.gameplay.method in pairs)
          )
            ? occ
            : undefined;
          const scope =
            q.view !== "gameplay"
              ? undefined
              : isOut
                ? r.gameplay?.handlerId
                  ? (r.gameplay.reachableOwnerIds ?? [r.gameplay.handlerId])
                  : state.scope
                : r.gameplay?.sourceScriptId === id
                  ? [r.gameplay.ownerId ?? id]
                  : state.scope;
          const key =
            id +
            "|" +
            (pending
              ?.map((e) => e.mechanism)
              .sort()
              .join(",") ?? "") +
            "|" +
            potential +
            "|" +
            (scope?.join(",") ?? "");
          if (!visited.has(key)) {
            visited.add(key);
            next.push({ id, path, pending, potential, scope });
          }
        }
    frontier = next;
  }
  if (frontier.length) {
    result.meta.truncated = true;
    result.meta.omittedCounts.depthFrontier = frontier.length;
  }
  if (q.op === "trace") {
    const used = new Set(
      result.paths.flatMap((p) => p.map((h) => h.relationId)),
    );
    for (const id of [...rels.keys()]) if (!used.has(id)) rels.delete(id);
    nodeIds.clear();
    for (const p of result.paths)
      for (const h of p) {
        nodeIds.add(h.fromId);
        nodeIds.add(h.toId);
      }
  }
  result.nodes = (
    await store.select({
      op: "nodes",
      analysisId: q.analysisId,
      ids: [...nodeIds],
      limit: maxNodes,
    })
  ).nodes;
  result.relations = [...rels.values()];
  result.evidence = [...evidence.values()]
    .filter((e) => rels.has(e.relationId))
    .slice(0, 5000);
  result.meta.limits = {
    ...result.meta.limits,
    depth,
    nodes: maxNodes,
    paths: 5,
  };
}
