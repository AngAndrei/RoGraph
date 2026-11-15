import { expect, it, vi } from "vitest";
const { solve } = vi.hoisted(() => ({ solve: vi.fn() }));
vi.mock("elkjs/lib/elk.bundled.js", () => ({
  default: class {
    layout = solve;
  },
}));
import { arrangeInitialGraph } from "../apps/web/src/initial-layout.js";
import { validPositions } from "../apps/web/src/layout-protocol.js";

for (const failure of ["unavailable", "invalid coordinates"])
  it(`retains complete connected topology when stress is ${failure}`, async () => {
    const nodes = Array.from({ length: 10 }, (_, i) => `n${i}`);
    const edges = nodes.flatMap((source, i) =>
      [1, 3].map((step) => ({
        source,
        target: nodes[(i + step) % nodes.length],
      })),
    );
    solve.mockReset();
    if (failure === "unavailable")
      solve.mockRejectedValue(new Error("Offline"));
    else solve.mockResolvedValue({ children: [{ id: "n0", x: NaN, y: 0 }] });
    const result = await arrangeInitialGraph(nodes, edges);
    expect(solve).toHaveBeenCalled();
    expect(validPositions(result.positions, nodes)).toBe(true);
    expect(result.engine).toBe("component-topology");
    expect(result.warnings).toHaveLength(1);
  });
