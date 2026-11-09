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
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const namesakes = new Map<string, string[][]>();
  const contexts = nodes.map((node) => {
    const path = node.attributes.path ?? node.attributes.instancePath;
    const inherited = Array.isArray(node.attributes.labelAncestors)
      ? node.attributes.labelAncestors.filter(
          (value): value is string => typeof value === "string",
        )
      : [];
    const parts = path
      ? String(path)
          .split(/[./\\]/)
          .filter(Boolean)
      : [...inherited];
    if (path && parts.at(-1) === node.label) parts.pop();
    if (!path && !inherited.length) {
      const seen = new Set([node.id]);
      const parentId =
        node.ownerId ??
        node.attributes.parentId ??
        (node.attributes.runtimeDefined ? node.attributes.scriptId : undefined);
      let owner = typeof parentId === "string" ? parentId : undefined;
      while (owner && !seen.has(owner) && parts.length < 16) {
        const parent = byId.get(String(owner));
        if (!parent) break;
        seen.add(owner);
        parts.unshift(parent.label);
        const nextOwner = parent.ownerId ?? parent.attributes.parentId;
        owner = typeof nextOwner === "string" ? nextOwner : undefined;
      }
    }
    const context = parts.filter(
      (part) => !/^\d+$/.test(part) && !/[a-f0-9]{24,}/i.test(part),
    );
    const peers = namesakes.get(node.label);
    if (peers) peers.push(context);
    else namesakes.set(node.label, [context]);
    return context;
  });
  return new Map(
    nodes.map((node, index) => {
      const peers = namesakes.get(node.label)!;
      const parts = contexts[index];
      if (node.kind === "instance" && /^\d+$/.test(node.label)) {
        const kind = String(node.attributes.className ?? "Object");
        const context = parts.slice(-2).join(".");
        return [
          node.id,
          `${kind} ${node.label}${context ? " · " + context : ""}`,
        ];
      }
      const parent = byId.get(
        String(node.ownerId ?? node.attributes.parentId ?? ""),
      );
      const assetChild =
        node.kind === "instance" &&
        ["Model", "Tool"].includes(
          String(
            parent?.attributes.className ?? node.attributes.parentClassName,
          ),
        );
      const generic =
        node.kind === "instance" && node.label === node.attributes.className;
      if ((peers.length === 1 && !assetChild && !generic) || !parts.length)
        return [node.id, node.label];
      const different = peers.filter(
        (other) => other.join(".") !== parts.join("."),
      );
      let context = parts.at(-1)!;
      for (let size = 1; size < parts.length; size++) {
        if (
          !different.some((other) => other.slice(-size).join(".") === context)
        )
          break;
        const longer = parts.slice(-size - 1).join(".");
        if (longer.length > 64) break;
        context = longer;
      }
      return [
        node.id,
        context.length <= 64 ? node.label + " · " + context : node.label,
      ];
    }),
  );
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
