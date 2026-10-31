import { useState } from "react";
import type { Node, Evidence } from "../../../packages/contracts/src/model.js";
import type {
  Query,
  QueryResult,
} from "../../../packages/contracts/src/query.js";
import { api } from "./api.js";
import { SourceView } from "./SourceView.js";
export function TraceControls({
  analysisId,
  nodes,
  onResult,
  onClose,
}: {
  analysisId: string;
  nodes: Node[];
  onResult: (r: QueryResult, q: Query) => void;
  onClose: () => void;
}) {
  const [from, setFrom] = useState(
      nodes.find((n) => n.kind === "function")?.id ?? nodes[0]?.id ?? "",
    ),
    [to, setTo] = useState(
      nodes.find((n) => n.kind === "field")?.id ?? nodes[0]?.id ?? "",
    ),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <div className="trace-controls">
      <header>
        <strong>Trace a potential path</strong>
        <button aria-label="Close trace controls" onClick={onClose}>
          ×
        </button>
      </header>
      <label>
        From
        <select
          aria-label="Trace start"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
        >
          {nodes.map((n) => (
            <option key={n.id} value={n.id}>
              {n.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        To
        <select
          aria-label="Trace destination"
          value={to}
          onChange={(e) => setTo(e.target.value)}
        >
          {nodes.map((n) => (
            <option key={n.id} value={n.id}>
              {n.label}
            </option>
          ))}
        </select>
      </label>
      <button
        className="primary"
        disabled={busy || !from || !to}
        onClick={() => {
          setBusy(true);
          const q: Query = {
            op: "trace",
            analysisId,
            fromId: from,
            toId: to,
            depth: 6,
            limit: 300,
          };
          void api
            .run(q)
            .then((r) => onResult(r, q))
            .catch((e) => setError(e.message))
            .finally(() => setBusy(false));
        }}
      >
        {busy ? "Finding…" : "Find path"}
      </button>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
export function TraceView({
  result: r,
  onSelect,
}: {
  result: QueryResult;
  onSelect: (id: string) => void;
}) {
  const [source, setSource] = useState<Evidence>(),
    [pathIndex, setPathIndex] = useState(0),
    path = r.paths[pathIndex] ?? [],
    labels = new Map(r.nodes.map((n) => [n.id, n.label]));
  return (
    <div className="trace-result">
      <div className="section-heading">
        <strong>
          {path.some((h) => h.transition === "potential-communication")
            ? "Potential communication"
            : path.some((h) => h.transition === "potential-impact")
              ? "Potential impact"
              : "Dependency path"}
        </strong>
        <span className="badge">{path.length} hops</span>
      </div>
      {!path.length && (
        <p>
          No modeled path within these bounds. Check unresolved references and
          coverage.
        </p>
      )}
      {r.paths.length > 1 && (
        <select
          aria-label="Path"
          value={pathIndex}
          onChange={(e) => setPathIndex(Number(e.target.value))}
        >
          {r.paths.map((_, i) => (
            <option key={i} value={i}>
              Path {i + 1}
            </option>
          ))}
        </select>
      )}
      {path.map((hop, i) => {
        const rel = r.relations.find((e) => e.id === hop.relationId),
          ev = r.evidence.filter((e) => e.relationId === hop.relationId),
          first = ev.find((e) => e.sourceId);
        return (
          <div className="trace-hop" key={i}>
            <span>{i + 1}</span>
            <div>
              <button onClick={() => onSelect(hop.fromId)}>
                {labels.get(hop.fromId)}
              </button>
              <small>
                {rel?.type}{" "}
                {hop.transition !== "dependency"
                  ? "· " + hop.transition.replaceAll("-", " ")
                  : ""}
              </small>
              <button onClick={() => onSelect(hop.toId)}>
                {labels.get(hop.toId)}
              </button>
            </div>
            <button
              className="text-button"
              aria-label={"Inspect hop " + (i + 1)}
              disabled={!first}
              onClick={() => setSource(first)}
            >
              Source ↗
            </button>
          </div>
        );
      })}
      <p className="trace-note">
        A static potential path. Runtime execution, event ordering, and data
        flow are not established.
      </p>
      {source && (
        <SourceView
          analysisId={r.analysisId}
          evidence={source}
          onClose={() => setSource(undefined)}
        />
      )}
    </div>
  );
}
