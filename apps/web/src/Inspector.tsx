import { api } from "./api.js";
import { useEffect, useState } from "react";
import type { QueryResult } from "../../../packages/contracts/src/query.js";
import type { Evidence } from "../../../packages/contracts/src/model.js";
import { NodeMark } from "./Hierarchy.js";
import { SourceView } from "./SourceView.js";
export function Inspector({
  result: initial,
  selectedId,
  onSelect,
  onExplore,
  edgeId,
}: {
  result: QueryResult;
  selectedId: string;
  onSelect: (id: string) => void;
  onExplore: (op: "dependencies" | "impact", id: string) => void;
  edgeId?: string;
}) {
  const [page, setPage] = useState<QueryResult>(),
    [pageBusy, setPageBusy] = useState(false),
    [pageError, setPageError] = useState("");
  const r = page ?? initial;
  useEffect(() => setPage(undefined), [initial]);
  const [source, setSource] = useState<Evidence>(),
    [expanded, setExpanded] = useState<string>();
  const node = r.nodes.find((n) => n.id === selectedId);
  if (!node) return null;
  const members = r.nodes.filter((n) => n.ownerId === selectedId),
    rels = r.relations.filter((e) =>
      edgeId
        ? e.id === edgeId
        : e.source === selectedId || e.target === selectedId,
    ),
    names = new Map(r.nodes.map((n) => [n.id, n.label]));
  return (
    <>
      <span className="eyebrow">SELECTED {node.kind.toUpperCase()}</span>
      <h2>{node.label}</h2>
      <span className="badge">
        {String(node.attributes.className ?? node.kind)}
      </span>
      <p className="muted">{node.contexts.join(" + ")} context</p>
      <div className="inspect-actions">
        {Boolean(node.attributes.sourceId) && (
          <button
            onClick={() =>
              setSource({
                id: node.id + ":source",
                relationId: "",
                sourceId: String(node.attributes.sourceId),
                span: (node.attributes.span as any) ?? {
                  startByte: 0,
                  endByte: 0,
                  startLine: 1,
                  startColumn: 1,
                  endLine: 1,
                  endColumn: 1,
                },
                rule: "indexed-source",
                status: "saved",
                assumptions: [],
                contexts: node.contexts,
              })
            }
          >
            Source
          </button>
        )}
        <button onClick={() => onExplore("dependencies", selectedId)}>
          Dependencies
        </button>
        <button onClick={() => onExplore("impact", selectedId)}>Impact</button>
      </div>
      {node.kind === "field" && (
        <div className="initializer">
          <span>Saved value / literal initializer</span>
          <strong>
            {node.attributes.initializerAvailable
              ? JSON.stringify(node.attributes.initializer)
              : "Unavailable"}
          </strong>
          <small>
            {String(
              node.attributes.initializerMeaning ??
                "Saved initial value; runtime value may change.",
            )}
          </small>
        </div>
      )}
      {members.some((n) => n.kind === "function") && <h3>Functions</h3>}
      {members
        .filter((n) => n.kind === "function")
        .map((n) => (
          <button
            key={n.id}
            aria-label={n.label}
            className="member-button"
            onClick={() => onSelect(n.id)}
          >
            <NodeMark node={n} />
            {n.label}
            <span>↗</span>
          </button>
        ))}
      {members.some((n) => n.kind === "field") && <h3>Configuration</h3>}
      {members
        .filter((n) => n.kind === "field")
        .map((n) => (
          <button
            key={n.id}
            aria-label={n.label}
            className="member-button"
            onClick={() => onSelect(n.id)}
          >
            <NodeMark node={n} />
            {n.label}
          </button>
        ))}
      <h3>
        Relationships <small>{rels.length}</small>
      </h3>
      {rels.length === 0 && (
        <p className="muted">
          No modeled relationships in this view. Check coverage and unresolved
          sites.
        </p>
      )}
      {rels.map((rel) => {
        const ev = r.evidence.filter((e) => e.relationId === rel.id),
          other = rel.source === selectedId ? rel.target : rel.source;
        return (
          <div className="relation-card" key={rel.id}>
            <button
              className="relation-title"
              onClick={() =>
                setExpanded(expanded === rel.id ? undefined : rel.id)
              }
            >
              <span>
                {rel.type.replaceAll("_", " ")}
                <small>
                  {rel.source === selectedId ? "Outgoing" : "Incoming"} ·{" "}
                  {ev.length} retained occurrence{ev.length === 1 ? "" : "s"}
                </small>
              </span>
              <span>⌄</span>
            </button>
            <button className="relation-other" onClick={() => onSelect(other)}>
              {names.get(other) ?? other} ↗
            </button>
            {(expanded === rel.id || edgeId === rel.id) &&
              ev.map((e) => (
                <div className="occurrence" key={e.id}>
                  <strong>{e.mechanism ?? e.rule}</strong>
                  <span className="badge">{e.status}</span>
                  {e.sourceId ? (
                    <button onClick={() => setSource(e)}>
                      View source · L{e.span?.startLine}:{e.span?.startColumn}
                    </button>
                  ) : (
                    <p>
                      Saved property {e.propertyName}
                      <br />
                      {names.get(e.instanceId ?? "") ?? e.instanceId}
                    </p>
                  )}
                  {e.assumptions.map((s, i) => (
                    <p key={i}>{s}</p>
                  ))}
                </div>
              ))}
          </div>
        );
      })}
      {r.sites.some(
        (s) => s.status === "unresolved" || s.status === "candidate",
      ) && (
        <>
          <h3>Unresolved / candidate sites</h3>
          {r.sites
            .filter(
              (s) => s.status === "unresolved" || s.status === "candidate",
            )
            .map((s) => (
              <div className="unknown-card" key={s.id}>
                <strong>{s.reason ?? s.status}</strong>
                <small>
                  Line {s.span.startLine} · {s.status}
                </small>
                <button
                  onClick={() =>
                    setSource({
                      id: s.id,
                      relationId: "",
                      siteId: s.id,
                      sourceId: s.sourceId,
                      span: s.span,
                      rule: s.reason ?? "unresolved",
                      status: s.status,
                      assumptions: s.assumptions ?? [],
                      contexts: s.contexts ?? ["unknown"],
                    })
                  }
                >
                  Inspect source
                </button>
              </div>
            ))}
        </>
      )}
      {r.meta.truncated && (
        <p className="source-notice">
          Results are bounded. More occurrences or connections may exist; narrow
          the query.
        </p>
      )}
      {r.meta.nextCursor && (
        <button
          className="secondary"
          disabled={pageBusy}
          onClick={() => {
            setPageBusy(true);
            void api
              .run({
                op: "inspect",
                analysisId: r.analysisId,
                nodeId: selectedId,
                limit: r.meta.limits.nodes,
                cursor: r.meta.nextCursor,
              })
              .then(setPage)
              .catch((e) => setPageError(e.message))
              .finally(() => setPageBusy(false));
          }}
        >
          Next evidence page
        </button>
      )}
      {page && (
        <button className="text-button" onClick={() => setPage(undefined)}>
          First evidence page
        </button>
      )}
      {pageError && <p className="error">{pageError}</p>}
      {source && (
        <SourceView
          key={source.id}
          analysisId={r.analysisId}
          evidence={source}
          onClose={() => setSource(undefined)}
        />
      )}
    </>
  );
}
