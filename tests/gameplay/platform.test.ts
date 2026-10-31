import { it, expect } from "vitest";
import { gameplayCase } from "./support.js";
import { Resolver } from "../../packages/core/src/resolver.js";
import { resolveCalls } from "../../packages/core/src/resolve-calls.js";
import { resolveInstances } from "../../packages/core/src/resolve-instances.js";
it("recognizes platform calls without inventing missing project packages", async () => {
  const c = await gameplayCase({
    ChickenController:
      "task.spawn(function() task.wait(math.random(1, 3)); local p=CFrame.new(0,0,0) end)",
  });
  const r = resolveCalls(
    c.snapshot,
    c.facts,
    resolveInstances(c.snapshot, c.facts),
  );
  expect(
    r.sites
      .filter((s) => s.kind === "call")
      .every((s) => s.status === "resolved"),
  ).toBe(true);
  expect(
    r.nodes.some((n) => n.kind === "unresolved" || n.label.includes("math")),
  ).toBe(false);
});
it("preserves Luau fallback truthiness and the saved Workspace identity", async () => {
  const c = await gameplayCase({
    ChickenController:
      'local a=false or "Standard";local b=0 or "Other";local w=workspace',
  });
  const r = new Resolver(c.snapshot, c.facts),
    f = c.facts[0];
  expect(
    r.get(f.bindings.find((b) => b.name === "a")!.initializer, f).value,
  ).toBe("Standard");
  expect(
    r.get(f.bindings.find((b) => b.name === "b")!.initializer, f).value,
  ).toBe(0);
  expect(r.get(f.bindings.find((b) => b.name === "w")!.initializer, f).id).toBe(
    "workspace",
  );
});
it.each([
  "local math={};math.random()",
  "math={};math.random()",
  "math.random=function() end;math.random()",
])(
  "does not classify shadowed or overwritten library calls as intrinsics: %s",
  async (text) => {
    const c = await gameplayCase({ ChickenController: text });
    const r = resolveCalls(
      c.snapshot,
      c.facts,
      resolveInstances(c.snapshot, c.facts),
    );
    expect(r.sites.some((s) => s.reason === "KNOWN_PLATFORM_OPERATION")).toBe(
      false,
    );
    expect(r.evidence.some((e) => e.rule === "platform-intrinsic")).toBe(false);
  },
);
