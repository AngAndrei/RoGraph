import { expect, it } from "vitest";
import type { QueryResult } from "../packages/contracts/src/query.js";
import type { StoreSelection } from "../packages/core/src/store.js";
import { traverse } from "../packages/core/src/traversal.js";

it.each([false, true])(
  "discloses endpoint pagination independently of diagnostic omissions: %s",
  async (endpointsPaged) => {
    const result: QueryResult = {
      analysisId: "analysis",
      nodes: [],
      relations: [],
      evidence: [],
      sites: [],
      sources: [],
      diagnostics: [],
      paths: [],
      groups: [],
      coverage: {
        importedInstances: 0,
        discoveredScripts: 1,
        parsedScripts: 1,
        discoveredSites: 0,
        resolvedSites: 0,
        candidateSites: 0,
        unresolvedSites: 0,
        partialImport: false,
        limitations: [],
      },
      meta: {
        truncated: true,
        nextCursor: "diagnostics-page",
        omittedCounts: { diagnostics: 1 },
        limits: {},
      },
    };
    const select = async (selection: StoreSelection): Promise<QueryResult> => ({
      ...result,
      relations:
        selection.op === "adjacent"
          ? [{ id: "edge", source: "start", target: "end", type: "CALLS" }]
          : [],
      meta: {
        ...result.meta,
        nextCursor:
          endpointsPaged &&
          selection.op === "nodes" &&
          selection.ids.includes("end")
            ? "endpoint-page"
            : undefined,
      },
    });
    await traverse(
      { select },
      { op: "dependencies", analysisId: "analysis", relationTypes: ["CALLS"] },
      result,
      ["start"],
      [],
      1000,
    );
    expect(result.meta.omittedCounts).toEqual(
      endpointsPaged ? { diagnostics: 1, nodesAtLeast: 1 } : { diagnostics: 1 },
    );
  },
);
