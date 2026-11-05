import type { Node } from "../../../packages/contracts/src/model.js";
import type { projectGraph } from "./graph-projection.js";
import type { Link } from "./layout.js";
type View = ReturnType<typeof projectGraph>;

export function focusGraph(view: View, focusId?: string) {
  const ids = new Set(view.nodes.map((n) => n.id));
  if (!focusId || !ids.has(focusId))
    return {
      ...view,
      hiddenNodes: 0,
      hiddenConnections: 0,
      boundaryConnections: 0,
    };
  const visible = new Set([focusId]);
  for (const e of view.edges) {
    if (e.source === focusId) visible.add(e.target);
    if (e.target === focusId) visible.add(e.source);
  }
  const edges = view.edges.filter(
    (e) => visible.has(e.source) && visible.has(e.target),
  );
  return {
    ...view,
    nodes: view.nodes.filter((n) => visible.has(n.id)),
    edges,
    hiddenNodes: view.nodes.length - visible.size,
    hiddenConnections: view.edges.length - edges.length,
    boundaryConnections: view.edges.filter(
      (e) => visible.has(e.source) !== visible.has(e.target),
    ).length,
  };
}

export function directedLayoutLinks(view: View): Link[] {
  const links = new Map<string, Link>();
  for (const e of view.edges)
    for (const d of e.directions)
      links.set(JSON.stringify([d.source, d.target]), {
        source: d.source,
        target: d.target,
      });
  return [...links.values()];
}

export function contextualLabels(nodes: Node[]) {
  const counts = new Map<string, number>();
  for (const n of nodes) counts.set(n.label, (counts.get(n.label) ?? 0) + 1);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const paths = new Map(
    nodes.map((n) => {
      if (n.attributes.path ?? n.attributes.instancePath)
        return [
          n.id,
          String(n.attributes.path ?? n.attributes.instancePath),
        ] as const;
      const names = [n.label],
        seen = new Set([n.id]);
      let owner = n.ownerId;
      while (owner && !seen.has(owner) && names.length < 16) {
        seen.add(owner);
        const parent = byId.get(owner);
        if (!parent) {
          names.unshift(owner.split("/").at(-1) ?? owner);
          break;
        }
        names.unshift(parent.label);
        owner = parent.ownerId;
      }
      return [n.id, names.join(".")] as const;
    }),
  );
  const labels = new Map<string, string>();
  for (const n of nodes) {
    if (counts.get(n.label) === 1) {
      labels.set(n.id, n.label);
      continue;
    }
    const parts = paths
      .get(n.id)!
      .split(/[./\\]/)
      .filter(Boolean);
    if (parts.at(-1) === n.label) parts.pop();
    let context = parts.at(-1) ?? n.id;
    for (let size = 1; size <= parts.length; size++) {
      context = parts.slice(-size).join(".");
      if (
        !nodes.some(
          (other) =>
            other.id !== n.id &&
            other.label === n.label &&
            paths
              .get(other.id)!
              .split(/[./\\]/)
              .filter(Boolean)
              .filter((p, i, a) => i !== a.length - 1 || p !== other.label)
              .slice(-size)
              .join(".") === context,
        )
      )
        break;
    }
    // Identical paths can still refer to different saved objects.
    const collisions = nodes
      .filter(
        (other) =>
          other.label === n.label && paths.get(other.id) === paths.get(n.id),
      )
      .map((other) => other.id)
      .sort();
    if (collisions.length > 1) context += ` · ${collisions.indexOf(n.id) + 1}`;
    if (context.length > 64 || /[a-f0-9]{24,}/i.test(context)) {
      const peers = nodes
        .filter((other) => other.label === n.label)
        .map((other) => other.id)
        .sort();
      context = `${n.kind === "instance" ? "object" : n.kind} ${peers.indexOf(n.id) + 1}`;
    }
    labels.set(n.id, `${n.label} · ${context}`);
  }
  return labels;
}

export function arrangementKey(analysis: string, view: View, intent: string) {
  // The complete string avoids hash collisions silently restoring a wrong graph.
  return JSON.stringify([
    "layout-v2",
    analysis,
    intent,
    view.nodes
      .map((n) => [n.id, n.label, n.kind, n.attributes.path ?? n.ownerId ?? ""])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    view.edges
      .map((e) => [
        e.source,
        e.target,
        [...e.relationIds].sort(),
        e.bidirectional,
      ])
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
  ]);
}
