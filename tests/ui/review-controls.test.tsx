// @vitest-environment jsdom
import { it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  act,
  render,
  screen,
  cleanup,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { QueryResult } from "../../packages/contracts/src/query.js";
const mock = vi.hoisted(() => ({ run: vi.fn(), workspace: vi.fn() }));
vi.mock("../../apps/web/src/api.js", () => ({ api: mock }));
vi.mock("../../apps/web/src/GraphView.js", () => ({
  GraphView: ({ onSelect, details }: any) => (
    <button data-details={details} onClick={() => onSelect("start")}>
      Choose start
    </button>
  ),
}));
vi.mock("../../apps/web/src/Hierarchy.js", () => ({
  Hierarchy: () => null,
  NodeMark: () => null,
}));
vi.mock("../../apps/web/src/Inspector.js", () => ({
  Inspector: ({ onExplore }: any) => (
    <div>
      <p>Node selected</p>
      <button onClick={() => onExplore("dependencies", "start")}>
        Dependencies
      </button>
      <button onClick={() => onExplore("impact", "start")}>Impact</button>
    </div>
  ),
}));
import App from "../../apps/web/src/App.js";
import { TraceControls } from "../../apps/web/src/TraceView.js";
import { DiagnosticView } from "../../apps/web/src/DiagnosticView.js";
const start = {
    id: "start",
    kind: "function" as const,
    label: "Start",
    contexts: ["server" as const],
    attributes: {},
  },
  destination = { ...start, id: "end", kind: "field" as const, label: "End" },
  hidden = { ...start, id: "hidden", label: "Hidden function" };
const result = (): QueryResult => ({
  analysisId: "a",
  nodes: [start, destination],
  relations: [],
  evidence: [],
  sites: [],
  sources: [],
  paths: [],
  groups: [],
  diagnostics: [],
  coverage: {
    importedInstances: 2,
    discoveredScripts: 1,
    parsedScripts: 1,
    discoveredSites: 0,
    resolvedSites: 0,
    unresolvedSites: 0,
    candidateSites: 0,
    partialImport: false,
    limitations: [],
  },
  meta: { truncated: false, omittedCounts: {}, limits: {} },
});
beforeEach(() => {
  mock.workspace.mockResolvedValue({
    current: "a",
    analyses: [
      {
        analysisId: "a",
        snapshotId: "s",
        inputKind: "place",
        complete: true,
        createdAt: "2026-10-31",
      },
    ],
  });
  mock.run.mockImplementation(async (q) =>
    q.op === "search" ? { ...result(), nodes: [hidden] } : result(),
  );
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it("keeps visible filters through overview, dependencies and impact actions", async () => {
  const user = userEvent.setup();
  render(<App />);
  await screen.findByRole("button", { name: "Choose start" });
  expect(screen.queryByText("Graph tools", { exact: true })).toBeNull();
  await user.click(screen.getByRole("button", { name: "Code" }));
  await waitFor(() =>
    expect(mock.run).toHaveBeenLastCalledWith(
      expect.objectContaining({ op: "overview" }),
    ),
  );
  await user.click(screen.getByRole("button", { name: "Choose start" }));
  await screen.findByText("Node selected");
  await user.click(screen.getByRole("button", { name: "Dependencies" }));
  await waitFor(() =>
    expect(mock.run).toHaveBeenLastCalledWith(
      expect.objectContaining({ op: "dependencies" }),
    ),
  );
  await user.click(screen.getByRole("button", { name: "Impact" }));
  await waitFor(() =>
    expect(mock.run).toHaveBeenLastCalledWith(
      expect.objectContaining({ op: "impact" }),
    ),
  );
  await user.selectOptions(screen.getByLabelText("Group by"), "folder");
  await user.type(screen.getByLabelText("Object classes"), "ModuleScript");
  await user.selectOptions(screen.getByLabelText("Traversal depth"), "4");
  await user.click(screen.getByLabelText("Include saved objects"));
  await waitFor(() =>
    expect(mock.run).toHaveBeenLastCalledWith(
      expect.objectContaining({
        groupBy: "folder",
        classes: ["ModuleScript"],
        depth: 4,
        includeInstances: true,
      }),
    ),
  );
});
it("returns to the overview on a same-mode click and closes the inspector", async () => {
  const user = userEvent.setup();
  render(<App />);
  await user.click(await screen.findByRole("button", { name: "Choose start" }));
  await user.click(await screen.findByRole("button", { name: "Dependencies" }));
  expect(
    screen
      .getByRole("button", { name: "Choose start" })
      .getAttribute("data-details"),
  ).toBe("true");
  mock.run.mockClear();
  await user.click(screen.getByRole("button", { name: "Gameplay" }));
  await waitFor(() =>
    expect(mock.run).toHaveBeenCalledWith(
      expect.objectContaining({ op: "overview", view: "gameplay" }),
    ),
  );
  expect(
    screen
      .getByRole("button", { name: "Choose start" })
      .getAttribute("data-details"),
  ).toBe("false");
  await user.click(screen.getByRole("button", { name: "Close inspector" }));
  expect(screen.queryByText("Node selected")).toBeNull();
});
it("searches trace endpoints across the pinned snapshot and retains active filters", async () => {
  const user = userEvent.setup();
  render(
    <TraceControls
      analysisId="a"
      nodes={[start, destination]}
      onClose={() => {}}
      onResult={() => {}}
      filters={
        {
          contexts: ["server"],
          statuses: ["resolved"],
          relationTypes: ["CALLS"],
          depth: 4,
        } as any
      }
    />,
  );
  await user.type(screen.getByLabelText("Find starting node"), "Hidden");
  const select = screen.getByLabelText("Trace start");
  await within(select).findByRole("option", { name: "Hidden function" });
  await user.selectOptions(select, "hidden");
  await user.selectOptions(screen.getByLabelText("Trace destination"), "end");
  await user.click(screen.getByRole("button", { name: "Find path" }));
  await waitFor(() =>
    expect(mock.run).toHaveBeenLastCalledWith(
      expect.objectContaining({
        op: "trace",
        analysisId: "a",
        fromId: "hidden",
        toId: "end",
        contexts: ["server"],
        statuses: ["resolved"],
        relationTypes: ["CALLS"],
        depth: 4,
      }),
    ),
  );
});
it("ignores a trace response after the controls are dismissed", async () => {
  const user = userEvent.setup();
  const onResult = vi.fn();
  let complete!: (value: QueryResult) => void;
  mock.run.mockReturnValueOnce(
    new Promise<QueryResult>((resolve) => {
      complete = resolve;
    }),
  );
  const { unmount } = render(
    <TraceControls
      analysisId="a"
      nodes={[start, destination]}
      onClose={() => {}}
      onResult={onResult}
    />,
  );
  await user.click(screen.getByRole("button", { name: "Find path" }));
  unmount();
  await act(async () => complete(result()));
  expect(onResult).not.toHaveBeenCalled();
});
it("shows diagnostic details and opens their indexed owner", async () => {
  mock.run.mockImplementation(async () => ({
    ...result(),
    diagnostics: [
      {
        code: "PROPERTY_NOT_RETAINED",
        severity: "warning",
        message: "Saved property was not retained",
        ownerId: "start",
      },
    ],
  }));
  const user = userEvent.setup();
  render(<App />);
  await screen.findByText("Saved property was not retained");
  await user.click(
    screen.getByRole("button", { name: "Open diagnostic owner" }),
  );
  await screen.findByText("Node selected");
  expect(mock.run).toHaveBeenCalledWith(
    expect.objectContaining({
      op: "inspect",
      nodeId: "start",
      analysisId: "a",
    }),
  );
});
it("opens a parse diagnostic at its exact indexed source location", async () => {
  const span = {
    startByte: 0,
    endByte: 1,
    startLine: 1,
    startColumn: 1,
    endLine: 1,
    endColumn: 2,
  };
  mock.run.mockImplementation(async (q) =>
    q.op === "source"
      ? {
          ...result(),
          sources: [
            {
              id: "diagnostic-source",
              scriptId: "start",
              sha256: "a".repeat(64),
              origin: { kind: "place" },
              excerpts: [{ span, text: "?" }],
              omittedBytes: 0,
            },
          ],
        }
      : {
          ...result(),
          diagnostics: [
            {
              code: "LUAU_PARSE_ERROR",
              severity: "warning",
              message: "Unexpected token",
              ownerId: "start",
              sourceId: "diagnostic-source",
              span,
            },
          ],
        },
  );
  const user = userEvent.setup();
  render(<DiagnosticView analysisId="a" onSelect={() => {}} />);
  await user.click(
    await screen.findByRole("button", { name: "View diagnostic source" }),
  );
  await waitFor(() =>
    expect(mock.run).toHaveBeenCalledWith(
      expect.objectContaining({
        op: "source",
        sourceId: "diagnostic-source",
        analysisId: "a",
      }),
    ),
  );
  await screen.findByRole("heading", { name: "Source evidence" });
  await user.type(
    screen.getByRole("searchbox", { name: "Find in source" }),
    "?",
  );
  await user.click(screen.getByRole("button", { name: "Find matches" }));
  expect(document.querySelector(".source-match")?.textContent).toBe("?");
  expect(screen.queryByRole("button", { name: "Previous" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Next" })).toBeNull();
});
