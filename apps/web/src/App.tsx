import { DiffView } from "./DiffView.js";
import { useEffect, useRef, useState, useMemo } from "react";
import { DiagnosticView } from "./DiagnosticView.js";
import type {
  AnalysisSummary,
  QueryResult,
  Query,
} from "../../../packages/contracts/src/query.js";
import type { Node, Evidence } from "../../../packages/contracts/src/model.js";
import type { Job } from "../../local/src/jobs.js";
import { api } from "./api.js";
import { ImportView } from "./ImportView.js";
import { CoverageView } from "./CoverageView.js";
import { Hierarchy, NodeMark } from "./Hierarchy.js";
import { GraphView } from "./GraphView.js";
import { Inspector } from "./Inspector.js";
import { TraceControls, TraceView } from "./TraceView.js";
import { SourceView } from "./SourceView.js";
import { ContextExport } from "./ContextExport.js";
import { gameplayTypes } from "../../../packages/contracts/src/relation-names.js";
function Brand() {
  return (
    <div className="brand">
      <svg viewBox="0 0 32 32" aria-hidden="true">
        <path
          d="M8 23L12 8l14 10L8 23"
          fill="none"
          stroke="#6dc9ad"
          strokeWidth="2"
        />
        <circle cx="12" cy="8" r="4" fill="#81dfbc" />
        <circle cx="26" cy="18" r="4" fill="#719eea" />
        <circle cx="8" cy="23" r="4" fill="#cfbaf3" />
      </svg>
      <strong>RoGraph</strong>
      <span>LOCAL</span>
    </div>
  );
}
export default function App() {
  const [analyses, setAnalyses] = useState<AnalysisSummary[]>([]),
    [analysisId, setAnalysis] = useState(""),
    [result, setResult] = useState<QueryResult>(),
    [selection, setSelection] = useState<QueryResult>(),
    [selectedId, setSelected] = useState(""),
    [search, setSearch] = useState(""),
    [matches, setMatches] = useState<Node[]>([]),
    [importing, setImporting] = useState(false),
    [initialized, setInitialized] = useState(false),
    [job, setJob] = useState<Job>(),
    [error, setError] = useState(""),
    [details, setDetails] = useState(false),
    [view, setView] = useState<"gameplay" | "code">("gameplay"),
    [context, setContext] = useState("all"),
    [status, setStatus] = useState("all"),
    [relationshipTypes, setRelationshipTypes] = useState({
      gameplay: "all",
      code: "all",
    }),
    [classFilter, setClasses] = useState(""),
    [depth, setDepth] = useState(6),
    [groupBy, setGroupBy] = useState<"service" | "folder">("service"),
    [includeInstances, setIncludeInstances] = useState(false),
    [stopped, setStopped] = useState(false),
    [navigatorCollapsed, setNavigatorCollapsed] = useState(false),
    [overviewRevision, setOverviewRevision] = useState(0);
  const [traceOpen, setTraceOpen] = useState(false),
    [exportOpen, setExportOpen] = useState(false),
    [traceResult, setTraceResult] = useState<QueryResult>(),
    [sourceEvidence, setSourceEvidence] = useState<Evidence>(),
    [edgeId, setEdgeId] = useState<string>(),
    [connectionRelationIds, setConnectionRelationIds] = useState<string[]>(),
    [activeQuery, setActiveQuery] = useState<Query>();
  const [newSnapshot, setNewSnapshot] = useState<string>(),
    [watching, setWatching] = useState(false);
  const requestRef = useRef(0);
  const graphRequest = useRef(0);
  const previousAnalysis = useRef("");
  const previousView = useRef(view);
  const type = relationshipTypes[view];
  const graphFilters = useMemo(
    () => ({
      view,
      contexts: context === "all" ? undefined : [context as any],
      statuses: status === "all" ? undefined : [status as any],
      relationTypes: type === "all" ? undefined : [type as any],
      classes: classFilter.trim()
        ? classFilter
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : undefined,
      depth,
      groupBy,
      includeInstances,
    }),
    [
      view,
      context,
      status,
      type,
      classFilter,
      depth,
      groupBy,
      includeInstances,
    ],
  );
  const refresh = async (id?: string) => {
    const w = await api.workspace();
    setAnalyses(w.analyses);
    setAnalysis(id ?? w.current ?? w.analyses[0]?.analysisId ?? "");
  };
  useEffect(() => {
    void refresh()
      .catch((e) => setError(e.message))
      .finally(() => setInitialized(true));
  }, []);
  useEffect(() => {
    if (!analysisId) return;
    let alive = true;
    const changed = previousAnalysis.current !== analysisId;
    const changedView = previousView.current !== view;
    if (changedView) {
      setEdgeId(undefined);
      if (!changed && selectedId) void select(selectedId);
    }
    previousView.current = view;
    previousAnalysis.current = analysisId;
    if (changed) {
      setSelection(undefined);
      setSelected("");
      setEdgeId(undefined);
    }
    setExportOpen(false);
    setTraceOpen(false);
    const request = ++graphRequest.current;
    if (changed) requestRef.current++;
    void api
      .run({
        op: "overview",
        analysisId,
        limit: 300,
        ...graphFilters,
      })
      .then((r) => {
        if (alive && request === graphRequest.current) {
          setResult(r);
          setTraceResult(undefined);
          setActiveQuery({
            op: "overview",
            analysisId,
            limit: 300,
            ...graphFilters,
          });
        }
      })
      .catch((e) => {
        if (alive && request === graphRequest.current) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [analysisId, graphFilters, overviewRevision]);
  useEffect(() => {
    if (!analysisId || !search.trim()) {
      setMatches([]);
      return;
    }
    let alive = true;
    const timer = setTimeout(() => {
      void api
        .run({ op: "search", analysisId, text: search, limit: 100 })
        .then((r) => {
          if (alive) setMatches(r.nodes);
        })
        .catch((e) => setError(e.message));
    }, 180);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [analysisId, search]);
  useEffect(() => {
    if (!job || !["running", "canceling"].includes(job.status)) return;
    const timer = setTimeout(() => {
      void api
        .job(job.id)
        .then((next) => {
          setJob(next);
          if (next.analysisId) {
            void refresh(next.analysisId);
            setImporting(false);
          }
          if (next.error) setError(next.error.message);
        })
        .catch((e) => setError(e.message));
    }, 300);
    return () => clearTimeout(timer);
  }, [job]);
  async function select(id: string) {
    const request = ++requestRef.current;
    setSelected(id);
    try {
      const r = await api.run({
        op: "inspect",
        analysisId,
        nodeId: id,
        limit: 300,
        view,
      });
      if (request === requestRef.current) setSelection(r);
    } catch (e) {
      if (request === requestRef.current) setError((e as Error).message);
    }
  }
  useEffect(() => {
    if (!analysisId) return;
    let alive = true;
    const timer = setInterval(() => {
      void api
        .workspace()
        .then((w) => {
          if (!alive) return;
          setWatching(Boolean(w.watch?.enabled));
          if (w.watch?.error) setError(w.watch.error);
          if (w.current && w.current !== analysisId) {
            const current = w.analyses.find((a) => a.analysisId === w.current),
              selected = w.analyses.find((a) => a.analysisId === analysisId);
            if (current && selected && current.createdAt > selected.createdAt)
              setNewSnapshot(w.current);
          }
        })
        .catch(() => {});
    }, 3000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [analysisId]);
  function openOverview(mode: typeof view) {
    graphRequest.current++;
    setView(mode);
    setOverviewRevision((revision) => revision + 1);
  }
  function closeInspector() {
    requestRef.current++;
    setSelected("");
    setSelection(undefined);
    setEdgeId(undefined);
    setConnectionRelationIds(undefined);
  }
  async function explore(op: "dependencies" | "impact", id: string) {
    const request = ++graphRequest.current;
    try {
      const q: Query = {
          op,
          analysisId,
          nodeId: id,
          limit: 300,
          ...graphFilters,
        },
        r = await api.run(q);
      if (request !== graphRequest.current) return;
      setResult(r);
      setTraceResult(r);
      setActiveQuery(q);
    } catch (e) {
      if (request === graphRequest.current) setError((e as Error).message);
    }
  }
  const traceRequest = graphRequest.current;
  const node = selection?.nodes.find((n) => n.id === selectedId);
  const graphScope =
    activeQuery && activeQuery.analysisId === result?.analysisId
      ? JSON.stringify([
          activeQuery.op,
          "nodeId" in activeQuery && activeQuery.nodeId,
          "fromId" in activeQuery && activeQuery.fromId,
          "toId" in activeQuery && activeQuery.toId,
        ])
      : "";
  if (stopped)
    return (
      <main className="stopped">
        <Brand />
        <h1>RoGraph stopped.</h1>
        <p>
          You can close this tab. Your saved snapshots are ready for next time.
        </p>
      </main>
    );
  return (
    <div className="app">
      <header className="topbar">
        <Brand />
        <div className="breadcrumb">
          Workspace <span>/</span>{" "}
          <strong>{analysisId ? "Game explorer" : "New project"}</strong>
        </div>
        <span className="offline">
          <i /> On your computer
        </span>
        <button className="secondary" onClick={() => setImporting(true)}>
          ＋ Import project
        </button>
        <button
          className="text-button"
          onClick={() =>
            void api
              .stop()
              .then(() => setStopped(true))
              .catch((e) => setError(e.message))
          }
        >
          Stop app
        </button>
      </header>
      <div className="workspace">
        <aside
          className={
            navigatorCollapsed ? "sidebar sidebar-collapsed" : "sidebar"
          }
          aria-label="Project navigator"
        >
          <div className="sidebar-title">
            {!navigatorCollapsed && (
              <span className="eyebrow">PROJECT NAVIGATOR</span>
            )}
            <button
              type="button"
              className="icon-button"
              aria-label={
                navigatorCollapsed
                  ? "Expand project navigator"
                  : "Collapse project navigator"
              }
              aria-expanded={!navigatorCollapsed}
              aria-controls="project-navigator-content"
              onClick={() => setNavigatorCollapsed(!navigatorCollapsed)}
            >
              {navigatorCollapsed ? "›" : "‹"}
            </button>
          </div>
          <div
            id="project-navigator-content"
            className="navigator-content"
            hidden={navigatorCollapsed}
          >
            <label className="search-box">
              <span>⌕</span>
              <input
                aria-label="Search project"
                placeholder="Search anything…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <kbd>⌕</kbd>
            </label>
            {analysisId ? (
              <>
                <label className="snapshot-label">
                  Snapshot
                  <select
                    aria-label="Snapshot"
                    value={analysisId}
                    onChange={(e) => setAnalysis(e.target.value)}
                  >
                    {analyses.map((a) => (
                      <option key={a.analysisId} value={a.analysisId}>
                        {a.analysisId.slice(0, 8)} ·{" "}
                        {a.complete ? "Complete" : "Partial import"}
                      </option>
                    ))}
                  </select>
                </label>
                <details className="navigator-tools-menu">
                  <summary>Graph tools</summary>
                  <div className="navigator-tools">
                    <select
                      aria-label="Execution context"
                      value={context}
                      onChange={(e) => setContext(e.target.value)}
                    >
                      <option value="all">All contexts</option>
                      <option value="client">Client</option>
                      <option value="server">Server</option>
                      <option value="unknown">Unknown context</option>
                    </select>
                    <select
                      aria-label="Evidence status"
                      value={status}
                      onChange={(e) => setStatus(e.target.value)}
                    >
                      {[
                        "all",
                        "saved",
                        "resolved",
                        "candidate",
                        "unresolved",
                      ].map((s) => (
                        <option key={s} value={s}>
                          {s === "all" ? "All evidence" : s}
                        </option>
                      ))}
                    </select>
                    <select
                      aria-label="Relationship type"
                      value={type}
                      onChange={(e) =>
                        setRelationshipTypes({
                          ...relationshipTypes,
                          [view]: e.target.value,
                        })
                      }
                    >
                      {[
                        "all",
                        ...(view === "gameplay"
                          ? gameplayTypes
                          : [
                              "REQUIRES",
                              "CALLS",
                              "READS",
                              "WRITES",
                              "REFERENCES",
                              "SENDS_VIA",
                              "HANDLES",
                            ]),
                      ].map((s) => (
                        <option key={s} value={s}>
                          {s === "all" ? "All relationships" : s}
                        </option>
                      ))}
                    </select>
                    <button
                      className="text-button"
                      onClick={() => setTraceOpen(!traceOpen)}
                    >
                      Trace a path
                    </button>
                    <button
                      className="text-button"
                      onClick={() => setExportOpen(true)}
                    >
                      Export context
                    </button>
                  </div>
                </details>
                {search ? (
                  <div className="search-results">
                    <span className="eyebrow">{matches.length} RESULTS</span>
                    {matches.map((n) => (
                      <button
                        key={n.id}
                        className="result-row"
                        aria-label={n.label}
                        onClick={() => void select(n.id)}
                      >
                        <NodeMark node={n} />
                        <span>
                          {n.label}
                          <small>
                            {n.kind === "instance"
                              ? String(n.attributes.className)
                              : n.kind}
                          </small>
                        </span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <>
                    <div className="tree-heading">ALL SAVED OBJECTS</div>
                    <Hierarchy
                      key={analysisId}
                      analysisId={analysisId}
                      onSelect={(id) => void select(id)}
                    />
                  </>
                )}
                {result?.analysisId === analysisId && (
                  <>
                    <CoverageView coverage={result.coverage} />
                    <DiagnosticView
                      key={analysisId}
                      analysisId={analysisId}
                      onSelect={(id) => void select(id)}
                    />
                    {analyses.length > 1 && (
                      <DiffView
                        key={analysisId}
                        analysisId={analysisId}
                        analyses={analyses}
                      />
                    )}
                  </>
                )}
              </>
            ) : (
              <div className="sidebar-empty">
                <span>◇</span>
                <p>
                  Your project structure
                  <br />
                  will appear here.
                </p>
              </div>
            )}
            <div className="sidebar-footer">
              <span>
                RoGraph <b>0.2</b>
              </span>
              <a
                href="https://github.com/AngAndrei/RoGraph"
                target="_blank"
                rel="noreferrer"
              >
                Project ↗
              </a>
            </div>
          </div>
        </aside>
        <main className="main-area">
          {newSnapshot && (
            <div className="job-banner">
              <strong>A new complete snapshot is ready.</strong>
              <button
                onClick={() => {
                  void refresh(newSnapshot);
                  setNewSnapshot(undefined);
                }}
              >
                Open new snapshot
              </button>
            </div>
          )}
          {watching && (
            <div className="watch-banner">
              Watching Rojo project for saved changes{" "}
              <button
                onClick={() =>
                  void api.watch(false).then(() => setWatching(false))
                }
              >
                Stop watching
              </button>
            </div>
          )}
          {error && (
            <div className="error-banner" role="alert">
              <span>{error}</span>
              <button onClick={() => setError("")} aria-label="Dismiss error">
                ×
              </button>
            </div>
          )}
          {job && ["running", "canceling"].includes(job.status) && (
            <div className="job-banner">
              <span className="spinner" />
              <div>
                <strong>Analyzing {job.name}</strong>
                <small>
                  {{
                    import: "Reading saved objects",
                    parse: "Reading scripts",
                    resolve: "Connecting functions and fields",
                    persist: "Saving snapshot",
                    complete: "Ready",
                  }[job.progress.stage] ?? "Analyzing"}{" "}
                  · {job.progress.completed} / {job.progress.total}
                </small>
              </div>
              <button onClick={() => void api.cancel(job.id).then(setJob)}>
                Cancel analysis
              </button>
            </div>
          )}
          {analysisId && result?.analysisId === analysisId ? (
            <>
              <div className="view-header">
                <div>
                  <span className="eyebrow">GAME KNOWLEDGE GRAPH</span>
                  <h1>
                    Explore your connections<span className="dot">.</span>
                  </h1>
                </div>
                <div className="segmented">
                  <button
                    className={view === "gameplay" ? "active" : ""}
                    onClick={() => openOverview("gameplay")}
                  >
                    Gameplay
                  </button>
                  <button
                    className={view === "code" ? "active" : ""}
                    onClick={() => openOverview("code")}
                  >
                    Code
                  </button>
                  {view === "code" && (
                    <button
                      className={details ? "active" : ""}
                      onClick={() => setDetails(!details)}
                    >
                      Methods &amp; config
                    </button>
                  )}
                </div>
              </div>
              <div className="filterbar secondary-filters">
                <label>
                  Group by{" "}
                  <select
                    aria-label="Group by"
                    value={groupBy}
                    onChange={(e) =>
                      setGroupBy(e.target.value as "service" | "folder")
                    }
                  >
                    <option value="service">Service</option>
                    <option value="folder">Folder</option>
                  </select>
                </label>
                <label>
                  Classes{" "}
                  <input
                    aria-label="Object classes"
                    placeholder="Any class · comma separated"
                    value={classFilter}
                    onChange={(e) => setClasses(e.target.value)}
                  />
                </label>
                <label>
                  Depth{" "}
                  <select
                    aria-label="Traversal depth"
                    value={depth}
                    onChange={(e) => setDepth(Number(e.target.value))}
                  >
                    {[1, 2, 3, 4, 5, 6].map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <input
                    type="checkbox"
                    aria-label="Include saved objects"
                    checked={includeInstances}
                    onChange={(e) => setIncludeInstances(e.target.checked)}
                  />{" "}
                  Show saved objects
                </label>
              </div>
              {view === "gameplay" &&
                result.capabilities?.gameplay === false && (
                  <div className="bounds-banner">
                    This snapshot was indexed before gameplay support. Reimport
                    the saved project to build gameplay connections, or open
                    Code.
                  </div>
                )}
              <GraphView
                result={result}
                selectedId={selectedId}
                details={
                  ((activeQuery?.view ?? view) === "code" && details) ||
                  includeInstances ||
                  Boolean(traceResult)
                }
                arrangementScope={graphScope}
                onSelect={(id) => {
                  setEdgeId(undefined);
                  void select(id);
                }}
                onEdge={(id, relationIds, sourceId) => {
                  const projected = result.projection?.edges.find(
                    (e) => e.id === id,
                  );
                  const relation = result.relations.find(
                    (r) => r.id === (projected?.relationIds[0] ?? id),
                  );
                  if (relation) {
                    setEdgeId(id);
                    setConnectionRelationIds(
                      relationIds ?? projected?.relationIds ?? [relation.id],
                    );
                    void select(sourceId ?? relation.source);
                  }
                }}
              />
              {traceOpen && (
                <TraceControls
                  analysisId={analysisId}
                  nodes={result.nodes}
                  filters={graphFilters}
                  onClose={() => setTraceOpen(false)}
                  onResult={(r, q) => {
                    if (traceRequest !== graphRequest.current) return;
                    graphRequest.current++;
                    setResult(r);
                    setTraceResult(r);
                    setActiveQuery(q);
                    setTraceOpen(false);
                  }}
                />
              )}
              {traceResult && (
                <TraceView
                  key={traceResult.analysisId + activeQuery?.op}
                  result={traceResult}
                  onSelect={(id) => void select(id)}
                />
              )}
            </>
          ) : (
            <div className="welcome">
              <div className="welcome-pattern" />
              <span className="eyebrow">YOUR GAME, CONNECTED</span>
              <h1>
                Clarity for humans.
                <br />
                Context for agents.
              </h1>
              <p>
                Understand the relationships hiding inside your Roblox project.
              </p>
              {initialized && <ImportView onJob={setJob} onClose={() => {}} />}
            </div>
          )}
        </main>
        {node && selection?.analysisId === analysisId && (
          <aside className="inspector" aria-label="Selected instance">
            <button
              type="button"
              className="icon-button inspector-close"
              aria-label="Close inspector"
              onClick={closeInspector}
            >
              ×
            </button>
            <Inspector
              key={selectedId}
              result={selection}
              selectedId={selectedId}
              onSelect={(id) => {
                setEdgeId(undefined);
                void select(id);
              }}
              onExplore={(op, id) => void explore(op, id)}
              edgeId={edgeId}
              connectionRelationIds={edgeId ? connectionRelationIds : undefined}
              onShowImplementation={() => {
                setEdgeId(undefined);
                openOverview("code");
                setDetails(true);
              }}
            />
          </aside>
        )}
      </div>
      {exportOpen && activeQuery && (
        <ContextExport
          query={activeQuery}
          onClose={() => setExportOpen(false)}
        />
      )}
      {sourceEvidence && (
        <SourceView
          analysisId={analysisId}
          evidence={sourceEvidence}
          onClose={() => setSourceEvidence(undefined)}
        />
      )}
      {importing && (
        <div className="modal-backdrop">
          <ImportView
            onJob={(j) => {
              setJob(j);
              setImporting(false);
            }}
            onClose={() => setImporting(false)}
          />
        </div>
      )}
    </div>
  );
}
