import type {
  Snapshot,
  Facts,
  Resolution,
  Context,
} from "../../contracts/src/model.js";
export function resolveContexts(
  snapshot: Snapshot,
  facts: Facts[],
  resolution: Resolution,
) {
  const map = new Map<string, Context[]>(),
    objects = new Map(snapshot.instances.map((i) => [i.id, i])),
    owners = new Map<string, string>();
  for (const f of facts) {
    owners.set(f.scriptId, f.scriptId);
    for (const s of f.symbols) owners.set(s.id, f.scriptId);
  }
  for (const i of snapshot.instances) {
    const disabled = i.properties.Disabled?.value === true;
    let context: Context = "unknown";
    if (!disabled) {
      if (i.className === "LocalScript") context = "client";
      if (i.className === "Script") {
        const raw = i.properties.RunContext?.value;
        const run = typeof raw === "object" && raw ? (raw as any).value : raw;
        if (run === 2) context = "client";
        else if (run === 1) context = "server";
        else {
          let parent = i.parentId;
          while (parent) {
            const p = objects.get(parent)!;
            if (["ServerScriptService", "Workspace"].includes(p.className)) {
              context = "server";
              break;
            }
            parent = p.parentId;
          }
        }
      }
    }
    map.set(i.id, context === "unknown" ? [] : [context]);
  }
  const edges = new Map<string, string[]>();
  for (const r of resolution.relations)
    if (r.type === "REQUIRES") {
      const from = owners.get(r.source) ?? r.source;
      edges.set(from, [...(edges.get(from) ?? []), r.target]);
    }
  const queue = [...map.keys()].filter((id) => map.get(id)!.length);
  while (queue.length) {
    const from = queue.shift()!;
    for (const to of edges.get(from) ?? []) {
      const before = map.get(to) ?? [],
        next = [...new Set([...before, ...map.get(from)!])];
      if (next.length !== before.length) {
        map.set(to, next);
        queue.push(to);
      }
    }
  }
  for (const [id, values] of map) if (!values.length) map.set(id, ["unknown"]);
  for (const [id, owner] of owners)
    if (id !== owner) map.set(id, map.get(owner) ?? ["unknown"]);
  return map;
}
