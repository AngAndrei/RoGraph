import type { Link, Point } from "./layout.js";
export type LayoutRequest = {
  requestId: string;
  nodes: string[];
  edges: Link[];
  intent: "network" | "directional";
  aspectRatio: number;
  previous?: Point[];
  pins?: Point[];
};
export type LayoutResponse =
  | {
      requestId: string;
      positions: Point[];
      engine: string;
      milliseconds: number;
      warnings: string[];
    }
  | { requestId: string; error: string };
export function validPositions(
  value: unknown,
  ids: string[],
): value is Point[] {
  if (!Array.isArray(value) || value.length !== ids.length) return false;
  const expected = new Set(ids),
    seen = new Set<string>();
  for (let i = 0; i < value.length; i++) {
    const p = value[i];
    if (
      !p ||
      typeof p.id !== "string" ||
      !expected.has(p.id) ||
      seen.has(p.id) ||
      !Number.isFinite(p.x) ||
      !Number.isFinite(p.y)
    )
      return false;
    seen.add(p.id);
  }
  return seen.size === expected.size;
}
