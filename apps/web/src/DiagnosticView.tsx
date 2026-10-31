import { useEffect, useState } from "react";
import type { QueryResult } from "../../../packages/contracts/src/query.js";
import { api } from "./api.js";
import type { Evidence } from "../../../packages/contracts/src/model.js";
import { SourceView } from "./SourceView.js";
export function DiagnosticView({
  analysisId,
  onSelect,
}: {
  analysisId: string;
  onSelect: (id: string) => void;
}) {
  const [page, setPage] = useState<QueryResult>(),
    [cursor, setCursor] = useState<string>(),
    [error, setError] = useState(""),
    [source, setSource] = useState<Evidence>();
  useEffect(() => {
    let alive = true;
    setPage(undefined);
    setError("");
    void api
      .run({ op: "diagnostics", analysisId, limit: 100, cursor })
      .then((r) => {
        if (alive) setPage(r);
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [analysisId, cursor]);
  return (
    <section className="diagnostic-report">
      <details open={Boolean(page?.diagnostics.length)}>
        <summary>
          Diagnostics{page ? " · " + page.diagnostics.length : ""}
        </summary>
        {error && <p role="alert">{error}</p>}
        {page?.diagnostics.map((d, i) => (
          <article key={i}>
            <strong>{d.code}</strong>
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
                    id: "diagnostic:" + i,
                    relationId: "",
                    sourceId: d.sourceId,
                    span: d.span,
                    rule: "indexed-parser-diagnostic",
                    status: "unresolved",
                    assumptions: [],
                    contexts: ["unknown"],
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
          <p>No retained import or parse diagnostics.</p>
        )}
        {page?.meta.nextCursor && (
          <button onClick={() => setCursor(page.meta.nextCursor)}>
            Next diagnostics page
          </button>
        )}
        {cursor && (
          <button onClick={() => setCursor(undefined)}>
            First diagnostics page
          </button>
        )}
        {(page?.meta.omittedCounts.diagnostics ?? 0) > 0 && (
          <p>{page?.meta.omittedCounts.diagnostics} additional diagnostics</p>
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
