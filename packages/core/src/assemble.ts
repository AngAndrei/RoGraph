import {
  validateGraph,
  type Snapshot,
  type Facts,
  type Resolution,
  type Graph,
  type Relation,
  type Evidence,
  type Site,
  type Node,
  type RelationType,
} from "../../contracts/src/model.js";
import { hash, canonical } from "./util.js";
import { resolveContexts } from "./execution-context.js";
export function assembleGraph(
  snapshot: Snapshot,
  facts: Facts[],
  resolutions: Resolution[],
): Graph {
  const merged: Resolution = {
    sites: [],
    nodes: [],
    relations: resolutions.flatMap((r) => r.relations),
    evidence: [],
    diagnostics: [],
  };
  const contexts = resolveContexts(snapshot, facts, merged);
  const nodes = new Map<string, Node>(),
    relations = new Map<string, Relation>(),
    evidence = new Map<string, Evidence>(),
    sites = new Map<string, Site>();
  for (const i of snapshot.instances)
    nodes.set(i.id, {
      id: i.id,
      kind: "instance",
      ownerId: i.parentId ?? undefined,
      label: i.name,
      contexts: contexts.get(i.id) ?? ["unknown"],
      attributes: {
        ...i,
        properties: Object.fromEntries(
          Object.entries(i.properties).filter(([key]) => key !== "Source"),
        ),
        scriptId: ["Script", "LocalScript", "ModuleScript"].includes(
          i.className,
        )
          ? i.id
          : undefined,
      },
    });
  for (const f of facts)
    for (const site of f.sites)
      sites.set(site.id, {
        ...site,
        reason: site.reason ?? "REFERENCE_NOT_RESOLVED",
        contexts: contexts.get(site.ownerId) ?? ["unknown"],
      });
  const sourceOwners = new Map(snapshot.sources.map((s) => [s.id, s.scriptId])),
    instanceById = new Map(snapshot.instances.map((i) => [i.id, i]));
  for (const pass of resolutions) {
    for (const n of pass.nodes) {
      const scriptId =
        sourceOwners.get(String(n.attributes.sourceId)) ??
        String(n.attributes.scriptId ?? n.ownerId);
      nodes.set(n.id, {
        ...n,
        attributes: {
          ...n.attributes,
          scriptClassName: instanceById.get(scriptId)?.className,
        },
      });
    }
    for (const r of pass.relations) relations.set(r.id, r);
    for (const e of pass.evidence) evidence.set(e.id, e);
    for (const s of pass.sites) sites.set(s.id, s);
  }
  const saved = (
    source: string,
    target: string,
    type: RelationType,
    locator: Partial<Evidence>,
    rule: string,
    status: Evidence["status"] = "saved",
  ) => {
    const id = "rel:" + hash([source, target, type].join("|"));
    relations.set(id, { id, source, target, type });
    const e = {
      id: `${id}:declaration:${locator.sourceId ?? locator.instanceId}:${locator.span?.startByte ?? locator.propertyName}`,
      relationId: id,
      rule,
      status,
      assumptions: [],
      contexts: contexts.get(source) ?? ["unknown"],
      ...locator,
    } as Evidence;
    evidence.set(e.id, e);
  };
  for (const i of snapshot.instances) {
    if (i.parentId)
      saved(
        i.parentId,
        i.id,
        "CONTAINS",
        { instanceId: i.id, propertyName: "$parent" },
        "saved-hierarchy",
      );
    for (const [key, p] of Object.entries(i.properties))
      if (p.type === "Ref" && typeof p.value === "string" && nodes.has(p.value))
        saved(
          i.id,
          p.value,
          "REFERENCES",
          { instanceId: i.id, propertyName: key },
          "serialized-reference",
        );
  }
  for (const n of [...nodes.values()])
    if (["function", "field"].includes(n.kind) && n.ownerId) {
      const a = n.attributes;
      if (a.sourceId && a.span)
        saved(
          n.ownerId,
          n.id,
          "DECLARES",
          { sourceId: String(a.sourceId), span: a.span as any },
          "source-declaration",
        );
      else if (a.instanceId && a.propertyName && a.initializerAvailable)
        saved(
          n.ownerId,
          n.id,
          "DECLARES",
          {
            instanceId: String(a.instanceId),
            propertyName: String(a.propertyName),
          },
          "saved-property",
        );
    }
  for (const s of sites.values())
    if (s.status === "unresolved" || s.status === "candidate") {
      const id = `unresolved:${s.id}`;
      nodes.set(id, {
        id,
        kind: "unresolved",
        ownerId: s.ownerId,
        label: s.reason ?? "Unresolved reference",
        contexts: s.contexts,
        attributes: {
          siteId: s.id,
          sourceId: s.sourceId,
          span: s.span,
          status: s.status,
          candidates: s.targetIds,
        },
      });
      saved(
        s.ownerId,
        id,
        "REFERENCES",
        { sourceId: s.sourceId, span: s.span, siteId: s.id },
        "unresolved-reference",
        s.status,
      );
    }
  const rawItems = new Map(
      snapshot.inventory.items.map((item) => [item.referent, item]),
    ),
    referents = new Set(snapshot.instances.map((i) => i.originalReferent));
  for (const i of snapshot.instances) {
    const raw = rawItems.get(i.originalReferent);
    for (const p of (raw?.properties ?? []) as any[])
      if (
        p.type === "Ref" &&
        p.text &&
        !["null", "nil"].includes(p.text) &&
        !referents.has(p.text)
      ) {
        const id = `unresolved:${i.id}:property:${p.name}`;
        nodes.set(id, {
          id,
          kind: "unresolved",
          ownerId: i.id,
          label: `Missing reference: ${p.name}`,
          contexts: ["unknown"],
          attributes: {
            instanceId: i.id,
            propertyName: p.name,
            originalReferent: p.text,
          },
        });
        saved(
          i.id,
          id,
          "REFERENCES",
          { instanceId: i.id, propertyName: p.name },
          "dangling-serialized-reference",
          "unresolved",
        );
      }
  }
  const allSites = [...sites.values()].sort((a, b) => a.id.localeCompare(b.id));
  const coverage = {
    ...snapshot.coverage,
    parsedScripts: facts.filter(
      (f) => !f.diagnostics.some((d) => d.code === "LUAU_PARSE_ERROR"),
    ).length,
    discoveredSites: allSites.length,
    resolvedSites: allSites.filter(
      (s) => s.status === "resolved" || s.status === "saved",
    ).length,
    candidateSites: allSites.filter((s) => s.status === "candidate").length,
    unresolvedSites: allSites.filter((s) => s.status === "unresolved").length,
    limitations: [...snapshot.coverage.limitations],
  };
  if (coverage.parsedScripts < coverage.discoveredScripts)
    coverage.limitations.push(
      `${coverage.discoveredScripts - coverage.parsedScripts} saved scripts have missing or invalid source; dependencies are incomplete.`,
    );
  if (coverage.unresolvedSites || coverage.candidateSites)
    coverage.limitations.push(
      "Unresolved and candidate references limit dependency/impact completeness; no modeled dependents is not proof of safety.",
    );
  const versions = {
    ...snapshot.versions,
    parser: String(facts[0]?.parserVersion ?? "none"),
    features: String(facts[0]?.featureHash ?? "none"),
    engine: "0.1.0",
    resolver: "2",
  };
  for (const source of snapshot.sources)
    if (hash(source.text) !== source.sha256)
      throw new Error("Source text/hash mismatch");
  const graph: Graph = {
    analysisId: hash(
      canonical({
        snapshotId: snapshot.snapshotId,
        versions,
        sources: snapshot.sources.map((s) => s.sha256),
        rojo: snapshot.inventory.rojo
          ? {
              ...(snapshot.inventory.rojo as any),
              outputHashes: {
                ...(snapshot.inventory.rojo as any).outputHashes,
                map: (snapshot.inventory.rojo as any).normalizedMapHash,
              },
            }
          : undefined,
      }),
    ),
    snapshotId: snapshot.snapshotId,
    versions,
    importManifest: { input: snapshot.input, inventory: snapshot.inventory },
    nodes: [...nodes.values()].sort((a, b) => a.id.localeCompare(b.id)),
    relations: [...relations.values()].sort((a, b) => a.id.localeCompare(b.id)),
    evidence: [...evidence.values()].sort((a, b) => a.id.localeCompare(b.id)),
    sites: allSites,
    sources: snapshot.sources,
    diagnostics: [
      ...snapshot.diagnostics,
      ...facts.flatMap((f) => f.diagnostics),
      ...resolutions.flatMap((r) => r.diagnostics),
    ],
    coverage,
  };
  return validateGraph(graph);
}
