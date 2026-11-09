// @vitest-environment jsdom
import { it, expect } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { Inspector } from "../../apps/web/src/Inspector.js";
import type { QueryResult } from "../../packages/contracts/src/query.js";
it("shows the class and inventory context of a numbered button along with its real saved name", () => {
  const r = {
    analysisId: "numeric",
    nodes: [
      {
        id: "slot",
        kind: "instance",
        label: "9",
        contexts: ["unknown"],
        attributes: {
          name: "9",
          className: "ImageButton",
          labelAncestors: ["DataModel", "StarterGui", "Inventory", "Frame"],
        },
      },
    ],
    relations: [],
    evidence: [],
    sites: [],
    sources: [],
    meta: { truncated: false, limits: {}, omittedCounts: {} },
  } as unknown as QueryResult;
  try {
    render(
      <Inspector
        result={r}
        selectedId="slot"
        onSelect={() => {}}
        onExplore={() => {}}
      />,
    );
    expect(
      screen.getByRole("heading", { name: "ImageButton 9 · Inventory.Frame" }),
    ).toBeTruthy();
    expect(
      screen.getByText("DataModel / StarterGui / Inventory / Frame / 9"),
    ).toBeTruthy();
    expect(screen.getByText(/Saved name:/)).toBeTruthy();
  } finally {
    cleanup();
  }
});

it("marks incomplete ancestry and still shows the saved identity of a root object", () => {
  const node = {
    id: "deep",
    kind: "instance",
    label: "9",
    contexts: ["unknown"],
    attributes: {
      name: "9",
      className: "ImageButton",
      labelAncestors: ["Inventory", "Frame"],
      labelAncestorsTruncated: true,
    },
  };
  const result = {
    analysisId: "a",
    nodes: [node],
    relations: [],
    evidence: [],
    sites: [],
    sources: [],
    meta: { truncated: false, limits: {}, omittedCounts: {} },
  } as unknown as QueryResult;
  try {
    const { rerender } = render(
      <Inspector
        result={result}
        selectedId="deep"
        onSelect={() => {}}
        onExplore={() => {}}
      />,
    );
    expect(screen.getByText("… / Inventory / Frame / 9")).toBeTruthy();
    rerender(
      <Inspector
        result={{
          ...result,
          nodes: [
            {
              ...node,
              id: "root",
              label: "Game",
              attributes: { name: "Game", className: "DataModel" },
            },
          ] as QueryResult["nodes"],
        }}
        selectedId="root"
        onSelect={() => {}}
        onExplore={() => {}}
      />,
    );
    expect(screen.getByText(/Saved name:/)).toBeTruthy();
  } finally {
    cleanup();
  }
});
it("labels saved initializers and unknowns without claiming runtime state", () => {
  const node = {
    id: "price",
    kind: "field" as const,
    label: "ShopConfig.Prices.Sword",
    ownerId: "config",
    contexts: ["server" as const],
    attributes: {
      initializer: 100,
      initializerAvailable: true,
      initializerMeaning:
        "Saved value or literal initializer; runtime value may change.",
    },
  };
  const r = {
    analysisId: "snapshot",
    nodes: [node],
    relations: [],
    evidence: [],
    sites: [
      {
        id: "unknown",
        reason: "DYNAMIC_CONFIG_KEY",
        status: "unresolved",
        sourceId: "s",
        span: {
          startByte: 0,
          endByte: 1,
          startLine: 1,
          startColumn: 1,
          endLine: 1,
          endColumn: 2,
        },
      },
    ],
    sources: [],
    meta: { truncated: false, limits: {}, omittedCounts: {} },
  } as unknown as QueryResult;
  try {
    render(
      <Inspector
        result={r}
        selectedId="price"
        onSelect={() => {}}
        onExplore={() => {}}
      />,
    );
    expect(screen.getByText("Saved value / literal initializer")).toBeTruthy();
    expect(screen.getByText("DYNAMIC_CONFIG_KEY")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Impact" })).toBeTruthy();
  } finally {
    cleanup();
  }
});
