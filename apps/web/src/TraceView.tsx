import { useState, useEffect } from "react";
import type { Node, Evidence } from "../../../packages/contracts/src/model.js";
import type {
  Query,
  QueryResult,
} from "../../../packages/contracts/src/query.js";
import { api } from "./api.js";
import { SourceView } from "./SourceView.js";
type GraphFilters = Pick<
  Query,
  | "contexts"
  | "statuses"
  | "relationTypes"
  | "classes"
  | "depth"
  | "groupBy"
  | "includeInstances"
>;
function Endpoint({
  analysisId,
  nodes,
  label,
  value,
  onChange,
}: {
  analysisId: string;
  nodes: Node[];
  label: string;
  value: string;
  onChange: (id: string) => void;
}) {
  const [text, setText] = useState(""),
    [matches, setMatches] = useState<Node[]>([]),
    [selected, setSelected] = useState<Node>(),
    [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    if (!text.trim()) {
      setMatches([]);
      return;
    }
    const timer = setTimeout(() => {
      void api
        .run({ op: "search", analysisId, text, limit: 100 })
        .then((r) => {
          if (alive) setMatches(r.nodes);
        })
        .catch((e) => {
          if (alive) setError(e.message);
        });
    }, 180);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [analysisId, text]);
  const options = [
    ...new Map(
      [...nodes, ...matches, ...(selected ? [selected] : [])].map((n) => [
        n.id,
        n,
      ]),
    ).values(),
  ];
  const searchLabel =
    label === "Trace start" ? "Find starting node" : "Find ending node";
  return (
    <div>
      <label>
        {searchLabel}
        <input
          aria-label={searchLabel}
          placeholder="Search the whole snapshot…"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </label>
      <label>
        {label}
        <select
          aria-label={label}
          value={value}
          onChange={(e) => {
            const node = options.find((n) => n.id === e.target.value);
            setSelected(node);
            onChange(e.target.value);
          }}
        >
          {options.map((n) => (
            <option key={n.id} value={n.id}>
              {n.label}
            </option>
          ))}
        </select>
      </label>
      {error && <span role="alert">{error}</span>}
    </div>
  );
}
export function TraceControls({
  analysisId,
  nodes,
  onResult,
  onClose,
  filters = {},
}: {
  analysisId: string;
  nodes: Node[];
  onResult: (r: QueryResult, q: Query) => void;
  onClose: () => void;
  filters?: GraphFilters;
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
      <Endpoint
        analysisId={analysisId}
        nodes={nodes}
        label="Trace start"
        value={from}
        onChange={setFrom}
      />
      <Endpoint
        analysisId={analysisId}
        nodes={nodes}
        label="Trace destination"
        value={to}
        onChange={setTo}
      />
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
            ...filters,
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
