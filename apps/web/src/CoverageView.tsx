import type { Coverage } from "../../../packages/contracts/src/model.js";
export function CoverageView({ coverage: c }: { coverage: Coverage }) {
  return (
    <section className="coverage">
      <div className="section-heading">
        <h2>Coverage</h2>
        <span className={"badge " + (c.partialImport ? "warning" : "")}>
          {c.partialImport ? "Partial import" : "Saved-file analysis"}
        </span>
      </div>
      <div className="coverage-metrics">
        <div>
          <strong>{c.importedInstances.toLocaleString()}</strong>
          <span>Objects indexed</span>
        </div>
        <div>
          <strong>
            {c.parsedScripts}
            <small> / {c.discoveredScripts}</small>
          </strong>
          <span>Scripts parsed</span>
        </div>
        <div>
          <strong className={c.unresolvedSites ? "rose" : ""}>
            {c.unresolvedSites}
          </strong>
          <span>Unresolved sites</span>
        </div>
        <div>
          <strong>{c.candidateSites}</strong>
          <span>Candidate sites</span>
        </div>
      </div>
      <details>
        <summary>What this analysis can tell you</summary>
        <p>
          Connections come from the saved project and supported Luau patterns.
          Potential paths do not prove runtime execution. Saved configuration
          values may change while playing.
        </p>
        {c.limitations.map((s, i) => (
          <p key={i}>{s}</p>
        ))}
        <p>No modeled dependent does not prove that a change is safe.</p>
      </details>
    </section>
  );
}
