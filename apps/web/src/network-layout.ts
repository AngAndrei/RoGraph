import {
  arrangeGraph,
  type LayoutOptions,
  type Link,
  type Point,
} from "./layout.js";
import { layoutCost, measureLayout } from "./layout-quality.js";
import { stabilizeLayout } from "./layout-stability.js";

export type NetworkOptions = {
  aspectRatio?: number;
  intent?: "network" | "directional";
  candidate?: "topology" | "fcose";
  previous?: Point[];
  pins?: Point[];
};

// Both providers run in the layout worker. Sigma remains the only renderer.
async function fcoseProvider() {
  const [{ default: cytoscape }, { default: fcose }] = await Promise.all([
    import("cytoscape"),
    import("cytoscape-fcose"),
  ]);
  cytoscape.use(fcose);
  return (
    ids: string[],
    links: Link[],
    weights: Map<string, number>,
    initial: Point[],
  ) => {
    const coordinates = new Map(initial.map((p) => [p.id, p]));
    const cy = cytoscape({
      headless: true,
      styleEnabled: true,
      elements: [
        ...ids.map((id) => ({
          data: {
            id,
            diameter: Math.min(180, 36 + Math.sqrt(weights.get(id) ?? 1) * 18),
          },
          position: coordinates.get(id),
        })),
        ...links.map((e, i) => ({
          data: { id: `edge-${i}`, source: e.source, target: e.target },
        })),
      ],
      style: [
        {
          selector: "node",
          style: { width: "data(diameter)", height: "data(diameter)" },
        },
      ],
    });
    try {
      cy.layout({
        name: "fcose",
        quality: "proof",
        randomize: false,
        animate: false,
        fit: false,
        packComponents: false,
        tile: false,
        numIter: 2500,
        idealEdgeLength: 100,
        nodeRepulsion: 9000,
        initialEnergyOnIncremental: 0.5,
      } as cytoscape.LayoutOptions).run();
      return ids.map((id) => ({ id, ...cy.getElementById(id).position() }));
    } finally {
      cy.destroy();
    }
  };
}

function complexCore(nodes: string[], edges: Link[]) {
  const adj = new Map(nodes.map((id) => [id, new Set<string>()]));
  for (const e of edges)
    if (e.source !== e.target && adj.has(e.source) && adj.has(e.target)) {
      adj.get(e.source)!.add(e.target);
      adj.get(e.target)!.add(e.source);
    }
  const queue = nodes.filter((id) => adj.get(id)!.size < 2);
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i];
    for (const n of adj.get(id)!) {
      adj.get(n)!.delete(id);
      if (adj.get(n)!.size === 1) queue.push(n);
    }
    adj.get(id)!.clear();
  }
  return [...adj.values()].some((ns) => ns.size > 2);
}

export async function optimizeGraph(
  nodes: string[],
  edges: Link[],
  options: NetworkOptions = {},
) {
  const opts: LayoutOptions = { aspectRatio: options.aspectRatio };
  let chosen: LayoutOptions = opts;
  const baseline = arrangeGraph(nodes, edges, {
    aspectRatio: options.aspectRatio,
  });
  let positions = baseline,
    engine = "topology",
    cost = layoutCost(baseline, edges);
  const warnings: string[] = [];
  const consider = (
    p: Point[],
    name: string,
    placement: LayoutOptions = chosen,
  ) => {
    if (
      p.length !== new Set(nodes).size ||
      p.some((n) => !Number.isFinite(n.x) || !Number.isFinite(n.y))
    )
      throw new Error("Invalid layout coordinates");
    const next = layoutCost(p, edges);
    if (next <= cost) {
      positions = p;
      cost = next;
      engine = name;
      chosen = placement;
    }
  };
  if (options.intent === "directional" && nodes.length) {
    const { default: ELK } = await import("elkjs/lib/elk.bundled.js");
    const ids = [...new Set(nodes)].sort(),
      allowed = new Set(ids);
    const links = edges
      .filter(
        (e) =>
          allowed.has(e.source) &&
          allowed.has(e.target) &&
          e.source !== e.target,
      )
      .toSorted((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    const graph = await new ELK().layout({
      id: "root",
      layoutOptions: {
        "elk.algorithm": "layered",
        "elk.direction": "RIGHT",
        "elk.edgeRouting": "STRAIGHT",
        "elk.spacing.nodeNode": "55",
        "elk.layered.spacing.nodeNodeBetweenLayers": "100",
        "elk.randomSeed": "1",
      },
      children: ids.map((id) => ({ id, width: 32, height: 32 })),
      edges: links.map((e, i) => ({
        id: `e${i}`,
        sources: [e.source],
        targets: [e.target],
      })),
    });
    positions = graph.children!.map((n) => ({
      id: n.id,
      x: n.x! + 16,
      y: -(n.y! + 16),
    }));
    engine = "layered";
  } else {
    if (edges.length < 200 && complexCore(nodes, edges)) {
      if (edges.some((e) => e.order)) {
        const placement: LayoutOptions = { ...opts, order: "evidence" };
        consider(arrangeGraph(nodes, edges, placement), "topology", placement);
      }
      consider(
        arrangeGraph(nodes, edges, { ...opts, polish: true }),
        "optimized-topology",
        { ...opts, polish: true },
      );
      for (const order of ["degree", "natural"] as const) {
        const placement = { ...opts, order, polish: true };
        consider(
          arrangeGraph(nodes, edges, placement),
          "optimized-topology",
          placement,
        );
      }
    }
    if (options.candidate !== "topology" && complexCore(nodes, edges)) {
      try {
        const coreLayout = await fcoseProvider();
        const placement = { ...opts, coreLayout, polish: edges.length < 200 };
        const candidate = arrangeGraph(nodes, edges, placement);
        if (options.candidate === "fcose") {
          positions = candidate;
          engine = "fcose";
          cost = layoutCost(candidate, edges);
          chosen = placement;
        } else consider(candidate, "fcose", placement);
      } catch (e) {
        warnings.push(
          "Alternative layout unavailable; retained topology layout.",
        );
      }
    }
    if (cost > 0 && !chosen.polish)
      consider(
        arrangeGraph(nodes, edges, { ...chosen, polish: true }),
        engine === "fcose" ? engine : "optimized-topology",
      );
  }
  if (options.previous?.length || options.pins?.length)
    positions = stabilizeLayout(
      positions,
      options.previous ?? [],
      options.pins ?? [],
      options.intent !== "directional",
    );
  return {
    positions,
    engine,
    metrics: measureLayout(positions, edges),
    warnings,
  };
}
