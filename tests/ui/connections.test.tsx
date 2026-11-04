// @vitest-environment jsdom
import { it, expect, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
vi.mock("sigma", () => ({ default: class {} }));
vi.mock("sigma/rendering", () => ({ extremityArrow: {}, pathCurved: {} }));
vi.mock("sigma/types", () => ({ DEFAULT_PRIMITIVES: {}, DEFAULT_STYLES: {} }));
import { projectGraph } from "../../apps/web/src/GraphView.js";
import { Inspector } from "../../apps/web/src/Inspector.js";
import type { QueryResult } from "../../packages/contracts/src/query.js";
const nodes = ["a", "b", "c"].map((id) => ({
  id,
  kind: "instance",
  label: id,
  contexts: ["server"],
  attributes: { className: "Script" },
}));
const relations = [
  { id: "create", source: "a", target: "b", type: "SPAWNS" },
  { id: "write", source: "a", target: "b", type: "MODIFIES" },
  { id: "reverse", source: "b", target: "a", type: "TRIGGERS" },
  { id: "other", source: "a", target: "c", type: "USES_OBJECT" },
];
const result = {
  analysisId: "snapshot",
  nodes,
  relations,
  evidence: [],
  sites: [],
  sources: [],
  groups: [],
  meta: { truncated: false, omittedCounts: {}, limits: {} },
  projection: {
    view: "gameplay",
    nodeIds: ["a", "b", "c"],
    edges: relations.map((r) => ({ ...r, label: r.type, relationIds: [r.id] })),
  },
} as unknown as QueryResult;
it("draws one line per unordered visible pair while retaining every action ID", () => {
  for (const r of [result, { ...result, projection: undefined }]) {
    const view = projectGraph(r, true);
    expect(view.edges).toHaveLength(2);
    const edge = view.edges.find((e) => e.source === "a" && e.target === "b")!;
    expect(edge.relationIds).toEqual(["create", "write", "reverse"]);
    expect(edge.bidirectional).toBe(true);
    expect(edge.label).toBe("3 relationships");
  }
  expect(result.relations).toEqual(relations);
});
it("inspects every action in a clicked connection and retains incoming directions", () => {
  try {
    render(
      <Inspector
        result={result}
        selectedId="a"
        edgeId="create"
        connectionRelationIds={["create", "write", "reverse"]}
        onSelect={() => {}}
        onExplore={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: /SPAWNS/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /MODIFIES/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /TRIGGERS/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /USES OBJECT/ })).toBeNull();
    expect(screen.getByText(/Incoming/)).toBeTruthy();
  } finally {
    cleanup();
  }
});

it("bundles function-level dependencies after collapsing them to their scripts", () => {
  const r = {
    ...result,
    projection: undefined,
    nodes: [
      ...nodes,
      {
        ...nodes[0],
        id: "fnA",
        kind: "function",
        attributes: { scriptId: "a" },
      },
      {
        ...nodes[1],
        id: "fnB",
        kind: "function",
        attributes: { scriptId: "b" },
      },
    ],
    relations: [
      { id: "call", type: "CALLS", source: "fnA", target: "fnB" },
      { id: "read", type: "READS", source: "a", target: "fnB" },
    ],
  } as unknown as QueryResult;
  const view = projectGraph(r, false);
  expect(view.edges).toHaveLength(1);
  expect(view.edges[0].relationIds).toEqual(["call", "read"]);
  expect([view.edges[0].source, view.edges[0].target]).toEqual(["a", "b"]);
});
