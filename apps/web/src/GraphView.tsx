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
import {
  contextualLabels,
  focusGraph,
  arrangementKey,
} from "./graph-exploration.js";
import {
  validPositions,
  type LayoutRequest,
  type LayoutResponse,
} from "./layout-protocol.js";
type Arrangement = {
  positions: Map<string, { x: number; y: number }>;
  camera: ReturnType<ReturnType<Sigma["getCamera"]>["getState"]>;
  bbox: ReturnType<Sigma["getCustomBBox"]>;
  pins: Set<string>;
};
// View state belongs to the browser session, separate from saved analysis facts.
const arrangements = new Map<string, Arrangement>();
const latestArrangements = new Map<string, Arrangement>();
let layoutRequestSequence = 0;
const labelFont = "Segoe UI";
const labelSize = 11;
const labelPreviewWidth = 136;
const graphemes = new Intl.Segmenter();

function previewLabel(label: string, context: CanvasRenderingContext2D | null) {
  if (!context || context.measureText(label).width <= labelPreviewWidth)
    return label;

  let prefix = "";
  for (const { segment } of graphemes.segment(label)) {
    if (context.measureText(prefix + segment + "…").width > labelPreviewWidth)
      break;
    prefix += segment;
  }
  return prefix.trimEnd() + "…";
}

import { projectGraph, channels } from "./graph-projection.js";
export { projectGraph } from "./graph-projection.js";
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
type GraphControls = {
  group: string;
  focusId: string;
};
const defaultControls: GraphControls = {
  group: "all",
  focusId: "",
};

