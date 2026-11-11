import { it, expect } from "vitest";
import { join } from "node:path";
import { gameplayGraph } from "./graph.js";
import { withWorkspace } from "../support/workspace.js";
import { openStore } from "../../packages/core/src/store.js";
import { createQueryEngine } from "../../packages/core/src/query.js";
import { retainedCreationBinding } from "../../packages/core/src/creation-labels.js";

it("uses global and static member names, but never names an inner allocation after a different returned value", async () => {
  const g = await gameplayGraph({
    Combat: `punchAnim = Instance.new("Animation")
    local effects = {}; effects.hitSound = Instance.new("Sound")
    local clone = Instance.new("Part"):Clone()`,
  });
  const nodes = g.nodes.filter((n) => n.attributes.runtimeDefined);
  expect(nodes.map((n) => n.label).sort()).toEqual([
    "Part",
    "hitSound",
    "punchAnim",
  ]);
});

it("preserves names through parentheses and type assertions without duplicating allocations", async () => {
  const g = await gameplayGraph({
    Combat: `local a = (Instance.new("Animation"))
    local b = Instance.new("Animation") :: Animation
    a.Parent = workspace; b.Parent = workspace`,
  });
  expect(
    g.nodes
      .filter((n) => n.attributes.runtimeDefined)
      .map((n) => n.label)
      .sort(),
  ).toEqual(["a", "b"]);
});

it("only recovers direct retained-source assignments, with no dynamic-slot or derived-value guesses", () => {
  for (const [code, expected] of [
    ['local punchAnim = Instance.new("Animation")', "punchAnim"],
    ['punchAnim = Instance.new("Animation")', "punchAnim"],
    ['effects.hitSound = Instance.new("Sound")', "hitSound"],
    ['effects["hitSound"] = Instance.new("Sound")', "hitSound"],
    ['local punchAnim = Instance.new("Animation") -- plays punch', "punchAnim"],
    ['local new = Instance.new; local punch = new("Animation")', "punch"],
    ['animTable[name][idx].anim = Instance.new("Animation")', undefined],
    ['local cloned = Instance.new("Animation"):Clone()', undefined],
    ['local name = Instance.new("Animation").Name', undefined],
    ['local exists = Instance.new("Animation") ~= nil', undefined],
    ['local exists = Instance.new("Animation") == nil', undefined],
    ['local exists = Instance.new("Animation") < 2', undefined],
    ['local a,b = Instance.new("Animation")', undefined],
  ] as const) {
    const source = Buffer.from(code),
      startByte = code.lastIndexOf(
        code.includes("punch = new") ? "new(" : "Instance.new(",
      );
    const endByte = code.indexOf(")", startByte) + 1;
    expect(retainedCreationBinding(source, { startByte, endByte }), code).toBe(
      expected,
    );
  }
});

it("labels source-created instances by bindings, retaining their actual class and name", async () => {
  const g = await gameplayGraph({
    Combat: `local punchAnim = Instance.new("Animation")
    local sound; sound = Instance.new("Sound")
    local named = Instance.new("Part"); named.Name = "Paw"
    local animTable = {}; local name = "idle"; local idx = 1
    animTable[name] = {}; animTable[name][idx] = {}; animTable[name][idx].anim = Instance.new("Animation")`,
  });
  const created = g.nodes.filter((n) => n.attributes.runtimeDefined);
  expect(
    created.find((n) => n.attributes.bindingName === "punchAnim"),
  ).toMatchObject({
    label: "punchAnim",
    attributes: { className: "Animation", name: "Animation" },
  });
  expect(created.find((n) => n.attributes.bindingName === "sound")?.label).toBe(
    "sound",
  );
  expect(created.find((n) => n.attributes.name === "Paw")?.label).toBe("Paw");
  expect(
    created
      .filter((n) => n.attributes.className === "Animation")
      .map((n) => n.label)
      .sort(),
  ).toEqual(["Animation", "punchAnim"]);
});

it("upgrades labels on existing snapshots from retained UTF-8 source without rewriting the snapshot", async () =>
  withWorkspace(async (dir) => {
    const g = await gameplayGraph({
      Combat: '-- 🐕\nlocal punchAnim = Instance.new("Animation")',
    });
    const node = g.nodes.find((n) => n.attributes.runtimeDefined)!;
    node.label = "Animation";
    delete node.attributes.bindingName;
    const store = await openStore(join(dir, "graph.db"));
    try {
      await store.save(g);
      const result = await createQueryEngine(store).run({
        op: "inspect",
        view: "gameplay",
        analysisId: g.analysisId,
        nodeId: node.id,
      });
      expect(result.nodes.find((n) => n.id === node.id)).toMatchObject({
        label: "punchAnim",
        attributes: { className: "Animation", name: "Animation" },
      });
      expect(
        (await store.readGraph(g.analysisId)).nodes.find(
          (n) => n.id === node.id,
        )?.label,
      ).toBe("Animation");
    } finally {
      await store.close();
    }
  }));

it("keeps useful parent context when the parent is outside the returned graph", async () =>
  withWorkspace(async (dir) => {
    const g = await gameplayGraph({
      Combat: "print(workspace.Chicken.HumanoidRootPart)",
    });
    const store = await openStore(join(dir, "graph.db"));
    try {
      await store.save(g);
      const r = await createQueryEngine(store).run({
        analysisId: g.analysisId,
        op: "overview",
        view: "code",
        classes: ["Part"],
      });
      expect(r.nodes.some((n) => n.id === "chicken")).toBe(false);
      const part = r.nodes.find((n) => n.id === "part")!;
      expect(part.attributes.parentClassName).toBe("Model");
      expect(part.attributes.labelAncestors).toEqual(
        expect.arrayContaining(["Chicken"]),
      );
    } finally {
      await store.close();
    }
  }));
