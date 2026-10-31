// @vitest-environment jsdom
import { it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
const mock = vi.hoisted(() => ({ run: vi.fn(), workspace: vi.fn() }));
vi.mock("../../apps/web/src/api.js", () => ({ api: mock }));
vi.mock("../../apps/web/src/GraphView.js", () => ({
  GraphView: ({ onSelect }: any) => (
    <button onClick={() => onSelect("chicken")}>Select Chicken</button>
  ),
}));
vi.mock("../../apps/web/src/Hierarchy.js", () => ({
  Hierarchy: () => null,
  NodeMark: () => null,
}));
import App from "../../apps/web/src/App.js";
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it("defaults to Gameplay and keeps the actual selected object when switching to Code", async () => {
  const base = {
    analysisId: "a",
    capabilities: { code: true, gameplay: true },
    nodes: [
      {
        id: "chicken",
        kind: "instance",
        label: "Chicken",
        contexts: ["server"],
        attributes: { className: "Model" },
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
      candidateSites: 0,
      unresolvedSites: 0,
      partialImport: false,
      limitations: [],
    },
    meta: { truncated: false, omittedCounts: {}, limits: {} },
  };
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
  mock.run.mockImplementation(async (q: any) => ({
    ...base,
    projection: {
      view: q.view ?? "code",
      available: true,
      nodeIds: ["chicken"],
      edges: [],
      diagnosticsByOwner: {},
    },
  }));
  const user = userEvent.setup();
  render(<App />);
  await screen.findByRole("button", { name: "Gameplay" });
  expect(screen.getByRole("option", { name: "SPAWNS" })).toBeTruthy();
  expect(
    mock.run.mock.calls.some(
      ([q]) => q.op === "overview" && q.view === "gameplay",
    ),
  ).toBe(true);
  await user.click(screen.getByRole("button", { name: "Select Chicken" }));
  await screen.findByRole("heading", { name: "Chicken" });
  await user.click(screen.getByRole("button", { name: "Code" }));
  await waitFor(() =>
    expect(
      mock.run.mock.calls.some(
        ([q]) =>
          q.op === "inspect" && q.nodeId === "chicken" && q.view === "code",
      ),
    ).toBe(true),
  );
  expect(screen.getByRole("heading", { name: "Chicken" })).toBeTruthy();
  expect(screen.queryByText(/symbolic spawned egg/i)).toBeNull();
});
