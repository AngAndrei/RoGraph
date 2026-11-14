import { useEffect, useRef, useState } from "react";
import type {
  Query,
  ContextPack,
} from "../../../packages/contracts/src/query.js";
import { api } from "./api.js";
import { compactContext, contextMarkdown } from "./context-export.js";

export interface ExportScope {
  id: string;
  label: string;
  description: string;
  query: Query;
}
function downloadText(text: string, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type })),
    link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function ContextExport({
  query,
  scopes,
  snapshotLabel,
  onClose,
}: {
  query: Query;
  scopes?: ExportScope[];
  snapshotLabel?: string;
  onClose: () => void;
}) {
  const [scopeId, setScopeId] = useState(scopes?.[0]?.id ?? "current");
  const scope = scopes?.find((item) => item.id === scopeId);
  const exportQuery = scope?.query ?? query;
  const [pack, setPack] = useState<ContextPack>(),
    [budget, setBudget] = useState(2000),
    [error, setError] = useState(""),
    [fullGraphError, setFullGraphError] = useState(""),
    [exportingGraph, setExportingGraph] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      mounted.current = false;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [onClose]);
  useEffect(() => {
    let alive = true;
    setPack(undefined);
    setError("");
    void api
      .context(exportQuery, budget)
      .then((next) => {
        if (alive) setPack(next);
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [exportQuery, budget]);
  function download(format: "json" | "markdown") {
    if (!pack) return;
    try {
      const text =
        format === "json"
          ? JSON.stringify(compactContext(pack, exportQuery))
          : contextMarkdown(pack, exportQuery);
      downloadText(
        text,
        "rograph-" +
          exportQuery.analysisId.slice(0, 8) +
          (format === "json" ? ".json" : ".md"),
        format === "json" ? "application/json" : "text/markdown;charset=utf-8",
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function downloadGraph() {
    setExportingGraph(true);
    setFullGraphError("");
    try {
      const graph = await api.exportGraph(exportQuery.analysisId);
      if (mounted.current)
        downloadText(
          JSON.stringify(graph),
          "rograph-" + exportQuery.analysisId.slice(0, 8) + "-full-graph.json",
          "application/json",
        );
    } catch (e) {
      if (mounted.current) setFullGraphError((e as Error).message);
    } finally {
      if (mounted.current) setExportingGraph(false);
    }
  }
  return (
    <div className="modal-backdrop context-export-backdrop">
      <section
        className="context-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Export agent context"
      >
        <header>
          <div>
            <span className="eyebrow">CONTEXT FOR AN EXTERNAL AI</span>
            <h2>Export for AI</h2>
          </div>
          <button
            className="icon-button"
            aria-label="Close context export"
            onClick={onClose}
            autoFocus
          >
            ×
          </button>
        </header>
        <p>Pinned snapshot: {snapshotLabel ?? exportQuery.analysisId}</p>
        <p>
          Recommended: compact JSON or Markdown with source evidence, unknowns,
          coverage, and omissions. This is bounded context, not the complete
          game graph.
        </p>
        {scopes && (
          <label>
            Export scope
            <select
              aria-label="Export scope"
              value={scopeId}
              onChange={(e) => setScopeId(e.target.value)}
            >
              {scopes.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
        )}
        {scope && <p>{scope.description}</p>}
        <details className="export-query">
          <summary>Scope and query bounds</summary>
          <pre>{JSON.stringify(exportQuery, null, 2)}</pre>
        </details>
        <label>
          Estimated token budget
          <select
            aria-label="Context token budget"
            value={budget}
            onChange={(e) => setBudget(Number(e.target.value))}
          >
            {[2000, 4000, 8000].map((n) => (
              <option key={n} value={n}>
                {n.toLocaleString()} estimated tokens
              </option>
            ))}
          </select>
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {pack ? (
          <>
            <div className="pack-stats">
              <span>
                Context preparation: {pack.estimatedTokens.toLocaleString()}{" "}
                estimated tokens · characters/4
              </span>
              <span>{pack.utf8Bytes.toLocaleString()} / 32,000 bytes</span>
            </div>
            {pack.truncated && (
              <p className="source-notice">
                This is a bounded context pack. Omissions and coverage are
                included in both formats.
              </p>
            )}
            <pre className="context-preview">
              {contextMarkdown(pack, exportQuery)}
            </pre>
            <div className="context-actions">
              <button className="primary" onClick={() => download("json")}>
                Download JSON
              </button>
              <button
                className="secondary"
                onClick={() => download("markdown")}
              >
                Download Markdown
              </button>
            </div>
          </>
        ) : (
          !error && (
            <p className="muted" role="status">
              Preparing context…
            </p>
          )
        )}
        <details className="full-graph-export">
          <summary>Full snapshot graph (larger file)</summary>
          <p>
            All retained nodes, relations, evidence, sites, diagnostics, and
            source records for this saved snapshot, in both graph modes. This
            JSON has no context token budget and can be much larger. Graph
            filters and the scope above do not limit it.
          </p>
          {fullGraphError && (
            <p className="error" role="alert">
              {fullGraphError}
            </p>
          )}
          <button
            className="secondary"
            disabled={exportingGraph}
            onClick={() => void downloadGraph()}
          >
            {exportingGraph
              ? "Preparing full graph…"
              : "Download full graph JSON"}
          </button>
        </details>
      </section>
    </div>
  );
}
