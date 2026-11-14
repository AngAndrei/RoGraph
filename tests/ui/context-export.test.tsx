// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { QueryResult } from "../../packages/contracts/src/query.js";
import { createContext } from "../../packages/core/src/context.js";
const mock = vi.hoisted(() => ({
  run: vi.fn(),
  workspace: vi.fn(),
  context: vi.fn(),
}));
vi.mock("../../apps/web/src/api.js", () => ({ api: mock }));
vi.mock("../../apps/web/src/GraphView.js", () => ({
  GraphView: ({ onSelect }: any) => (
    <button onClick={() => onSelect("start")}>Choose start</button>
  ),
}));
vi.mock("../../apps/web/src/Hierarchy.js", () => ({
  Hierarchy: () => null,
  NodeMark: () => null,
}));
vi.mock("../../apps/web/src/Inspector.js", () => ({
  Inspector: () => <p>Node selected</p>,
}));
import App from "../../apps/web/src/App.js";
const result = (): QueryResult => ({
  analysisId: "snapshot-a",
  nodes: [
    {
      id: "start",
      kind: "instance",
      label: "Start",
      contexts: ["server"],
      attributes: {},
    },
  ],
  relations: [],
  evidence: [],
  sites: [],
  sources: [],
  paths: [],
  groups: [],
  diagnostics: [],
  coverage: {
    importedInstances: 1,
    discoveredScripts: 0,
    parsedScripts: 0,
    discoveredSites: 0,
    resolvedSites: 0,
    unresolvedSites: 0,
    candidateSites: 0,
    partialImport: false,
    limitations: [],
  },
  meta: { truncated: false, omittedCounts: {}, limits: { limit: 300 } },
});
beforeEach(() => {
  mock.workspace.mockResolvedValue({
    current: "snapshot-a",
    analyses: [
      {
        analysisId: "snapshot-a",
        snapshotId: "s",
        displayName: "Shop.rbxlx",
        importNumber: 1,
        inputKind: "place",
        complete: true,
        createdAt: "2026-11-14",
      },
    ],
  });
  mock.run.mockImplementation(async () => result());
  mock.context.mockImplementation(async () =>
    createContext(result(), { estimatedTokenBudget: 2000 }),
  );
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it("opens an AI export directly from a loaded graph without using chat", async () => {
  const user = userEvent.setup();
  render(<App />);
  await user.click(
    await screen.findByRole(
      "button",
      { name: "Export for AI" },
      { timeout: 10000 },
    ),
  );
  await screen.findByRole("dialog", { name: "Export agent context" });
  await screen.findByRole("button", { name: "Download JSON" });
  expect(mock.context).toHaveBeenLastCalledWith(
    { op: "overview", analysisId: "snapshot-a", view: "gameplay", limit: 300 },
    2000,
  );
  expect(screen.getByLabelText("Export scope")).toHaveProperty(
    "value",
    "overview",
  );
  expect(
    screen.getByText(/Recommended: compact JSON or Markdown/),
  ).toBeTruthy();
  expect(
    screen.getByText(/Pinned snapshot: Shop.rbxlx.*Import 1/),
  ).toBeTruthy();
});
it("exports the current query filters or the selected neighborhood only when requested", async () => {
  const user = userEvent.setup();
  render(<App />);
  await screen.findByRole(
    "button",
    { name: "Export for AI" },
    { timeout: 10000 },
  );
  await user.selectOptions(screen.getByLabelText("Traversal depth"), "4");
  await user.type(screen.getByLabelText("Object classes"), "ModuleScript");
  await waitFor(() =>
    expect(mock.run).toHaveBeenCalledWith(
      expect.objectContaining({ classes: ["ModuleScript"], depth: 4 }),
    ),
  );
  await user.click(screen.getByRole("button", { name: "Choose start" }));
  await screen.findByText("Node selected");
  await user.click(screen.getByRole("button", { name: "Export for AI" }));
  await user.selectOptions(screen.getByLabelText("Export scope"), "current");
  await waitFor(() =>
    expect(mock.context).toHaveBeenLastCalledWith(
      expect.objectContaining({
        op: "overview",
        analysisId: "snapshot-a",
        classes: ["ModuleScript"],
        depth: 4,
      }),
      2000,
    ),
  );
  await user.selectOptions(screen.getByLabelText("Export scope"), "selection");
  await waitFor(() =>
    expect(mock.context).toHaveBeenLastCalledWith(
      {
        op: "inspect",
        analysisId: "snapshot-a",
        nodeId: "start",
        view: "gameplay",
        limit: 300,
      },
      2000,
    ),
  );
});
it("does not offer selected-neighborhood export before a node is selected", async () => {
  const user = userEvent.setup();
  render(<App />);
  await user.click(
    await screen.findByRole(
      "button",
      { name: "Export for AI" },
      { timeout: 10000 },
    ),
  );
  expect(
    screen.queryByRole("option", { name: /Selected node neighborhood/ }),
  ).toBeNull();
});
