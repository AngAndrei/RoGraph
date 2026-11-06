import { useState } from "react";
import type { AnalysisSummary } from "../../../packages/contracts/src/query.js";
import type { GraphDiff } from "../../../packages/core/src/diff.js";
import { api } from "./api.js";
import { SnapshotOption } from "./SnapshotOption.js";
export function DiffView({
  analysisId,
  analyses,
}: {
  analysisId: string;
  analyses: AnalysisSummary[];
}) {
  const [before, setBefore] = useState(
      analyses.find((a) => a.analysisId !== analysisId)?.analysisId ?? "",
    ),
    [diff, setDiff] = useState<GraphDiff>(),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <details className="snapshot-diff">
      <summary>Compare snapshots</summary>
      <p>
        Compare modeled relationships with an earlier snapshot. Ambiguous object
        matches stay explicit.
      </p>
      <select
        aria-label="Compare with snapshot"
        value={before}
        onChange={(e) => setBefore(e.target.value)}
      >
        {analyses
          .filter((a) => a.analysisId !== analysisId)
          .map((a) => (
            <SnapshotOption key={a.analysisId} snapshot={a} />
          ))}
      </select>
      <button
        className="text-button"
        disabled={!before || busy}
        onClick={() => {
          setBusy(true);
          void api
            .diff(before, analysisId)
            .then(setDiff)
            .catch((e) => setError(e.message))
            .finally(() => setBusy(false));
        }}
      >
        {busy ? "Comparing…" : "Compare"}
      </button>
      {diff && (
        <div>
          <p>
            {diff.addedRelationIds.length} added links ·{" "}
            {diff.removedRelationIds.length} removed links
          </p>
          <p>
            {diff.changedRelations.length} changed target pairs ·{" "}
            {diff.ambiguousMatches.length} ambiguous matches
          </p>
        </div>
      )}
      {error && <p className="error">{error}</p>}
    </details>
  );
}
