import { it, expect } from "vitest";
import { gameplayCase, object } from "./support.js";
import { FlowResolver } from "../../packages/core/src/flow-resolver.js";
import type { Expr } from "../../packages/contracts/src/model.js";
it("reuses hierarchy lookups instead of rescanning unrelated saved objects", async () => {
  const c = await gameplayCase({
    GameServer:
      'local e=game:GetService("ServerStorage").Egg; e:GetDescendants(); e:GetChildren(); e:FindFirstChildOfClass("Part")',
  });
  for (let i = 0; i < 5000; i++)
    c.snapshot.instances.push(
      object("decoration:" + i, "Decoration", "Part", "workspace"),
    );
  const resolver = new FlowResolver(c.snapshot, c.facts),
    f = c.facts[0];
  let visits = 0;
  const original = resolver.objects.values.bind(resolver.objects);
  resolver.objects.values = function* () {
    for (const o of original()) {
      visits++;
      yield o;
    }
    return undefined;
  };
  const calls = f.sites.filter(
    (s) =>
      s.kind === "call" &&
      ["GetDescendants", "GetChildren", "FindFirstChildOfClass"].includes(
        String(((s.expression.callee as Expr).key as Expr)?.value),
      ),
  );
  for (let i = 0; i < 20; i++)
    for (const site of calls) {
      const value = resolver.get(site.expression, f);
      expect(value.kind).not.toBe("unknown");
      expect(
        value.kind === "collection"
          ? value.values.map((v: any) => v.id)
          : [value.id],
      ).toEqual(["eggpart"]);
    }
  expect(visits).toBeLessThan(15000);
});
it("refreshes hierarchy lookup after a named source object is created", async () => {
  const c = await gameplayCase({
      GameServer:
        'workspace:GetChildren();local p=Instance.new("Part",workspace);p.Name="Gift"',
    }),
    f = c.facts[0],
    r = new FlowResolver(c.snapshot, c.facts);
  const children = f.sites.find(
    (s) =>
      s.kind === "call" &&
      ((s.expression.callee as Expr).key as Expr)?.value === "GetChildren",
  )!.expression;
  const constructor = f.sites.find(
    (s) =>
      s.kind === "call" &&
      ((s.expression.callee as Expr).key as Expr)?.value === "new",
  )!.expression;
  const before = r.get(children, f);
  const created = r.get(constructor, f);
  const after = r.get(children, f);
  expect(before.values.some((v: any) => v.id === created.id)).toBe(false);
  expect(after.values.some((v: any) => v.id === created.id)).toBe(true);
});
it("does not rebuild project execution contexts for every callback payload read", async () => {
  const c = await gameplayCase({
    GameServer:
      'game:GetService("ReplicatedStorage").HomeTeleportEvent.OnServerEvent:Connect(function(player,target)target:Destroy()end)',
  });
  for (let i = 0; i < 5000; i++)
    c.snapshot.instances.push(
      object("decoration:" + i, "Decoration", "Part", "workspace"),
    );
  let reads = 0;
  for (const item of c.snapshot.instances) {
    const props = item.properties;
    Object.defineProperty(item, "properties", {
      get() {
        reads++;
        return props;
      },
    });
  }
  const resolver = new FlowResolver(c.snapshot, c.facts),
    f = c.facts[0],
    binding = f.bindings.find((b) => b.name === "target")!;
  reads = 0;
  for (let i = 0; i < 20; i++)
    expect(
      resolver.get(
        {
          kind: "binding",
          bindingId: binding.id,
          span: f.symbols[0].span,
        } as Expr,
        f,
      ).kind,
    ).toBe("unknown");
  expect(reads).toBeLessThan(15000);
});
