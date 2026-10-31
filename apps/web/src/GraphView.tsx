import { useEffect, useMemo, useRef, useState } from "react";
import Sigma from "sigma";
import { extremityArrow } from "sigma/rendering";
import {
  DEFAULT_PRIMITIVES,
  DEFAULT_STYLES,
  type PrimitivesDeclaration,
} from "sigma/types";
import Graph from "graphology";
import type { QueryResult } from "../../../packages/contracts/src/query.js";
import type { Node } from "../../../packages/contracts/src/model.js";
const scripts = ["Script", "LocalScript", "ModuleScript"],
  channels = [
    "RemoteEvent",
    "UnreliableRemoteEvent",
    "RemoteFunction",
    "BindableEvent",
    "BindableFunction",
  ];
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
    return { nodes, edges, groups };
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
  return { nodes: visible, edges, groups };
}
function color(n: Node) {
  return n.kind === "unresolved"
    ? "#de7385"
    : n.kind === "field"
      ? "#d5a13f"
      : n.kind === "function"
        ? "#8e79ca"
        : n.attributes.className === "LocalScript"
          ? "#669bea"
          : n.attributes.className === "ModuleScript"
            ? "#9c80d5"
            : channels.includes(String(n.attributes.className))
              ? "#dfad51"
              : n.attributes.className === "Script"
                ? "#55ad99"
                : "#a2adbb";
}
export function GraphView({
  result,
  details,
  onSelect,
  onEdge,
}: {
  result: QueryResult;
  details: boolean;
  onSelect: (id: string) => void;
  onEdge?: (id: string) => void;
}) {
  const container = useRef<HTMLDivElement>(null),
    renderer = useRef<Sigma | null>(null),
    [error, setError] = useState(""),
    [group, setGroup] = useState("all");
  const activeGroup = result.groups.some((g) => g.id === group) ? group : "all";
  const view = useMemo(
    () => projectGraph(result, details, activeGroup),
    [result, details, activeGroup],
  );
  const selectRef = useRef(onSelect),
    edgeRef = useRef(onEdge);
  selectRef.current = onSelect;
  edgeRef.current = onEdge;
  useEffect(() => {
    if (!container.current) return;
    setError("");
    const g = new Graph({ multi: true, type: "directed" });
    view.nodes.forEach((n, i) =>
      g.addNode(n.id, {
        label: n.label,
        x: Math.cos(i * 2.399) * Math.sqrt(i + 1),
        y: Math.sin(i * 2.399) * Math.sqrt(i + 1),
        size: n.kind === "instance" ? 13 : 8,
        color: color(n),
        labelColor: "#435069",
        labelSize: 12,
        labelFont: "Segoe UI",
        labelVisibility: "visible",
      }),
    );
    view.edges.forEach((e) =>
      g.addDirectedEdgeWithKey(e.id, e.source!, e.target!, {
        label: e.label,
        size: 1.5,
        color: ["SENDS_VIA", "HANDLES"].includes(e.type)
          ? "#bea46c"
          : "#bbc8d8",
        head: "arrow",
        originalId: e.originalId,
      }),
    );
    let worker: Worker | undefined;
    try {
      const sigma = new Sigma(g, container.current, {
        primitives: {
          ...DEFAULT_PRIMITIVES,
          edges: {
            ...DEFAULT_PRIMITIVES.edges,
            extremities: [extremityArrow()],
            defaultHead: "arrow",
          },
        } as PrimitivesDeclaration,
        styles: {
          nodes: {
            ...DEFAULT_STYLES.nodes,
            labelColor: "#526880",
            labelFont: "Segoe UI",
            labelSize: 11,
          },
          edges: { ...DEFAULT_STYLES.edges, head: "arrow" },
        },
        settings: {
          itemSizesReference: "screen",
          enableEdgeEvents: true,
          enableNodeDrag: true,
          labelRenderedSizeThreshold: 0,
          stagePadding: 65,
          allowInvalidContainer: true,
        },
      });
      renderer.current = sigma;
      sigma.on("clickNode", (e) => selectRef.current(e.node));
      sigma.on("clickEdge", (e) =>
        edgeRef.current?.(g.getEdgeAttribute(e.edge, "originalId")),
      );
      worker = new Worker(new URL("./layout.worker.ts", import.meta.url), {
        type: "module",
      });
      worker.onmessage = (e) => {
        for (const p of e.data)
          if (g.hasNode(p.id)) g.mergeNodeAttributes(p.id, { x: p.x, y: p.y });
        sigma.refresh();
        requestAnimationFrame(() =>
          container.current?.setAttribute("data-layout-ready", "true"),
        );
      };
      worker.postMessage({
        nodes: view.nodes.map((n) => n.id),
        edges: view.edges.map((e) => ({ source: e.source, target: e.target })),
        groups: view.groups,
      });
    } catch (e) {
      console.error(
        "Graph rendering failed: " +
          (e instanceof Error ? e.message : String(e)),
      );
      setError(
        "The graph renderer is unavailable. Browse the same nodes below.",
      );
    }
    return () => {
      worker?.terminate();
      renderer.current?.kill();
      renderer.current = null;
    };
  }, [view]);
  return (
    <div className="graph-area">
      {view.groups.length > 0 && (
        <div className="group-navigator">
          <label>
            Visible group{" "}
            <select
              aria-label="Visible group"
              value={activeGroup}
              onChange={(e) => setGroup(e.target.value)}
            >
              <option value="all">All {view.groups.length} groups</option>
              {view.groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.label} · {g.nodeIds.length}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      <div
        ref={container}
        className="sigma-container"
        data-analysis-id={result.analysisId}
        aria-label="Project relationship graph"
      />
      <div className="graph-guide">
        <span className="eyebrow">
          {result.projection?.view === "gameplay"
            ? "GAMEPLAY CONNECTIONS"
            : details
              ? "METHODS & CONFIGURATION"
              : "CODE CONNECTIONS"}
        </span>
        <p>
          {view.nodes.length} nodes · {view.edges.length} links
          <br />
          Select a node to see how it connects.
        </p>
      </div>
      <div className="graph-controls">
        <button
          aria-label="Zoom in"
          onClick={() =>
            void renderer.current?.getCamera().zoomIn({ duration: 180 })
          }
        >
          +
        </button>
        <button
          aria-label="Zoom out"
          onClick={() =>
            void renderer.current?.getCamera().zoomOut({ duration: 180 })
          }
        >
          −
        </button>
        <button
          aria-label="Fit graph"
          onClick={() =>
            void renderer.current?.getCamera().reset({ duration: 180 })
          }
        >
          ⌖
        </button>
      </div>
      <div className="graph-legend">
        {[
          ["#669bea", "Client"],
          ["#55ad99", "Server"],
          ["#9c80d5", "Module"],
          ["#dfad51", "Channel / field"],
          ["#de7385", "Unresolved"],
        ].map(([c, label]) => (
          <span key={label}>
            <i style={{ background: c }} />
            {label}
          </span>
        ))}
      </div>
      <details className="graph-node-list" open={Boolean(error)}>
        <summary>{error || "Browse visible nodes"}</summary>
        <div>
          {view.nodes.map((n) => (
            <button key={n.id} onClick={() => onSelect(n.id)}>
              {n.label}
            </button>
          ))}
        </div>
      </details>
    </div>
  );
}
