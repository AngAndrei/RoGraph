// @vitest-environment jsdom
import { it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  act,
  render,
  screen,
  cleanup,
  waitFor,
  within,
  fireEvent,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { QueryResult } from "../../packages/contracts/src/query.js";
const mock = vi.hoisted(() => ({
  run: vi.fn(),
  workspace: vi.fn(),
  importRojo: vi.fn(),
  job: vi.fn(),
}));
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
import { CoverageView } from "../../apps/web/src/CoverageView.js";
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

it("shows why coverage is incomplete even when the saved-file import succeeded", () => {
  const limitations = [
    "One saved place; runtime-created objects, external asset code, and dynamic dispatch may be absent.",
    "1 saved scripts have missing or invalid source; dependencies are incomplete.",
  ];
  render(
    <CoverageView
      coverage={{
        ...result().coverage,
        discoveredScripts: 4,
        parsedScripts: 3,
        discoveredSites: 10,
        resolvedSites: 6,
        unresolvedSites: 2,
        candidateSites: 2,
        limitations,
      }}
    />,
  );
  expect(screen.getByText("Source incomplete")).toBeTruthy();
  expect(screen.getByText(limitations[1]).closest("details")?.open).toBe(true);
  expect(screen.getByText("6 of 10 discovered code sites resolved.")).toBeTruthy();
  expect(screen.getByText(/Candidate sites have possible targets/)).toBeTruthy();
});

it("keeps the diagnostic total and resets the cursor and source on snapshot change", async () => {
  const firstPage = Array.from({ length: 100 }, (_, index) => ({
    code: `FIRST_${index + 1}`,
    severity: "warning" as const,
    message: `Diagnostic ${index + 1}`,
  }));
  const span = {
    startByte: 0,
    endByte: 1,
    startLine: 1,
    startColumn: 1,
    endLine: 1,
    endColumn: 2,
  };
  let finishPage: (value: QueryResult) => void = () => {};
  mock.run.mockImplementation((query) => {
    if (query.op === "source") return Promise.resolve(result());
    if (query.analysisId === "b")
      return Promise.resolve({ ...result(), analysisId: "b" });
    if (query.cursor === "opaque-next")
      return new Promise<QueryResult>((resolve) => (finishPage = resolve));
    return Promise.resolve({
      ...result(),
      diagnostics: firstPage,
      meta: {
        ...result().meta,
        truncated: true,
        omittedCounts: { diagnostics: 1 },
        nextCursor: "opaque-next",
      },
    });
  });
  const user = userEvent.setup();
  const { rerender } = render(<DiagnosticView analysisId="a" onSelect={() => {}} />);
  expect(await screen.findByText("Diagnostics · 101")).toBeTruthy();
  expect(screen.getByText("Showing 1–100 of 101 diagnostics")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Next diagnostics page" }));
  expect(screen.queryByText("FIRST_1")).toBeNull();
  expect(screen.getByRole("status").textContent).toContain("Loading diagnostics");
  await act(async () =>
    finishPage({
      ...result(),
      diagnostics: [{
        code: "SECOND",
        message: "Diagnostic 101",
        severity: "error",
        sourceId: "source-from-a",
        span,
      }],
    }),
  );
  expect(screen.getByText("Diagnostics · 101")).toBeTruthy();
  expect(screen.getByText("Showing 101–101 of 101 diagnostics")).toBeTruthy();
  expect(screen.getByText("Error", { exact: true })).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "View diagnostic source" }));
  expect(screen.getByRole("dialog", { name: "Source evidence" })).toBeTruthy();
  rerender(<DiagnosticView analysisId="b" onSelect={() => {}} />);
  expect(screen.queryByRole("dialog", { name: "Source evidence" })).toBeNull();
  expect(screen.queryByText("SECOND")).toBeNull();
  await screen.findByText("No retained diagnostics.");
  expect(mock.run).toHaveBeenCalledWith({
    op: "diagnostics",
    analysisId: "b",
    limit: 100,
    cursor: undefined,
  });
});

it("exposes a diagnostic request failure without opening a collapsed panel", async () => {
  mock.run.mockRejectedValue(new Error("Diagnostics could not be loaded."));
  render(<DiagnosticView analysisId="a" onSelect={() => {}} />);
  const alert = await screen.findByRole("alert");
  expect(alert.closest("details")?.open).toBe(true);
});

