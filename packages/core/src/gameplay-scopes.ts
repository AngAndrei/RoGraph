import type { Facts, Resolution, Expr } from "../../contracts/src/model.js";
import type { FlowResolver } from "./flow-resolver.js";
export function gameplayScopes(
  facts: Facts[],
  passes: Resolution[],
  resolver: FlowResolver,
) {
  const edges = new Map<string, Set<string>>(),
    memo = new Map<string, { ownerIds: string[]; truncated: boolean }>();
  const add = (from: string, to: string) => {
    const set = edges.get(from) ?? new Set();
    set.add(to);
    edges.set(from, set);
  };
  for (const pass of passes)
    for (const r of pass.relations)
      if (r.type === "CALLS" && resolver.owners.has(r.target))
        add(r.source, r.target);
  for (const f of facts)
    for (const site of f.sites) {
      if (site.kind !== "call") continue;
      const e = site.expression,
        c = resolver.get(e.callee as Expr, f);
      if (
        c.kind === "intrinsic" &&
        ["task.spawn", "task.defer", "task.delay"].includes(c.path)
      ) {
        const callback = resolver.get(
          (e.args as Expr[])[c.path === "task.delay" ? 1 : 0],
          f,
        );
        if (callback.kind === "function") add(site.ownerId, callback.id!);
      }
    }
  return (id: string) => {
    if (memo.has(id)) return memo.get(id)!;
    const result = new Set([id]),
      queue = [id];
    let truncated = false;
    while (queue.length)
      for (const child of edges.get(queue.shift()!) ?? [])
        if (!result.has(child)) {
          if (result.size >= 256) {
            truncated = true;
            continue;
          }
          result.add(child);
          queue.push(child);
        }
    const values = { ownerIds: [...result], truncated };
    memo.set(id, values);
    return values;
  };
}
