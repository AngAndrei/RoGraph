import Graph from "graphology";
import forceAtlas2 from "graphology-layout-forceatlas2";
const scope = self as any;
scope.onmessage = (event: MessageEvent) => {
  const { nodes, edges, groups = [] } = event.data,
    g = new Graph({ multi: true, type: "directed" });
  nodes.forEach((id: string, i: number) =>
    g.addNode(id, {
      x: Math.cos(i * 2.399) * Math.sqrt(i + 1),
      y: Math.sin(i * 2.399) * Math.sqrt(i + 1),
    }),
  );
  for (const e of edges)
    if (g.hasNode(e.source) && g.hasNode(e.target) && e.source !== e.target)
      g.addEdge(e.source, e.target);
  if (g.order > 1)
    forceAtlas2.assign(g, {
      iterations: 100,
      settings: {
        gravity: 0.8,
        scalingRatio: 10,
        barnesHutOptimize: g.order > 100,
        slowDown: 4,
      },
    });
  const activeGroups = groups
    .map((group: any) => ({
      ...group,
      nodeIds: group.nodeIds.filter((id: string) => g.hasNode(id)),
    }))
    .filter((group: any) => group.nodeIds.length);
  if (activeGroups.length > 1)
    activeGroups.forEach((group: any, index: number) => {
      const points = group.nodeIds.map((id: string) => ({
        id,
        x: g.getNodeAttribute(id, "x") as number,
        y: g.getNodeAttribute(id, "y") as number,
      }));
      const center = {
        x: points.reduce((n: number, p: any) => n + p.x, 0) / points.length,
        y: points.reduce((n: number, p: any) => n + p.y, 0) / points.length,
      };
      const radius = Math.max(
        1,
        ...points.map((p: any) => Math.hypot(p.x - center.x, p.y - center.y)),
      );
      const angle = (index * Math.PI * 2) / activeGroups.length,
        distance = 30 + activeGroups.length * 6;
      for (const point of points)
        g.mergeNodeAttributes(point.id, {
          x: Math.cos(angle) * distance + ((point.x - center.x) / radius) * 12,
          y: Math.sin(angle) * distance + ((point.y - center.y) / radius) * 12,
        });
    });
  scope.postMessage(
    g.nodes().map((id) => ({
      id,
      x: g.getNodeAttribute(id, "x"),
      y: g.getNodeAttribute(id, "y"),
    })),
  );
};
