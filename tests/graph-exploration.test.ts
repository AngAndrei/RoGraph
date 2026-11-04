import { expect, it } from "vitest";
import { projectGraph } from "../apps/web/src/graph-projection.js";
import {
  focusGraph,
  contextualLabels,
  arrangementKey,
  directedLayoutLinks,
} from "../apps/web/src/graph-exploration.js";
import { validPositions } from "../apps/web/src/layout-protocol.js";
import type { QueryResult } from "../packages/contracts/src/query.js";

const result = {
  analysisId: "same",
  nodes: ["a", "b", "c", "d"].map((id) => ({
    id,
    kind: "instance",
    label: "Part",
    attributes: { className: "Script", path: `Workspace.${id}.Part` },
  })),
  relations: [
    { id: "ab", source: "a", target: "b", type: "REFERENCES" },
    { id: "ba", source: "b", target: "a", type: "MODIFIES" },
    { id: "bc", source: "b", target: "c", type: "REFERENCES" },
  ],
  groups: [],
} as unknown as QueryResult;

it("focuses an exact-ID neighborhood and discloses hidden and boundary connections", () => {
  const all = projectGraph(result, true),
    f = focusGraph(all, "a");
  expect(f.nodes.map((n) => n.id)).toEqual(["a", "b"]);
  expect(f.hiddenNodes).toBe(2);
  expect(f.hiddenConnections).toBe(1);
  expect(f.boundaryConnections).toBe(1);
  expect(focusGraph(all, "missing").nodes).toEqual(all.nodes);
});
it("preserves both directed action sets behind a reverse bundle", () => {
  const view = projectGraph(result, true),
    links = directedLayoutLinks(view);
  expect(links).toContainEqual({ source: "a", target: "b" });
  expect(links).toContainEqual({ source: "b", target: "a" });
  expect(view.edges[0].relationIds).toEqual(["ab", "ba"]);
});
it("distinguishes duplicate names using path context without changing stored labels", () => {
  const labels = contextualLabels(result.nodes);
  expect(labels.get("a")).toContain("a");
  expect(new Set(labels.values()).size).toBe(4);
  expect(result.nodes.every((n) => n.label === "Part")).toBe(true);
});

it("uses available parent names rather than opaque owner IDs for context", () => {
  const nodes = [
    { id: "p/1", label: "Inventory", kind: "instance", attributes: {} },
    { id: "p/2", label: "Enemy", kind: "instance", attributes: {} },
    {
      id: "a",
      label: "Part",
      ownerId: "p/1",
      kind: "instance",
      attributes: {},
    },
    {
      id: "b",
      label: "Part",
      ownerId: "p/2",
      kind: "instance",
      attributes: {},
    },
  ] as QueryResult["nodes"];
  const labels = contextualLabels(nodes);
  expect(labels.get("a")).toContain("Inventory");
  expect(labels.get("b")).toContain("Enemy");
});
it("keys exact arrangements by topology, geometry and mode rather than analysis alone", () => {
  const view = projectGraph(result, true),
    a = arrangementKey("same", view, "network");
  expect(
    arrangementKey(
      "same",
      {
        ...view,
        nodes: view.nodes.toReversed(),
        edges: view.edges.toReversed(),
      },
      "network",
    ),
  ).toBe(a);
  expect(arrangementKey("same", focusGraph(view, "a"), "network")).not.toBe(a);
  expect(arrangementKey("same", view, "directional")).not.toBe(a);
  expect(
    arrangementKey(
      "same",
      {
        ...view,
        nodes: view.nodes.map((n, i) => (i ? n : { ...n, label: "changed" })),
      },
      "network",
    ),
  ).not.toBe(a);
});
it("rejects incomplete, duplicate, nonfinite and foreign worker geometry", () => {
  expect(validPositions(new Array(2), ["a", "b"])).toBe(false);
  expect(validPositions([{ id: "a", x: 0, y: 1 }], ["a"])).toBe(true);
  expect(validPositions([{ id: "a", x: NaN, y: 1 }], ["a"])).toBe(false);
  expect(validPositions([{ id: "a", x: 0, y: 1 }], ["a", "b"])).toBe(false);
  expect(
    validPositions(
      [
        { id: "a", x: 0, y: 1 },
        { id: "a", x: 2, y: 3 },
      ],
      ["a", "b"],
    ),
  ).toBe(false);
  expect(validPositions([{ id: "other", x: 0, y: 1 }], ["a"])).toBe(false);
});

it("distinguishes identical paths even when canonical field IDs share the same suffix", () => {
  const nodes = [
    "module-a:field:string:HitPoints",
    "module-b:field:string:HitPoints",
  ].map((id) => ({
    id,
    label: "HitPoints",
    kind: "field",
    contexts: ["unknown"],
    attributes: { path: "Workspace.Module.HitPoints" },
  })) as QueryResult["nodes"];
  expect(new Set(contextualLabels(nodes).values()).size).toBe(2);
});

it("keeps opaque generated-owner hashes out of contextual display labels", () => {
  const nodes = [1, 2].map((i) => ({
    id: `n${i}`,
    label: "Part",
    kind: "instance",
    contexts: ["unknown"],
    ownerId: `created:${"a".repeat(64)}:${i}`,
    attributes: {},
  })) as QueryResult["nodes"];
  const labels = [...contextualLabels(nodes).values()];
  expect(new Set(labels).size).toBe(2);
  for (const label of labels) {
    expect(label).not.toContain("a".repeat(24));
    expect(label.length).toBeLessThan(60);
  }
});
