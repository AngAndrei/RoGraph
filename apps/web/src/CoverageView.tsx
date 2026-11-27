import type { Coverage } from "../../../packages/contracts/src/model.js";
export function CoverageView({ coverage: c }: { coverage: Coverage }) {
  const incompleteSource = c.parsedScripts < c.discoveredScripts;
  return (
    <section className="coverage">
      <div className="section-heading">
        <h2>Coverage</h2>
        <span className={c.partialImport || incompleteSource ? "badge warning" : "badge"}>
          {c.partialImport
            ? "Partial import"
            : incompleteSource
              ? "Source incomplete"
              : "Saved-file analysis"}
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
      <details open={c.partialImport || incompleteSource}>
        <summary>Coverage details</summary>
        {c.discoveredSites > 0 && (
          <p>
            {c.resolvedSites.toLocaleString()} of{" "}
            {c.discoveredSites.toLocaleString()} discovered code sites resolved.
          </p>
        )}
        {(c.unresolvedSites > 0 || c.candidateSites > 0) && (
          <p>
            Unresolved sites have no confirmed target. Candidate sites have
            possible targets that remain uncertain.
          </p>
        )}
        {c.limitations.map((limitation) => (
          <p key={limitation}>{limitation}</p>
        ))}
      </details>
    </section>
  );
}
