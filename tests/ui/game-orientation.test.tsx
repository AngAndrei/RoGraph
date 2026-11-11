// @vitest-environment jsdom
import { it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { QueryResult } from "../../packages/contracts/src/query.js";
import {
  GameOrientation,
  BehaviorSummary,
} from "../../apps/web/src/GameOrientation.js";
afterEach(cleanup);
const r: QueryResult = {
  analysisId: "a",
  nodes: [
    {
      id: "button",
      label: "Buy",
      kind: "instance",
      contexts: ["client"],
      attributes: { className: "TextButton" },
    },
    {
      id: "controller",
      label: "ShopClient",
      kind: "instance",
      contexts: ["client"],
      attributes: { className: "LocalScript" },
    },
  ],
  relations: [
    {
      id: "click",
      source: "button",
      target: "controller",
      type: "TRIGGERS",
      gameplay: { label: "Activated → handler", conditional: true } as any,
    },
  ],
  evidence: [],
  sites: [],
  sources: [],
  diagnostics: [],
  paths: [],
  groups: [],
  coverage: {} as any,
  meta: { truncated: false, omittedCounts: {}, limits: {} },
};
it("shows an incoming-only example in the real direction and selects its controller", async () => {
  const select = vi.fn();
  render(<GameOrientation result={r} onSelect={select} />);
  const entry = screen.getByRole("button", { name: "Inspect ShopClient" });
  expect(entry.textContent).toContain(
    "Buy → Activated → handler (conditional) → ShopClient",
  );
  await userEvent.click(entry);
  expect(select).toHaveBeenCalledWith("controller");
});
it("offers a text path from an incoming connection to the triggering object", async () => {
  const select = vi.fn();
  render(<BehaviorSummary result={r} nodeId="controller" onSelect={select} />);
  expect(screen.getByText(/Incoming connections/)).toBeTruthy();
  expect(screen.queryByText("Outgoing effects")).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: /Buy.*Activated/ }));
  expect(select).toHaveBeenCalledWith("button");
});
it("uses retained execution context instead of assuming every Script runs on the server", () => {
  const client = {
    ...r,
    nodes: r.nodes.map((n) =>
      n.id === "controller" ? { ...n, attributes: { className: "Script" } } : n,
    ),
  };
  const { rerender } = render(
    <GameOrientation result={client} onSelect={() => {}} />,
  );
  expect(
    screen.getByRole("button", { name: "Inspect ShopClient" }).textContent,
  ).toContain("Script · client context");
  rerender(
    <GameOrientation
      result={{
        ...client,
        nodes: client.nodes.map((n) => ({ ...n, contexts: ["unknown"] })),
      }}
      onSelect={() => {}}
    />,
  );
  expect(
    screen.getByRole("button", { name: "Inspect ShopClient" }).textContent,
  ).toContain("Script · unknown context");
});
