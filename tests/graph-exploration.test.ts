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

it("explains numeric saved names with class and hierarchy without changing object identity", () => {
  const node = {
    id: "slot9",
    kind: "instance",
    label: "9",
    contexts: ["unknown"],
    attributes: {
      name: "9",
      className: "ImageButton",
      labelAncestors: ["DataModel", "StarterGui", "Inventory", "Frame"],
    },
  } as QueryResult["nodes"][number];
  expect(contextualLabels([node]).get("slot9")).toBe(
    "ImageButton 9 · Inventory.Frame",
  );
  expect(node.label).toBe("9");
  expect(node.attributes.name).toBe("9");
  const part = {
    ...node,
    id: "leg",
    label: "2",
    attributes: {
      ...node.attributes,
      name: "2",
      className: "Part",
      labelAncestors: ["Workspace", "Dog", "Legs"],
    },
  };
  expect(contextualLabels([part]).get("leg")).toBe("Part 2 · Dog.Legs");
});

it("adds an asset parent to a saved limb and resolves runtime parent IDs", () => {
  const nodes = [
    {
      id: "dog",
      label: "Dog",
      kind: "instance",
      contexts: ["unknown"],
      attributes: { className: "Model" },
    },
    {
      id: "leg",
      label: "Leg",
      kind: "instance",
      contexts: ["unknown"],
      ownerId: "dog",
      attributes: { className: "Part" },
    },
    {
      id: "created",
      label: "Part",
      kind: "instance",
      contexts: ["unknown"],
      attributes: { className: "Part", runtimeDefined: true, parentId: "dog" },
    },
  ] as QueryResult["nodes"];
  const labels = contextualLabels(nodes);
  expect(labels.get("leg")).toBe("Leg · Dog");
  expect(labels.get("created")).toBe("Part · Dog");
});

it("retains a real ancestor even when the child has the same name", () => {
  const nodes = [
    {
      id: "child",
      kind: "instance",
      label: "Dog",
      contexts: ["unknown"],
      attributes: {
        className: "Part",
        parentClassName: "Model",
        labelAncestors: ["Game", "Workspace", "Dog"],
      },
    },
  ] as QueryResult["nodes"];
  expect(contextualLabels(nodes).get("child")).toBe("Dog · Dog");
});

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

it("uses meaningful context without numbering nodes with identical paths", () => {
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
  expect([...contextualLabels(nodes).values()]).toEqual([
    "HitPoints · Module",
    "HitPoints · Module",
  ]);
});

it("omits generated owner IDs and numeric path segments from display labels", () => {
  const nodes = [1, 2].map((i) => ({
    id: `n${i}`,
    label: "Part",
    kind: "instance",
    contexts: ["unknown"],
    ownerId: i === 1 ? `created:${"a".repeat(64)}:${i}` : "place/1069",
    attributes: i === 1 ? {} : { path: "Workspace.Human.1069.Part" },
  })) as QueryResult["nodes"];
  const labels = [...contextualLabels(nodes).values()];
  expect(labels).toEqual(["Part", "Part · Human"]);
});