export function GraphView({
  result,
  details,
  onSelect,
  onEdge,
  selectedId,
  arrangementScope = "",
  showClassMatches = false,
}: {
  result: QueryResult;
  details: boolean;
  onSelect: (id: string) => void;
  onEdge?: (id: string, relationIds?: string[], sourceId?: string) => void;
  selectedId?: string;
  arrangementScope?: string;
  showClassMatches?: boolean;
}) {
  const container = useRef<HTMLDivElement>(null),
    renderer = useRef<Sigma | null>(null),
    [error, setError] = useState(""),
    [controlsByView, setControlsByView] = useState<
      Record<string, GraphControls>
    >({}),
    [localSelection, setLocalSelection] = useState(""),
    [busy, setBusy] = useState(false);
  const controlsKey = JSON.stringify([
    result.analysisId,
    result.projection?.view,
    arrangementScope,
  ]);
  const { group, focusId } = controlsByView[controlsKey] ?? defaultControls;
  const updateControls = (changes: Partial<GraphControls>) => {
    setControlsByView((current) => ({
      ...current,
      [controlsKey]: {
        ...(current[controlsKey] ?? defaultControls),
        ...changes,
      },
    }));
  };
  const selection = selectedId ?? localSelection;
  const fullView = useMemo(
    () => projectGraph(result, details, group, showClassMatches),
    [result, details, group, showClassMatches],
  );
  const activeGroup = fullView.groups.some((g) => g.id === group)
    ? group
    : "all";
  const activeFocus = fullView.nodes.some((n) => n.id === focusId)
    ? focusId
    : "";
  const view = useMemo(
    () => focusGraph(fullView, activeFocus),
    [fullView, activeFocus],
  );
  const labels = useMemo(() => contextualLabels(result.nodes), [result.nodes]);
  const selectionRef = useRef(selection);
  const dragSelection = useRef(new Set<string>());
  selectionRef.current = selection;
  const selectionStyle = (sigma: Sigma) => {
    const g = sigma.getGraph(),
      selected = dragSelection.current;
    for (const n of g.nodes())
      sigma.setNodeState(n, {
        isHighlighted: selected.size
          ? selected.has(n)
          : n === selectionRef.current,
      });
  };
  useEffect(() => {
    dragSelection.current.clear();
    if (renderer.current) selectionStyle(renderer.current);
  }, [selection]);
  const selectRef = useRef(onSelect),
    edgeRef = useRef(onEdge);
  selectRef.current = onSelect;
  edgeRef.current = onEdge;
  useEffect(() => {
    if (!container.current) return;
    setError("");
    container.current.setAttribute(
      "data-layout-ready",
      String(!view.nodes.length),
    );
    if (!view.nodes.length) {
      setBusy(false);
      return;
    }
    const groups =
      activeGroup === "all" && !activeFocus && view.groups.length > 1
        ? view.groups.map((group) => group.nodeIds)
        : undefined;
    const key = JSON.stringify([
      result.analysisId,
      arrangementScope,
      result.projection?.view ?? "code",
      details,
      activeGroup,
      activeFocus,
      groups,
      arrangementKey(result.analysisId, view, "network"),
    ]);
    const saved = arrangements.get(key);
    const scope = JSON.stringify([
      result.analysisId,
      arrangementScope,
      result.projection?.view ?? "code",
      details,
      activeGroup,
      activeFocus,
    ]);
    const previous = latestArrangements.get(scope);
    const manualPins = new Set(saved?.pins ?? previous?.pins ?? []);
    setBusy(!saved);
    let ready = false;
    let completed = false;
    let optimized = false;
    const g = new Graph({ type: "directed" });
    const labelMeasure = document.createElement("canvas").getContext("2d");
    if (labelMeasure) labelMeasure.font = `${labelSize}px "${labelFont}"`;
    view.nodes.forEach((n, i) => {
      const label = labels.get(n.id) ?? n.label;
      g.addNode(n.id, {
        label,
        previewLabel: previewLabel(label, labelMeasure),
        x: Math.cos(i * 2.399) * Math.sqrt(i + 1),
        y: Math.sin(i * 2.399) * Math.sqrt(i + 1),
        size: (n.kind === "instance" ? 7 : 4) * 0.95,
        color: color(n),
        labelColor: "#435069",
        labelSize: 12,
        labelFont: "Segoe UI",
      });
    });
    view.edges.forEach((e) =>
      g.addDirectedEdgeWithKey(e.id, e.source!, e.target!, {
        label: e.label,
        size: 1.5,
        color: ["SENDS_VIA", "HANDLES"].includes(e.type)
          ? "#bea46c"
          : "#bbc8d8",
        head: "arrow",
        tail: e.bidirectional ? "arrow" : "none",
        originalId: e.originalId,
        relationIds: e.relationIds,
      }),
    );
    let worker: Worker | undefined;
    let disposed = false;
    let watchdog: ReturnType<typeof setTimeout> | undefined;
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
            label: {
              whenState: "isHovered",
              then: { attribute: "label" },
              else: { attribute: "previewLabel" },
            },
            color: {
              whenState: "isHovered",
              then: "#173c72",
              else: {
                whenState: "isHighlighted",
                then: "#245ca6",
                else: { attribute: "color" },
              },
            },
            labelColor: "#526880",
            labelFont,
            labelSize,
          },
          edges: {
            ...DEFAULT_STYLES.edges,
            head: "arrow",
          },
        },
        settings: {
          itemSizesReference: "screen",
          enableEdgeEvents: true,
          enableNodeDrag: Boolean(saved),
          getDraggedNodes: (id) =>
            dragSelection.current.has(id) ? [...dragSelection.current] : [id],
          labelGridCellSize: 128,
          labelDensity: 0.75,
          labelRenderedSizeThreshold: 0,
          stagePadding: 65,
          allowInvalidContainer: true,
        },
      });
      renderer.current = sigma;
      const clearance = new Map<string, number>();
      const resizeNodes = () => {
        const ratio = sigma.getCamera().getState().ratio;
        for (const n of view.nodes) {
          const base = (n.kind === "instance" ? 7 : 4) * 0.95;
          const size = Math.min(
            base,
            (((clearance.get(n.id) ?? Infinity) / ratio) * 0.36) /
              sigma.scaleSize(1),
          );
          if (Math.abs(g.getNodeAttribute(n.id, "size") - size) > 0.01)
            g.setNodeAttribute(n.id, "size", size);
        }
      };
      const measureClearance = () => {
        const ratio = sigma.getCamera().getState().ratio;
        const positions = g.nodes().map((id) => ({
          id,
          ...sigma.graphToViewport({
            x: g.getNodeAttribute(id, "x"),
            y: g.getNodeAttribute(id, "y"),
          }),
        }));
        for (const p of positions) {
          let nearest = Infinity;
          for (const other of positions)
            if (p !== other)
              nearest = Math.min(
                nearest,
                Math.hypot(p.x - other.x, p.y - other.y),
              );
          clearance.set(p.id, nearest * ratio);
        }
        resizeNodes();
      };
      // Preserve screen separation at fit, then restore ordinary sizes as the
      // user zooms in. Sizing does not change positions or move the camera.
      sigma.getCamera().on("updated", resizeNodes);
      sigma.on("resize", () =>
        requestAnimationFrame(() => {
          if (!disposed && clearance.size) measureClearance();
        }),
      );
      sigma.on("nodeDragStart", () => {
        // Keep the coordinate frame stable when an outer node changes the extent.
        if (!sigma.getCustomBBox()) sigma.setCustomBBox(sigma.getBBox());
      });
      sigma.on("nodeDragEnd", (e) => {
        for (const id of e.allDraggedNodes) manualPins.add(id);
      });
      const toggleDragSelection = (id: string) => {
        const selected = dragSelection.current;
        if (!selected.delete(id)) selected.add(id);
        selectionStyle(sigma);
      };
      const clearDragSelection = () => {
        if (!dragSelection.current.size) return;
        dragSelection.current.clear();
        selectionStyle(sigma);
      };
      sigma.on("clickStage", clearDragSelection);
      sigma.on("doubleClickStage", (e) => {
        if (!dragSelection.current.size) return;
        e.preventSigmaDefault();
        clearDragSelection();
      });
      sigma.on("doubleClickNode", (e) => {
        e.preventSigmaDefault();
        // Sigma emits a double-click event in place of the second rapid click.
        if (e.event.original.ctrlKey || e.event.original.metaKey)
          toggleDragSelection(e.node);
      });
      sigma.on("clickNode", (e) => {
        if (e.event.original.ctrlKey || e.event.original.metaKey) {
          toggleDragSelection(e.node);
          return;
        }
        clearDragSelection();
        setLocalSelection(e.node);
        selectRef.current(e.node);
      });
      sigma.on("clickEdge", (e) =>
        edgeRef.current?.(
          g.getEdgeAttribute(e.edge, "originalId"),
          g.getEdgeAttribute(e.edge, "relationIds"),
          g.source(e.edge),
        ),
      );
      const finish = (
        positions: { id: string; x: number; y: number }[],
        restored = false,
      ) => {
        if (disposed) return;
        if (watchdog) clearTimeout(watchdog);
        sigma.setCustomBBox(null);
        for (const p of positions)
          g.mergeNodeAttributes(p.id, { x: p.x, y: p.y });
        sigma.refresh();
        if (restored && saved) {
          sigma.setCustomBBox(saved.bbox);
          sigma.getCamera().setState(saved.camera);
        }
        requestAnimationFrame(() => {
          if (disposed) return;
          measureClearance();
          selectionStyle(sigma);
          sigma.setSetting("enableNodeDrag", true);
          ready = true;
          setBusy(false);
          container.current?.setAttribute("data-layout-ready", "true");
        });
      };
      const fail = () => {
        if (disposed || completed) return;
        completed = true;
        worker?.terminate();
        setError(
          "Layout optimization unavailable. Showing basic layout; you can browse the same nodes below.",
        );
        // Recovery stays O(nodes); never rerun the timed-out optimizer on the UI thread.
        finish(
          g.nodes().map((id) => ({
            id,
            ...(previous?.positions.get(id) ?? {
              x: g.getNodeAttribute(id, "x"),
              y: g.getNodeAttribute(id, "y"),
            }),
          })),
        );
      };
      if (saved) {
        completed = true;
        optimized = true;
        finish(
          [...saved.positions].map(([id, p]) => ({ id, ...p })),
          true,
        );
      } else {
        try {
          worker = new Worker(new URL("./layout.worker.ts", import.meta.url), {
            type: "module",
          });
          const requestId = String(++layoutRequestSequence);
          worker.onmessage = (e) => {
            if (disposed || completed) return;
            const response = e.data as LayoutResponse;
            if (
              !response ||
              typeof response !== "object" ||
              typeof response.requestId !== "string"
            ) {
              fail();
              return;
            }
            if (response.requestId !== requestId) return;
            if (
              "error" in response ||
              !Array.isArray(response.warnings) ||
              !validPositions(
                response.positions,
                view.nodes.map((n) => n.id),
              )
            ) {
              fail();
              return;
            }
            worker?.terminate();
            completed = true;
            optimized = true;
            if (response.warnings.length) setError(response.warnings.join(" "));
            finish(response.positions);
          };
          worker.onerror = fail;
          worker.onmessageerror = fail;
          watchdog = setTimeout(fail, 45000);
          worker.postMessage({
            requestId,
            nodes: view.nodes.map((n) => n.id),
            edges: view.edges.map((e) => ({
              source: e.source,
              target: e.target,
              order: [...e.relationIds].sort()[0],
            })),
            groups,
            aspectRatio:
              container.current.clientWidth /
              Math.max(1, container.current.clientHeight),
            previous: [...(previous?.positions ?? [])].map(([id, p]) => ({
              id,
              ...p,
            })),
            pins: [...(previous?.positions ?? [])]
              .filter(([id]) => manualPins.has(id))
              .map(([id, p]) => ({ id, ...p })),
          } satisfies LayoutRequest);
        } catch {
          fail();
        }
      }
    } catch (e) {
      console.error(
        "Graph rendering failed: " +
          (e instanceof Error ? e.message : String(e)),
      );
      setError(
        "The graph renderer is unavailable. Browse the same nodes below.",
      );
      setBusy(false);
    }
    return () => {
      disposed = true;
      dragSelection.current.clear();
      if (ready && renderer.current) {
        const sigma = renderer.current;
        arrangements.delete(key);
        const arrangement: Arrangement = {
          pins: manualPins,
          positions: new Map(
            g.nodes().map((id) => [
              id,
              {
                x: g.getNodeAttribute(id, "x"),
                y: g.getNodeAttribute(id, "y"),
              },
            ]),
          ),
          camera: { ...sigma.getCamera().getState() },
          bbox: sigma.getCustomBBox(),
        };
        if (optimized) arrangements.set(key, arrangement);
        latestArrangements.delete(scope);
        latestArrangements.set(scope, arrangement);
        if (latestArrangements.size > 32)
          latestArrangements.delete(latestArrangements.keys().next().value!);
        if (arrangements.size > 32)
          arrangements.delete(arrangements.keys().next().value!);
      }
      worker?.terminate();
      if (watchdog) clearTimeout(watchdog);
      renderer.current?.kill();
      renderer.current = null;
    };
  }, [view, labels, arrangementScope]);
  return (
    <div className="graph-area">
      <div className="graph-toolbar">
        {view.groups.length > 0 && (
          <div className="group-navigator">
            <label>
              Visible group{" "}
              <select
                aria-label="Visible group"
                value={activeGroup}
                onChange={(e) => updateControls({ group: e.target.value })}
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
        <div className="graph-exploration">
          {activeFocus ? (
            <button onClick={() => updateControls({ focusId: "" })}>
              Show whole graph
            </button>
          ) : (
            <button
              disabled={!view.nodes.some((n) => n.id === selection)}
              onClick={() => updateControls({ focusId: selection })}
            >
              Focus selected neighborhood
            </button>
          )}
        </div>
      </div>
      <div
        ref={container}
        className="sigma-container"
        data-analysis-id={result.analysisId}
        aria-label="Project relationship graph"
      />
      {showClassMatches && !view.nodes.length && (
        <div className="graph-empty" role="status">
          No saved objects match these classes.
        </div>
      )}
      {activeFocus && (
        <div className="graph-guide">
          {view.hiddenNodes} nodes hidden · {view.hiddenConnections} connections
          hidden
        </div>
      )}
      {busy && (
        <div className="graph-layout-status" role="status">
          Optimizing graph layout…
        </div>
      )}
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
          onClick={() => {
            renderer.current?.setCustomBBox(null);
            renderer.current?.refresh();
            void renderer.current?.getCamera().reset({ duration: 180 });
          }}
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
          ["#a2adbb", "Saved object"],
          ["#8e79ca", "Function"],
        ].map(([c, label]) => (
          <span key={label}>
            <i style={{ background: c }} />
            {label}
          </span>
        ))}
      </div>
      {error && (
        <details className="graph-node-list" open>
          <summary>{error}</summary>
          <div>
            {view.nodes.map((n) => (
              <button
                key={n.id}
                onClick={() => {
                  setLocalSelection(n.id);
                  onSelect(n.id);
                }}
              >
                {labels.get(n.id) ?? n.label}
              </button>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
