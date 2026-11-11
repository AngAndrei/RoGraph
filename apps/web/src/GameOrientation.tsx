import { useMemo, useState, useEffect } from "react";
import type { QueryResult } from "../../../packages/contracts/src/query.js";
import { startingScripts, relationshipSummary } from "./game-orientation.js";
import { contextualLabels } from "./graph-exploration.js";

export function GameOrientation({
  result,
  onSelect,
}: {
  result: QueryResult;
  onSelect: (id: string) => void;
}) {
  const entries = useMemo(() => startingScripts(result), [result]);
  const labels = useMemo(() => contextualLabels(result.nodes), [result.nodes]);
  const [expanded, setExpanded] = useState(() => window.innerWidth > 760);
  useEffect(() => {
    const narrow = window.matchMedia?.("(max-width: 760px)");
    if (!narrow) return;
    const collapse = () => {
      if (narrow.matches) setExpanded(false);
    };
    narrow.addEventListener("change", collapse);
    return () => narrow.removeEventListener("change", collapse);
  }, []);
  return (
    <details
      className="game-orientation"
      open={expanded}
      onToggle={(event) => setExpanded(event.currentTarget.open)}
    >
      <summary>
        <strong>Start here</strong>
        <span>Connected scripts in this map · choose one to inspect</span>
      </summary>
      <div className="orientation-entries">
        {entries.map(({ node, triggers, connectedObjects, example }) => (
          <button
            key={node.id}
            className="orientation-entry"
            onClick={() => onSelect(node.id)}
            aria-label={`Inspect ${labels.get(node.id) ?? node.label}`}
          >
            <strong>
              {labels.get(node.id) ?? node.label}
              <span aria-hidden="true">↗</span>
            </strong>
            <small>
              {String(node.attributes.className)} ·{" "}
              {node.contexts.join(" + ") || "unknown"} context
              {" · "}
              {connectedObjects} connected{" "}
              {connectedObjects === 1 ? "object" : "objects"}
              {triggers ? ` · ${triggers} event links` : ""}
            </small>
            {example && (
              <span className="orientation-example">
                {labels.get(example.fromId)} →{" "}
                <em>
                  {example.label}
                  {example.conditional ? " (conditional)" : ""}
                </em>{" "}
                → {labels.get(example.toId)}
              </span>
            )}
          </button>
        ))}
        {!entries.length && (
          <p>
            No starting scripts with supported gameplay links in this map.
            Search the project or switch to Code to explore further.
          </p>
        )}
      </div>
      <p className="orientation-note">
        Suggestions use the connections shown here. Inspect an object for
        incoming and outgoing connections and source. Right-click a graph node
        to rename or highlight it for later.
      </p>
    </details>
  );
}

export function BehaviorSummary({
  result,
  nodeId,
  onSelect,
}: {
  result: QueryResult;
  nodeId: string;
  onSelect: (id: string) => void;
}) {
  const summary = useMemo(
    () => relationshipSummary(result, nodeId),
    [result, nodeId],
  );
  const labels = useMemo(() => contextualLabels(result.nodes), [result.nodes]);
  if (!summary.incoming.length && !summary.outgoing.length) return null;
  return (
    <section className="behavior-summary" aria-label="Behavior at a glance">
      <h3>At a glance</h3>
      {(["incoming", "outgoing"] as const).map((direction) => {
        const relations = summary[direction];
        if (!relations.length) return null;
        return (
          <div key={direction}>
            <strong>
              {direction === "incoming"
                ? "Incoming connections"
                : "Outgoing connections"}{" "}
              <small>{relations.length}</small>
            </strong>
            {relations.slice(0, 3).map((relation) => {
              const otherId =
                direction === "incoming" ? relation.source : relation.target;
              return (
                <button key={relation.id} onClick={() => onSelect(otherId)}>
                  <span>
                    {direction === "incoming" ? "←" : "→"} {labels.get(otherId)}
                  </span>
                  <small>
                    {relation.gameplay!.label}
                    {relation.gameplay!.conditional ? " · conditional" : ""}
                  </small>
                </button>
              );
            })}
            {relations.length > 3 && (
              <small>
                + {relations.length - 3} more in Relationships below
              </small>
            )}
          </div>
        );
      })}
      <p>
        Potential saved-code behavior; only loaded relationships are summarized.
      </p>
    </section>
  );
}
