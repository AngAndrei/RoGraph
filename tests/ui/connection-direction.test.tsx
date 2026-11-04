// @vitest-environment jsdom
import { it, expect } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { Inspector } from "../../apps/web/src/Inspector.js";
import type { QueryResult } from "../../packages/contracts/src/query.js";
it("keeps the outgoing direction when inspecting a function call collapsed to its script", () => {
  const r = {
    analysisId: "a",
    nodes: [
      {
        id: "a",
        kind: "instance",
        label: "A",
        contexts: ["server"],
        attributes: { className: "Script" },
      },
      {
        id: "fnA",
        kind: "function",
        label: "A.work",
        contexts: ["server"],
        attributes: { scriptId: "a" },
      },
      {
        id: "fnB",
        kind: "function",
        label: "B.run",
        contexts: ["server"],
        attributes: { scriptId: "b" },
      },
    ],
    relations: [{ id: "call", type: "CALLS", source: "fnA", target: "fnB" }],
    evidence: [],
    sites: [],
    sources: [],
    meta: { truncated: false, limits: {}, omittedCounts: {} },
  } as unknown as QueryResult;
  try {
    render(
      <Inspector
        result={r}
        selectedId="a"
        edgeId="call"
        connectionRelationIds={["call"]}
        onSelect={() => {}}
        onExplore={() => {}}
      />,
    );
    expect(screen.getByText(/Outgoing/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /B.run/ })).toBeTruthy();
    expect(screen.queryByText(/Incoming/)).toBeNull();
  } finally {
    cleanup();
  }
});
