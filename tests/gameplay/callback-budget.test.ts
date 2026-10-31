import { it, expect } from "vitest";
import { gameplayCase } from "./support.js";
import { FlowResolver } from "../../packages/core/src/flow-resolver.js";
import type { Expr, Facts } from "../../packages/contracts/src/model.js";
import type { Value } from "../../packages/core/src/resolver.js";
it("does not recursively analyze unrelated callback parameters to find a caller", async () => {
  const callbacks = Array.from(
    { length: 8 },
    (_, i) =>
      `remote.OnServerEvent:Connect(function(player${i}) player${i}.Character:PivotTo(CFrame.new(0,0,0)) end)`,
  ).join("\n");
  const c = await gameplayCase({
    GameServer:
      'local remote=game:GetService("ReplicatedStorage").HomeTeleportEvent\n' +
      callbacks,
  });
  let calls = 0;
  class Counted extends FlowResolver {
    override get(e: Expr | undefined, f: Facts, seen?: Set<string>): Value {
      if (++calls > 3000) throw new Error("Unbounded unrelated callback scan");
      return super.get(e, f, seen);
    }
  }
  const r = new Counted(c.snapshot, c.facts),
    f = c.facts[0],
    parameter = f.bindings.find((b) => b.name === "player0")!;
  const value = r.get(
    { kind: "binding", bindingId: parameter.id, span: f.symbols[0].span },
    f,
  );
  expect(r.anchorIds(value)).toContain("players");
  expect(calls).toBeLessThan(3000);
});
