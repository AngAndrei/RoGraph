// @vitest-environment jsdom
import { it, expect, vi } from "vitest";
vi.mock("sigma", () => ({ default: class {} }));
vi.mock("sigma/rendering", () => ({ extremityArrow: {} }));
vi.mock("sigma/types", () => ({ DEFAULT_PRIMITIVES: {}, DEFAULT_STYLES: {} }));
import { projectGraph } from "../../apps/web/src/GraphView.js";
import type { QueryResult } from "../../packages/contracts/src/query.js";
it("projects deterministic groups and lets the viewer focus one group", () => {
  const script = (id: string) => ({
    id,
    kind: "instance",
    label: id,
    contexts: ["server"],
    attributes: { className: "Script" },
  });
  const r = {
    nodes: [script("a"), script("b")],
    relations: [{ id: "ab", source: "a", target: "b", type: "REQUIRES" }],
    groups: [
      { id: "service1", label: "Service1", nodeIds: ["a"] },
      { id: "service2", label: "Service2", nodeIds: ["b"] },
    ],
  } as unknown as QueryResult;
  const all = projectGraph(r, false);
  expect((all as any).groups).toEqual(r.groups);
  const focused = (projectGraph as any)(r, false, "service2");
  expect(focused.nodes.map((n: any) => n.id)).toEqual(["b"]);
  expect(focused.edges).toHaveLength(0);
});
