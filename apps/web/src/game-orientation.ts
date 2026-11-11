import type { QueryResult } from "../../../packages/contracts/src/query.js";
import type { Node, Relation } from "../../../packages/contracts/src/model.js";
import { scripts } from "./graph-projection.js";

// These are navigation suggestions from retained facts, not inferred game genres
// or claims about the order in which callbacks execute.
function meaningfulRelations(result: QueryResult) {
  const ids = new Set(result.nodes.map((n) => n.id));
  const seen = new Set<string>();
  return result.relations.filter((r) => {
    if (
      !r.gameplay ||
      r.type === "USES_OBJECT" ||
      r.source === r.target ||
      !ids.has(r.source) ||
      !ids.has(r.target) ||
      seen.has(r.id)
    )
      return false;
    seen.add(r.id);
    return true;
  });
}
export function relationshipSummary(result: QueryResult, nodeId: string) {
  const relations = meaningfulRelations(result);
  return {
    incoming: relations.filter((r) => r.target === nodeId),
    outgoing: relations.filter((r) => r.source === nodeId),
  };
}
const exampleOrder = [
  "SPAWNS",
  "CAN_INTERACT",
  "TRANSFERS",
  "MODIFIES",
  "TRIGGERS",
  "HAS_BEHAVIOR",
];
export function startingScripts(result: QueryResult) {
  const entries = new Map<
    string,
    {
      node: Node;
      triggers: number;
      neighbors: Set<string>;
      actions: Relation[];
    }
  >();
  for (const node of result.nodes) {
    if (scripts.includes(String(node.attributes.className)))
      entries.set(node.id, {
        node,
        triggers: 0,
        neighbors: new Set(),
        actions: [],
      });
  }
  for (const relation of meaningfulRelations(result)) {
    const source = entries.get(relation.source),
      target = entries.get(relation.target);
    if (source) {
      source.neighbors.add(relation.target);
      source.actions.push(relation);
    }
    if (target) {
      target.neighbors.add(relation.source);
      target.actions.push(relation);
      if (relation.type === "TRIGGERS" || relation.type === "CAN_INTERACT")
        target.triggers++;
    }
  }
  return [...entries.values()]
    .filter((e) => e.neighbors.size)
    .sort(
      (a, b) =>
        b.neighbors.size - a.neighbors.size ||
        b.triggers - a.triggers ||
        a.node.id.localeCompare(b.node.id),
    )
    .slice(0, 4)
    .map(({ node, triggers, neighbors, actions }) => {
      const relation = actions.sort((a, b) => {
        const rank = (r: Relation) => {
          const priority = exampleOrder.indexOf(r.type);
          return (
            (r.source === node.id ? 0 : 20) + (priority < 0 ? 10 : priority)
          );
        };
        return rank(a) - rank(b) || a.id.localeCompare(b.id);
      })[0];
      return {
        node,
        triggers,
        connectedObjects: neighbors.size,
        example: relation
          ? {
              fromId: relation.source,
              toId: relation.target,
              label: relation.gameplay!.label,
              conditional: relation.gameplay!.conditional,
            }
          : undefined,
      };
    });
}
