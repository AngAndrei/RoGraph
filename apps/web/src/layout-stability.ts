import type { Point } from "./layout.js";

/** Rigid alignment keeps a previous mental map without treating every old node as a pin. */
export function stabilizeLayout(
  points: Point[],
  previous: Point[],
  pins: Point[],
  allowRotation = true,
): Point[] {
  const old = new Map(
    previous
      .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
      .map((p) => [p.id, p]),
  );
  const common = points.filter((p) => old.has(p.id));
  let result = points.map((p) => ({ ...p }));
  if (common.length) {
    const center = (ps: Point[]) => ({
      x: ps.reduce((s, p) => s + p.x, 0) / ps.length,
      y: ps.reduce((s, p) => s + p.y, 0) / ps.length,
    });
    const a = center(common),
      b = center(common.map((p) => old.get(p.id)!));
    let dot = 0,
      cross = 0;
    for (const p of common) {
      const q = old.get(p.id)!,
        x = p.x - a.x,
        y = p.y - a.y;
      dot += x * (q.x - b.x) + y * (q.y - b.y);
      cross += x * (q.y - b.y) - y * (q.x - b.x);
    }
    const angle = allowRotation ? Math.atan2(cross, dot) : 0,
      c = Math.cos(angle),
      s = Math.sin(angle);
    result = result.map((p) => ({
      id: p.id,
      x: (p.x - a.x) * c - (p.y - a.y) * s + b.x,
      y: (p.x - a.x) * s + (p.y - a.y) * c + b.y,
    }));
  }
  const fixed = new Map(
    pins
      .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
      .map((p) => [p.id, p]),
  );
  for (const p of result)
    if (fixed.has(p.id)) Object.assign(p, fixed.get(p.id));
  // Only manual constraints may alter relative geometry after alignment.
  if (fixed.size)
    for (let pass = 0; pass < 80; pass++) {
      let moved = false;
      for (let i = 0; i < result.length; i++)
        for (let j = i + 1; j < result.length; j++) {
          const a = result[i],
            b = result[j],
            af = fixed.has(a.id),
            bf = fixed.has(b.id);
          if (af && bf) continue;
          let dx = b.x - a.x,
            dy = b.y - a.y,
            d = Math.hypot(dx, dy);
          if (d >= 72) continue;
          if (d < 0.001) {
            dx = 1;
            dy = 0.5;
            d = Math.hypot(dx, dy);
          }
          const amount = (72 - d + 0.01) / (af || bf ? 1 : 2);
          if (!af) {
            a.x -= (dx / d) * amount;
            a.y -= (dy / d) * amount;
          }
          if (!bf) {
            b.x += (dx / d) * amount;
            b.y += (dy / d) * amount;
          }
          moved = true;
        }
      if (!moved) break;
    }
  return result;
}
