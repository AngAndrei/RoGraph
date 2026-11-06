import type { AnalysisSummary } from "../../../packages/contracts/src/query.js";

export function snapshotDetails(snapshot: AnalysisSummary) {
  return `${snapshot.analysisId} · ${snapshot.complete ? "Complete" : "Partial import"}`;
}

export function SnapshotOption({ snapshot }: { snapshot: AnalysisSummary }) {
  return (
    <option value={snapshot.analysisId} title={snapshotDetails(snapshot)}>
      {snapshot.displayName} · Import {snapshot.importNumber}
    </option>
  );
}
