import type {
  Resolution,
  Site,
  RelationType,
  Node,
} from "../../contracts/src/model.js";
import { hash } from "./util.js";
export const emptyResolution = (): Resolution => ({
  sites: [],
  nodes: [],
  relations: [],
  evidence: [],
  diagnostics: [],
});
export function mark(result: Resolution, site: Site, value: any) {
  const ids = value.ids ?? (value.id ? [value.id] : []);
  const known = [
    "instance",
    "module",
    "function",
    "field",
    "property",
    "external",
  ].includes(value.kind);
  const next: Site = {
    ...site,
    status: known ? "resolved" : ids.length ? "candidate" : "unresolved",
    targetIds: ids,
    reason: known ? undefined : (value.reason ?? "UNRESOLVED_REFERENCE"),
  };
  result.sites.push(next);
  return next;
}
export function emit(
  result: Resolution,
  source: string,
  target: string,
  type: RelationType,
  site: Site,
  rule: string,
  mechanism?: string,
) {
  const id = "rel:" + hash([source, target, type].join("|"));
  if (!result.relations.some((r) => r.id === id))
    result.relations.push({ id, source, target, type });
  result.evidence.push({
    id: `${site.id}:${id}`,
    relationId: id,
    siteId: site.id,
    sourceId: site.sourceId,
    span: site.span,
    rule,
    status: "resolved",
    assumptions: [
      "Based on the saved source and hierarchy; runtime execution is not established.",
      ...site.assumptions,
    ],
    mechanism,
    contexts: site.contexts,
  });
}
export function addNode(result: Resolution, node: Node) {
  if (!result.nodes.some((n) => n.id === node.id)) result.nodes.push(node);
}
