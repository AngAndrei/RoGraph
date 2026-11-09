// @vitest-environment jsdom
import { it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TraceView } from "../../apps/web/src/TraceView.js";
import type {
  QueryResult,
  PathHop,
} from "../../packages/contracts/src/query.js";
afterEach(cleanup);
it("shows the first valid path when a new trace has fewer alternatives", async () => {
  const hop: PathHop = {
    relationId: "r",
    fromId: "a",
    toId: "b",
    direction: "forward",
    transition: "dependency",
  };
  const result: QueryResult = {
    analysisId: "same-snapshot",
    nodes: [
      {
        id: "a",
        kind: "instance",
        label: "Start",
        contexts: [],
        attributes: {},
      },
      { id: "b", kind: "instance", label: "End", contexts: [], attributes: {} },
    ],
    paths: [[hop], [hop]],
    relations: [],
    evidence: [],
    sites: [],
    sources: [],
    diagnostics: [],
    groups: [],
    coverage: {} as any,
    meta: { truncated: false, omittedCounts: {}, limits: {} },
  };
  const { rerender } = render(
    <TraceView result={result} onSelect={() => {}} />,
  );
  await userEvent.selectOptions(screen.getByLabelText("Path"), "1");
  rerender(
    <TraceView
      result={{
        ...result,
        paths: [[hop]],
        nodes: result.nodes.map((n) =>
          n.id === "a" ? { ...n, label: "New start" } : n,
        ),
      }}
      onSelect={() => {}}
    />,
  );
  expect(screen.queryByText("No path found")).toBeNull();
  expect(screen.getByRole("button", { name: "New start" })).toBeTruthy();
});
it("describes a local gameplay write as a gameplay relationship rather than network communication", () => {
  const result: QueryResult = {
    analysisId: "a",
    projection: {
      view: "gameplay",
      available: true,
      nodeIds: ["script", "label"],
      edges: [],
      diagnosticsByOwner: {},
    },
    nodes: [
      {
        id: "script",
        kind: "instance",
        label: "Manager",
        contexts: ["client"],
        attributes: {},
      },
      {
        id: "label",
        kind: "instance",
        label: "ToolName",
        contexts: ["client"],
        attributes: {},
      },
    ],
    relations: [
      {
        id: "write",
        source: "script",
        target: "label",
        type: "MODIFIES",
        gameplay: { label: "sets Text", conditional: true } as any,
      },
    ],
    paths: [
      [
        {
          relationId: "write",
          fromId: "script",
          toId: "label",
          direction: "forward",
          transition: "potential-communication",
        },
      ],
    ],
    evidence: [],
    sites: [],
    sources: [],
    diagnostics: [],
    groups: [],
    coverage: {} as any,
    meta: { truncated: false, omittedCounts: {}, limits: {} },
  };
  render(<TraceView result={result} onSelect={() => {}} />);
  expect(screen.getByText("Potential gameplay path")).toBeTruthy();
  expect(screen.getByText("sets Text · conditional")).toBeTruthy();
  expect(screen.queryByText("Potential communication")).toBeNull();
});
