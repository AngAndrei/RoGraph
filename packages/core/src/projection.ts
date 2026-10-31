import type { QueryResult } from "../../contracts/src/query.js";
import { hash } from "./util.js";
export function projectResult(
  result: QueryResult,
  view: "code" | "gameplay",
  includeIntrinsics = true,
): QueryResult {
  const available = result.capabilities?.gameplay ?? false;
  const scope: Record<string, { unresolved: number; candidate: number }> = {};
  const owners = new Map(
    result.nodes.map((n) => [
      n.id,
      String(n.attributes.scriptId ?? n.ownerId ?? n.id),
    ]),
  );
  for (const site of result.sites) {
    if (!["unresolved", "candidate"].includes(site.status)) continue;
    const owner = owners.get(site.ownerId) ?? site.ownerId;
    scope[owner] ??= { unresolved: 0, candidate: 0 };
    scope[owner][site.status === "unresolved" ? "unresolved" : "candidate"]++;
  }
  const relations = result.relations.filter((r) =>
    view === "gameplay" ? !!r.gameplay : !r.gameplay,
  );
  const nodes = result.nodes.filter((n) =>
    view === "gameplay"
      ? n.kind === "instance"
      : includeIntrinsics || !n.attributes.builtin,
  );
  const ids = new Set(nodes.map((n) => n.id)),
    kept = relations.filter((r) => ids.has(r.source) && ids.has(r.target));
  const relationIds = new Set(kept.map((r) => r.id));
  const edgeMap = new Map<
    string,
    {
      id: string;
      source: string;
      target: string;
      label: string;
      relationIds: string[];
      conditional: boolean;
    }
  >();
  for (const r of kept) {
    const key = [
      r.source,
      r.target,
      r.gameplay?.label ?? r.type,
      r.gameplay?.ownerId ?? "",
      r.gameplay?.handlerId ?? "",
    ].join("|");
    const item = edgeMap.get(key) ?? {
      id: "projection:" + hash(key),
      source: r.source,
      target: r.target,
      label: r.gameplay?.label ?? r.type,
      relationIds: [],
      conditional: false,
    };
    item.relationIds.push(r.id);
    item.conditional ||= r.gameplay?.conditional ?? false;
    edgeMap.set(key, item);
  }
  return {
    ...result,
    nodes,
    relations: kept,
    evidence: result.evidence.filter((e) => relationIds.has(e.relationId)),
    paths: result.paths.filter((p) =>
      p.every((h) => relationIds.has(h.relationId)),
    ),
    projection: {
      view,
      available: view === "code" || available,
      nodeIds: nodes.map((n) => n.id),
      edges: [...edgeMap.values()],
      diagnosticsByOwner: scope,
    },
  };
}