it.each([
  [{ additionalRecordsAtLeast: 1 }, true],
  [{ diagnostics: 2, sourceDocuments: 3 }, false],
])("reports graph query omissions for %j", async (omittedCounts, visible) => {
  mock.run.mockImplementation(async (query) =>
    query.op === "overview"
      ? { ...result(), meta: { ...result().meta, truncated: true, omittedCounts } }
      : result(),
  );
  render(<App />);
  await screen.findByRole("button", { name: "Choose start" });
  expect(Boolean(screen.queryByText(/This graph query reached a result limit/))).toBe(visible);
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
  expect(screen.queryByLabelText("Include saved objects")).toBeNull();
  await user.type(
    screen.getByRole("searchbox", { name: "Search nodes" }),
    "Start",
  );
  await waitFor(() =>
    expect(mock.run).toHaveBeenLastCalledWith(
      expect.objectContaining({
        groupBy: "folder",
        classes: ["ModuleScript"],
        depth: 4,
        includeInstances: false,
      }),
    ),
  );
});
it("explains dependency scope and returns to overview without a false zero-hop path", async () => {
  const user = userEvent.setup();
  render(<App />);
  await user.click(await screen.findByRole("button", { name: "Choose start" }));
  await user.click(await screen.findByRole("button", { name: "Dependencies" }));
  await screen.findByRole("button", { name: "Back to overview" });
  expect(
    screen.queryByText(/0 hops|No modeled path within these bounds/),
  ).toBeNull();
  await user.click(screen.getByRole("button", { name: "Back to overview" }));
  await waitFor(() =>
    expect(screen.queryByText("Dependencies of Start")).toBeNull(),
  );
});
it("makes existing path tracing discoverable from the graph workspace", async () => {
  const user = userEvent.setup();
  render(<App />);
  await user.click(await screen.findByRole("button", { name: "Trace a path" }));
  expect(screen.getByRole("button", { name: "Find path" })).toBeTruthy();
  expect(screen.getByLabelText("Trace start")).toBeTruthy();
});
it("discards a pending trace when the developer switches graph view", async () => {
  const user = userEvent.setup();
  let finish: (r: QueryResult) => void = () => {};
  mock.run.mockImplementation((q) =>
    q.op === "trace"
      ? new Promise((resolve) => {
          finish = resolve;
        })
      : Promise.resolve(result()),
  );
  render(<App />);
  await user.click(await screen.findByRole("button", { name: "Trace a path" }));
  await user.click(screen.getByRole("button", { name: "Find path" }));
  await user.click(screen.getByRole("button", { name: "Code" }));
  await act(async () =>
    finish({
      ...result(),
      paths: [
        [
          {
            relationId: "late",
            fromId: "start",
            toId: "end",
            direction: "forward",
            transition: "dependency",
          },
        ],
      ],
    }),
  );
  expect(screen.queryByText("Potential connection path")).toBeNull();
  expect(screen.queryByText("1 hops")).toBeNull();
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
it("lets a developer include configuration influence in a gameplay trace", async () => {
  const user = userEvent.setup();
  render(
    <TraceControls
      analysisId="a"
      nodes={[start, destination]}
      filters={{ view: "gameplay" }}
      onClose={() => {}}
      onResult={() => {}}
    />,
  );
  await user.selectOptions(
    screen.getByLabelText("Trace question"),
    "influence",
  );
  await user.click(screen.getByRole("button", { name: "Find path" }));
  await waitFor(() =>
    expect(mock.run).toHaveBeenLastCalledWith(
      expect.objectContaining({ traceGoal: "influence", view: "gameplay" }),
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
it.each([false, true])(
  "does not offer another game as a newer snapshot (watch enabled: %s)",
  async (enabled) => {
    const analyses = [
      {
        analysisId: "a",
        snapshotId: "s",
        displayName: "First.rbxl",
        importNumber: 1,
        inputKind: "place",
        complete: true,
        createdAt: "2026-11-01",
      },
      {
        analysisId: "b",
        snapshotId: "t",
        displayName: "Other.rbxl",
        importNumber: 2,
        inputKind: "place",
        complete: true,
        createdAt: "2026-11-02",
      },
    ];
    mock.workspace
      .mockResolvedValueOnce({ current: "a", analyses, watch: { enabled } })
      .mockResolvedValue({ current: "b", analyses, watch: { enabled } });
    render(<App />);
    await screen.findByRole("button", { name: "Choose start" });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 3100));
    });
    expect(screen.queryByText("A new complete snapshot is ready.")).toBeNull();
  },
);
it("still offers an unseen complete import received from outside this browser", async () => {
  const analyses = [
    {
      analysisId: "a",
      snapshotId: "s",
      displayName: "Project",
      importNumber: 1,
      inputKind: "rojo",
      complete: true,
      createdAt: "2026-11-01",
    },
    {
      analysisId: "b",
      snapshotId: "t",
      displayName: "Project",
      importNumber: 2,
      inputKind: "rojo",
      complete: true,
      createdAt: "2026-11-02",
    },
  ];
  mock.workspace
    .mockResolvedValueOnce({
      current: "a",
      analyses: [analyses[0]],
      watch: { enabled: false },
    })
    .mockResolvedValue({ current: "b", analyses, watch: { enabled: false } });
  render(<App />);
  await screen.findByRole("button", { name: "Choose start" });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 3100));
  });
  expect(screen.getByText("A new complete snapshot is ready.")).toBeTruthy();
});
it("offers partial watched revisions without switching away from the open snapshot", async () => {
  const analyses = [true, false, true].map((complete, index) => ({
    analysisId: String.fromCharCode(97 + index),
    snapshotId: `snapshot-${index}`,
    displayName: "Project",
    importNumber: index + 1,
    inputKind: "rojo",
    complete,
    createdAt: `2026-11-0${index + 1}`,
  }));
  const [first, partial, newer] = analyses;
  const workspace = (index: number) => ({
    current: index === 2 ? newer.analysisId : first.analysisId,
    analyses: analyses.slice(0, index + 1),
    watch: {
      enabled: true,
      analysisId: analyses[index].analysisId,
      analysisJobId: `job-${index}`,
    },
  });
  mock.workspace.mockResolvedValue(workspace(0));
  vi.useFakeTimers();
  try {
    await act(async () => { render(<App />); });
    const selected = () => screen.getByLabelText("Snapshot").getAttribute("data-analysis-id");
    expect(selected()).toBe(first.analysisId);
    const poll = () => act(() => vi.advanceTimersByTimeAsync(3000));
    await poll();
    expect(screen.queryByRole("button", { name: "Open new snapshot" })).toBeNull();

    // The saved row can be visible just before the watch job records its revision.
    mock.workspace.mockResolvedValue({ ...workspace(0), analyses: analyses.slice(0, 2) });
    await poll();
    expect(screen.queryByRole("button", { name: "Open new snapshot" })).toBeNull();

    mock.workspace.mockResolvedValue(workspace(1));
    await poll();
    expect(screen.getByText("A new partial snapshot is ready to inspect.")).toBeTruthy();
    expect(selected()).toBe(first.analysisId);
    expect(mock.run.mock.calls.some(([query]) => query.analysisId === partial.analysisId)).toBe(false);

    await poll();
    expect(screen.getByRole("button", { name: "Open new snapshot" })).toBeTruthy();

    mock.workspace.mockResolvedValue(workspace(2));
    await poll();
    expect(screen.getByText("A new complete snapshot is ready.")).toBeTruthy();
    expect(screen.queryByText("A new partial snapshot is ready to inspect.")).toBeNull();
    await act(async () => screen.getByRole("button", { name: "Open new snapshot" }).click());
    expect(selected()).toBe(newer.analysisId);
  } finally {
    vi.useRealTimers();
  }
});
it("lets the initial watched import open directly without a second notice", async () => {
  const previous = {
    analysisId: "a",
    snapshotId: "place",
    displayName: "First.rbxl",
    importNumber: 1,
    inputKind: "place",
    complete: true,
    createdAt: "2026-11-01",
  };
  const next = {
    ...previous,
    analysisId: "b",
    snapshotId: "project",
    displayName: "default.project.json",
    importNumber: 2,
    inputKind: "rojo",
    complete: false,
    createdAt: "2026-11-02",
  };
  const firstJob = { id: "selected-by-user", name: next.displayName, status: "running", progress: { stage: "parse", completed: 0, total: 1 } };
  let finishJob: (value: unknown) => void = () => {};
  const pending = new Promise((resolve) => { finishJob = resolve; });
  mock.workspace.mockResolvedValue({ current: "a", analyses: [previous] });
  mock.importRojo.mockResolvedValue(firstJob);
  mock.job.mockReturnValue(pending);
  vi.useFakeTimers();
  try {
    await act(async () => { render(<App />); });
    if (!screen.queryByRole("button", { name: "Rojo project" }))
      fireEvent.click(screen.getByRole("button", { name: /import project/i }));
    fireEvent.click(screen.getByRole("button", { name: "Rojo project" }));
    fireEvent.change(screen.getByLabelText("Rojo project path"), { target: { value: "C:\\Games\\default.project.json" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Watch for saved changes" }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Analyze" })); });
    expect(mock.importRojo).toHaveBeenCalledWith("C:\\Games\\default.project.json", true);

    mock.workspace.mockResolvedValue({
      current: "a",
      analyses: [next, previous],
      watch: { enabled: true, analysisId: "b", analysisJobId: firstJob.id },
    });
    await act(() => vi.advanceTimersByTimeAsync(3000));
    expect(screen.queryByRole("button", { name: "Open new snapshot" })).toBeNull();
    await act(async () => { finishJob({ ...firstJob, status: "partial", analysisId: "b" }); });
    expect(screen.getByLabelText("Snapshot").getAttribute("data-analysis-id")).toBe("b");
  } finally {
    vi.useRealTimers();
  }
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
  await waitFor(() =>
    expect(document.querySelector(".source-match")?.textContent).toBe("?"),
  );
  expect(screen.getByRole("button", { name: "Close find" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Previous" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Next" })).toBeNull();
});
