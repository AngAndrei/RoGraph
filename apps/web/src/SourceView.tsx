import { Fragment, useEffect, useRef, useState } from "react";
import type { Evidence } from "../../../packages/contracts/src/model.js";
import type { SourceView as View } from "../../../packages/contracts/src/query.js";
import { api } from "./api.js";
export function SourceView({
  analysisId,
  evidence,
  onClose,
}: {
  analysisId: string;
  evidence: Evidence;
  onClose: () => void;
}) {
  const [page, setPage] = useState<{
      view?: View;
      original: boolean;
      offset: number;
      sourceId?: string;
    }>(),
    [original, setOriginal] = useState(false),
    [offset, setOffset] = useState(
      Math.max(0, (evidence.span?.startByte ?? 0) - 300),
    ),
    [error, setError] = useState(""),
    [search, setSearch] = useState(""),
    [find, setFind] = useState({ term: "" });
  const loaded = page?.sourceId === evidence.sourceId ? page : undefined;
  const view =
    loaded?.original === original && loaded.offset === offset
      ? loaded.view
      : undefined;
  const firstMatch = useRef<HTMLElement>(null);
  useEffect(() => {
    firstMatch.current?.scrollIntoView?.({
      block: "nearest",
      inline: "nearest",
    });
  }, [find, view]);
  useEffect(() => {
    let alive = true;
    setError("");
    void api
      .run({
        op: "source",
        analysisId,
        sourceId: evidence.sourceId,
        original,
        startByte: offset,
        endByte: offset + 8000,
      })
      .then((r) => {
        if (alive)
          setPage({
            view: r.sources[0],
            original,
            offset,
            sourceId: evidence.sourceId,
          });
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [analysisId, evidence.sourceId, original, offset]);
  const excerpt = view?.excerpts[0];
  let before = excerpt?.text ?? "",
    highlight = "",
    after = "";
  if (
    excerpt &&
    evidence.span &&
    !original &&
    evidence.span.startByte < excerpt.span.endByte &&
    evidence.span.endByte > excerpt.span.startByte
  ) {
    const bytes = new TextEncoder().encode(excerpt.text),
      a = Math.max(0, evidence.span.startByte - excerpt.span.startByte),
      b = Math.min(
        bytes.length,
        evidence.span.endByte - excerpt.span.startByte,
      ),
      decoder = new TextDecoder();
    before = decoder.decode(bytes.slice(0, a));
    highlight = decoder.decode(bytes.slice(a, b));
    after = decoder.decode(bytes.slice(b));
  }
  const text = excerpt?.text ?? "";
  const matches = find.term
    ? [
        ...text.matchAll(
          new RegExp(find.term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "giu"),
        ),
      ]
    : [];
  const found = matches.map((match, index) => {
    const start = match.index;
    const previous = matches[index - 1];
    const end = previous ? previous.index + previous[0].length : 0;
    return (
      <Fragment key={start}>
        {text.slice(end, start)}
        <mark
          className="source-match"
          ref={index === 0 ? firstMatch : undefined}
        >
          {match[0]}
        </mark>
      </Fragment>
    );
  });
  const lastMatch = matches.at(-1);
  const hasPrevious = Boolean(excerpt && offset > 0);
  const hasNext = Boolean(
    view &&
      excerpt &&
      excerpt.span.endByte <
        view.omittedBytes + new TextEncoder().encode(text).length,
  );
  return (
    <div className="modal-backdrop">
      <section
        className="source-panel"
        role="dialog"
        aria-label="Source evidence"
      >
        <header>
          <h2>Source evidence</h2>
          <button
            className="icon-button"
            aria-label="Close source"
            onClick={onClose}
          >
            ×
          </button>
        </header>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="source-frame">
          <div className="source-toolbar">
            {loaded?.view?.origin.originalSha256 &&
              !loaded.view.origin.originalBinary && (
                <div className="segmented">
                  <button
                    className={!original ? "active" : ""}
                    onClick={() => {
                      setOriginal(false);
                      setOffset(
                        Math.max(0, (evidence.span?.startByte ?? 0) - 300),
                      );
                    }}
                  >
                    Saved Luau
                  </button>
                  <button
                    className={original ? "active" : ""}
                    onClick={() => {
                      setOriginal(true);
                      setOffset(0);
                    }}
                  >
                    Original file
                  </button>
                </div>
              )}
            <form
              role="search"
              className="source-search"
              onSubmit={(event) => {
                event.preventDefault();
                setFind({ term: search });
              }}
            >
              <input
                type="search"
                aria-label="Find in source"
                placeholder="Find in source"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  if (!event.target.value) setFind({ term: "" });
                }}
              />
              <button
                type="submit"
                className="icon-button"
                aria-label="Find matches"
              >
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 16 16"
                  fill="none"
                  aria-hidden="true"
                >
                  <circle
                    cx="6.5"
                    cy="6.5"
                    r="4"
                    stroke="currentColor"
                    strokeWidth="1.5"
                  />
                  <path
                    d="m9.5 9.5 4 4"
                    stroke="currentColor"
                    strokeWidth="1.5"
                  />
                </svg>
              </button>
            </form>
          </div>
          {find.term && !matches.length && (
            <small className="source-no-matches" role="status">
              No matches in this excerpt
            </small>
          )}
          <pre className="source-code" tabIndex={0}>
            <code>
              {lastMatch ? (
                <>
                  {found}
                  {text.slice(lastMatch.index + lastMatch[0].length)}
                </>
              ) : (
                <>
                  {before}
                  {highlight && <mark>{highlight}</mark>}
                  {after}
                </>
              )}
            </code>
          </pre>
        </div>
        {(hasPrevious || hasNext) && (
          <footer>
            {hasPrevious && (
              <button
                className="text-button"
                onClick={() => setOffset(Math.max(0, offset - 8000))}
              >
                Previous
              </button>
            )}
            {hasNext && (
              <button
                className="text-button"
                onClick={() => setOffset(excerpt!.span.endByte)}
              >
                Next
              </button>
            )}
          </footer>
        )}
      </section>
    </div>
  );
}
