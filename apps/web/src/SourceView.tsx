import { Fragment, useEffect, useRef, useState } from "react";
import type { Evidence } from "../../../packages/contracts/src/model.js";
import type { SourceView as View } from "../../../packages/contracts/src/query.js";
import { api } from "./api.js";
import { sourceMatchRanges } from "./source-find.js";
export type SourceLocation = Pick<Evidence, "sourceId" | "span">;
type Props = { analysisId: string; evidence: SourceLocation; onClose: () => void };

export function SourceView(props: Props) {
  // A new evidence locator starts its own find and pagination state.
  return (
    <SourcePanel
      key={JSON.stringify([
        props.analysisId,
        props.evidence.sourceId,
        props.evidence.span,
      ])}
      {...props}
    />
  );
}

function SourcePanel({ analysisId, evidence, onClose }: Props) {
  const initialOffset = Math.max(0, (evidence.span?.startByte ?? 0) - 300);
  const [original, setOriginal] = useState(false);
  const [offset, setOffset] = useState(initialOffset);
  const [findOpen, setFindOpen] = useState(true);
  const [term, setTerm] = useState("");
  const [matchIndex, setMatchIndex] = useState(0);
  const [page, setPage] = useState<{
    view: View;
    key: string;
    original: boolean;
  }>();
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const codeRef = useRef<HTMLPreElement>(null);
  const activeMatchRef = useRef<HTMLElement>(null);
  const effectiveTerm = findOpen ? term : "";
  const requestKey = JSON.stringify([
    analysisId,
    evidence.sourceId,
    original,
    offset,
    effectiveTerm,
    matchIndex,
  ]);
  const view = page?.original === original ? page.view : undefined;
  const ready = page?.key === requestKey;
  const search = ready && effectiveTerm ? view?.search : undefined;
  const total = search?.total ?? 0;
  const pending = !ready && !error;

  useEffect(() => {
    let alive = true;
    setError("");
    const timer = setTimeout(
      () => {
        void api
          .run({
            op: "source",
            analysisId,
            sourceId: evidence.sourceId,
            original,
            startByte: offset,
            endByte: offset + 8000,
            ...(effectiveTerm ? { text: effectiveTerm, matchIndex } : {}),
          })
          .then((r) => {
            if (alive)
              setPage({ view: r.sources[0], key: requestKey, original });
          })
          .catch((e) => {
            if (alive) setError(e.message);
          });
      },
      effectiveTerm ? 140 : 0,
    );
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [requestKey]);

  useEffect(() => {
    if (findOpen) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [findOpen]);
  useEffect(() => {
    activeMatchRef.current?.scrollIntoView?.({
      block: "center",
      inline: "nearest",
    });
  }, [page, effectiveTerm]);

  const closeFind = () => {
    if (view?.excerpts[0]) setOffset(view.excerpts[0].span.startByte);
    setFindOpen(false);
    codeRef.current?.focus({ preventScroll: true });
  };
  const move = (delta: number) => {
    if (pending || !total) return;
    const next = (((search!.index + delta) % total) + total) % total;
    if (next === matchIndex)
      activeMatchRef.current?.scrollIntoView?.({
        block: "center",
        inline: "nearest",
      });
    setMatchIndex(next);
  };
  const excerpt = view?.excerpts[0],
    text = excerpt?.text ?? "";
  const bytes = new TextEncoder().encode(text),
    decoder = new TextDecoder();
  let before = text,
    highlight = "",
    after = "";
  if (
    excerpt &&
    evidence.span &&
    !original &&
    evidence.span.startByte < excerpt.span.endByte &&
    evidence.span.endByte > excerpt.span.startByte
  ) {
    const a = Math.max(0, evidence.span.startByte - excerpt.span.startByte),
      b = Math.min(
        bytes.length,
        evidence.span.endByte - excerpt.span.startByte,
      );
    before = decoder.decode(bytes.slice(0, a));
    highlight = decoder.decode(bytes.slice(a, b));
    after = decoder.decode(bytes.slice(b));
  }
  const activeStart =
    excerpt && search?.match
      ? decoder.decode(
          bytes.slice(0, search.match.startByte - excerpt.span.startByte),
        ).length
      : -1;
  const activeEnd =
    excerpt && search?.match
      ? decoder.decode(
          bytes.slice(0, search.match.endByte - excerpt.span.startByte),
        ).length
      : -1;
  const matches = sourceMatchRanges(
    text,
    effectiveTerm,
    activeStart >= 0 ? { start: activeStart, end: activeEnd } : undefined,
  );
  const found = matches.map((match, index) => {
    const previous = matches[index - 1],
      start = previous ? previous.end : 0;
    const active = match.active;
    return (
      <Fragment key={match.start}>
        {text.slice(start, match.start)}
        <mark
          className={
            active ? "source-match source-match-active" : "source-match"
          }
          aria-current={active ? "true" : undefined}
          ref={active ? activeMatchRef : undefined}
        >
          {text.slice(match.start, match.end)}
        </mark>
      </Fragment>
    );
  });
  const last = matches.at(-1);
  const hasPrevious = Boolean(excerpt && excerpt.span.startByte > 0);
  const hasNext = Boolean(
    view && excerpt && excerpt.span.endByte < view.omittedBytes + bytes.length,
  );

  return (
    <div className="modal-backdrop">
      <section
        className="source-panel"
        role="dialog"
        aria-label="Source evidence"
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
            e.preventDefault();
            setFindOpen(true);
            requestAnimationFrame(() => {
              inputRef.current?.focus();
              inputRef.current?.select();
            });
          } else if (e.key === "Escape" && findOpen) {
            e.preventDefault();
            e.stopPropagation();
            closeFind();
          }
        }}
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
            {view?.origin.originalSha256 && !view.origin.originalBinary && (
              <div className="segmented">
                <button
                  className={!original ? "active" : ""}
                  onClick={() => {
                    setOriginal(false);
                    setOffset(initialOffset);
                    setMatchIndex(0);
                  }}
                >
                  Saved Luau
                </button>
                <button
                  className={original ? "active" : ""}
                  onClick={() => {
                    setOriginal(true);
                    setOffset(0);
                    setMatchIndex(0);
                  }}
                >
                  Original file
                </button>
              </div>
            )}
            {findOpen ? (
              <form
                role="search"
                aria-label="Find in source file"
                className="source-search"
                onSubmit={(e) => {
                  e.preventDefault();
                  move(1);
                }}
              >
                <input
                  ref={inputRef}
                  type="search"
                  aria-label="Find in source"
                  placeholder="Find in source"
                  maxLength={256}
                  autoComplete="off"
                  spellCheck={false}
                  value={term}
                  onChange={(e) => {
                    if (!e.target.value && excerpt)
                      setOffset(excerpt.span.startByte);
                    setTerm(e.target.value);
                    setMatchIndex(0);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && e.shiftKey) {
                      e.preventDefault();
                      move(-1);
                    }
                  }}
                />
                <output
                  className="source-find-count"
                  aria-label="Match count"
                  aria-live="polite"
                  title="Matches in the complete source file"
                >
                  {pending && effectiveTerm
                    ? "…"
                    : `${total ? search!.index + 1 : 0}/${total}`}
                </output>
                <span className="source-find-divider" aria-hidden="true" />
                <button
                  type="button"
                  className="source-find-button"
                  aria-label="Previous match"
                  title="Previous match (Shift+Enter)"
                  disabled={pending || !total}
                  onClick={() => move(-1)}
                >
                  <svg viewBox="0 0 20 20" aria-hidden="true">
                    <path d="m6 12 4-4 4 4" />
                  </svg>
                </button>
                <button
                  type="button"
                  className="source-find-button"
                  aria-label="Next match"
                  title="Next match (Enter)"
                  disabled={pending || !total}
                  onClick={() => move(1)}
                >
                  <svg viewBox="0 0 20 20" aria-hidden="true">
                    <path d="m6 8 4 4 4-4" />
                  </svg>
                </button>
                <button
                  type="button"
                  className="source-find-button"
                  aria-label="Close find"
                  title="Close find (Escape)"
                  onClick={closeFind}
                >
                  <svg viewBox="0 0 20 20" aria-hidden="true">
                    <path d="m6 6 8 8m0-8-8 8" />
                  </svg>
                </button>
              </form>
            ) : (
              <button
                className="text-button source-find-open"
                onClick={() => setFindOpen(true)}
              >
                Find in source
              </button>
            )}
          </div>
          <pre
            ref={codeRef}
            className="source-code"
            tabIndex={0}
            aria-busy={pending}
          >
            <code>
              {last ? (
                <>
                  {found}
                  {text.slice(last.end)}
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
        {!effectiveTerm && (hasPrevious || hasNext) && (
          <footer>
            {hasPrevious && (
              <button
                className="text-button"
                onClick={() =>
                  setOffset(Math.max(0, excerpt!.span.startByte - 8000))
                }
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
