import { useEffect, useState } from "react";
import type { QueryResult } from "../../../packages/contracts/src/query.js";
import { api } from "./api.js";
import { SourceView, type SourceLocation } from "./SourceView.js";

type Props = {
  analysisId: string;
  onSelect: (id: string) => void;
};
type PagePosition = { cursor?: string; offset: number };
const firstPage: PagePosition = { offset: 0 };
const severityLabel = { info: "Info", warning: "Warning", error: "Error" };

export function DiagnosticView(props: Props) {
  return <DiagnosticReport key={props.analysisId} {...props} />;
}

function DiagnosticReport({ analysisId, onSelect }: Props) {
  const [page, setPage] = useState<QueryResult>(),
    [position, setPosition] = useState<PagePosition>(firstPage),
    [total, setTotal] = useState<number>(),
    [error, setError] = useState(""),
    [source, setSource] = useState<SourceLocation>();
  const { cursor, offset } = position;
  const loading = !page && !error;
  const pageEnd = offset + (page?.diagnostics.length ?? 0);
  const nextCursor = page?.meta.nextCursor;

  function goTo(next: PagePosition) {
    setPage(undefined);
    setError("");
    setSource(undefined);
    setPosition(next);
  }

  useEffect(() => {
    let alive = true;
    void api
      .run({ op: "diagnostics", analysisId, limit: 100, cursor })
      .then((r) => {
        if (alive) {
          setPage(r);
          setTotal(
            offset + r.diagnostics.length + (r.meta.omittedCounts.diagnostics ?? 0),
          );
        }
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [analysisId, cursor, offset]);
  return (
    <section className="diagnostic-report">
      <details open={loading || Boolean(error || page?.diagnostics.length)}>
        <summary>
          Diagnostics{total === undefined ? "" : " · " + total.toLocaleString()}
        </summary>
        {loading && <p role="status">Loading diagnostics.</p>}
        {error && <p role="alert">{error}</p>}
        {Boolean(page?.diagnostics.length) && total !== undefined && (
          <p>
            Showing {(offset + 1).toLocaleString()}–{pageEnd.toLocaleString()} of{" "}
            {total.toLocaleString()} diagnostics
          </p>
        )}
        {page?.diagnostics.map((d, i) => (
          <article key={i}>
            <div className="diagnostic-heading">
              <strong>{d.code}</strong>
              <span className={d.severity === "info" ? "badge" : "badge warning"}>
                {severityLabel[d.severity]}
              </span>
            </div>
            <p>{d.message}</p>
            {d.span && (
              <p>
                Line {d.span.startLine}, column {d.span.startColumn}
              </p>
            )}
            {d.sourceId && d.span && (
              <button
                className="text-button"
                onClick={() =>
                  setSource({
                    sourceId: d.sourceId,
                    span: d.span,
                  })
                }
              >
                View diagnostic source
              </button>
            )}
            {d.ownerId && (
              <button
                className="text-button"
                aria-label="Open diagnostic owner"
                onClick={() => onSelect(d.ownerId!)}
              >
                Inspect affected object
              </button>
            )}
          </article>
        ))}
        {page && !page.diagnostics.length && (
          <p>No retained diagnostics.</p>
        )}
        {nextCursor && (
          <button onClick={() => goTo({ cursor: nextCursor, offset: pageEnd })}>
            Next diagnostics page
          </button>
        )}
        {cursor && (
          <button onClick={() => goTo(firstPage)}>
            First diagnostics page
          </button>
        )}
      </details>
      {source && (
        <SourceView
          analysisId={analysisId}
          evidence={source}
          onClose={() => setSource(undefined)}
        />
      )}
    </section>
  );
}
