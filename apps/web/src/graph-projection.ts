import type { QueryResult } from "../../../packages/contracts/src/query.js";
export const scripts = ["Script", "LocalScript", "ModuleScript"],
  channels = [
    "RemoteEvent",
    "UnreliableRemoteEvent",
    "RemoteFunction",
    "BindableEvent",
    "BindableFunction",
  ];
function bundleEdges(
  edges: {
    id: string;
    source?: string;
    target?: string;
    label: string;
    type: string;
    originalId: string;
    relationIds?: string[];
  }[],
) {
  const bundles = new Map<
    string,
    {
      id: string;
      source: string;
      target: string;
      label: string;
      type: string;
      originalId: string;
      relationIds: string[];
      bidirectional: boolean;
      directions: { source: string; target: string; relationIds: string[] }[];
    }
  >();
  for (const edge of edges) {
    if (!edge.source || !edge.target || edge.source === edge.target) continue;
    const key = JSON.stringify([edge.source, edge.target].sort());
    const bundle = bundles.get(key);
    if (bundle) {
      bundle.relationIds = [
        ...new Set([
          ...bundle.relationIds,
          ...(edge.relationIds ?? [edge.originalId]),
        ]),
      ];
      bundle.bidirectional ||= bundle.source !== edge.source;
      bundle.directions.push({
        source: edge.source,
        target: edge.target,
        relationIds: [...(edge.relationIds ?? [edge.originalId])],
      });
    } else
      bundles.set(key, {
        ...edge,
        source: edge.source,
        target: edge.target,
        relationIds: [...(edge.relationIds ?? [edge.originalId])],
        bidirectional: false,
        directions: [
          {
            source: edge.source,
            target: edge.target,
            relationIds: [...(edge.relationIds ?? [edge.originalId])],
          },
        ],
      });
  }
  return [...bundles.values()].map((e) => ({
    ...e,
    label:
      e.relationIds.length > 1
        ? `${e.relationIds.length} relationships`
        : e.label,
  }));
}
export function projectGraph(
  result: QueryResult,
  details: boolean,
  groupId = "all",
) {
  if (result.projection?.view === "gameplay") {
    const available = new Set(result.projection.nodeIds);
    const groups = result.groups
      .map((g) => ({
        ...g,
        nodeIds: g.nodeIds.filter((id) => available.has(id)),
      }))
      .filter((g) => g.nodeIds.length);
    const chosen =
      groupId === "all" ? undefined : groups.find((g) => g.id === groupId);
    const nodes = result.nodes.filter(
        (n) =>
          available.has(n.id) && (!chosen || chosen.nodeIds.includes(n.id)),
      ),
      ids = new Set(nodes.map((n) => n.id));
    const edges = result.projection.edges
      .filter((e) => ids.has(e.source) && ids.has(e.target))
      .map((e) => ({
        ...e,
        type:
          result.relations.find((r) => r.id === e.relationIds[0])?.type ??
          "REFERENCES",
        originalId: e.id,
      }));
    return { nodes, edges: bundleEdges(edges), groups };
  }
  const all = new Map(result.nodes.map((n) => [n.id, n]));
  let visible = result.nodes.filter(
    (n) =>
      details ||
      (n.kind === "instance" &&
        [...scripts, ...channels].includes(String(n.attributes.className))),
  );
  const ids = new Set(visible.map((n) => n.id));
  const owner = (id: string) => {
    const n = all.get(id);
    return ids.has(id)
      ? id
      : ids.has(String(n?.attributes.scriptId))
        ? String(n?.attributes.scriptId)
        : ids.has(n?.ownerId ?? "")
          ? n?.ownerId
          : undefined;
  };
  const groups = result.groups
    .map((group) => ({
      ...group,
      nodeIds: [
        ...new Set(
          group.nodeIds.map(owner).filter((id): id is string => Boolean(id)),
        ),
      ],
    }))
    .filter((group) => group.nodeIds.length);
  if (groupId !== "all") {
    const selected = groups.find((g) => g.id === groupId);
    if (selected) {
      visible = visible.filter((n) => selected.nodeIds.includes(n.id));
      ids.clear();
      for (const n of visible) ids.add(n.id);
    }
  }
  const edges = result.relations
    .filter(
      (r) => details || !["CONTAINS", "DECLARES", "MEMBER_OF"].includes(r.type),
    )
    .map((r) => ({
      ...r,
      source: owner(r.source),
      target: owner(r.target),
      originalId: r.id,
      label: r.type,
    }))
    .filter((r) => r.source && r.target && r.source !== r.target);
  return { nodes: visible, edges: bundleEdges(edges), groups };
}
