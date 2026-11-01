import Graph from "graphology";
import forceAtlas2 from "graphology-layout-forceatlas2";
type Point = { id: string; x: number; y: number };
export function arrangeGraph(
  nodes: string[],
  edges: { source: string; target: string }[],
): Point[] {
  const adjacency = new Map(nodes.map((id) => [id, new Set<string>()]));
  for (const e of edges)
    if (
      e.source !== e.target &&
      adjacency.has(e.source) &&
      adjacency.has(e.target)
    ) {
      adjacency.get(e.source)!.add(e.target);
      adjacency.get(e.target)!.add(e.source);
    }
  const seen = new Set<string>(),
    components: string[][] = [];
  for (const id of nodes) {
    if (seen.has(id)) continue;
    const component = [id];
    seen.add(id);
    for (let i = 0; i < component.length; i++)
      for (const next of adjacency.get(component[i])!)
        if (!seen.has(next)) {
          seen.add(next);
          component.push(next);
        }
    components.push(component);
  }
  const boxes = components
    .map((ids) => {
      const g = new Graph({ type: "undirected" }),
        columns = Math.ceil(Math.sqrt(ids.length));
      ids.forEach((id, i) =>
        g.addNode(id, {
          x: (i % columns) * 60,
          y: Math.floor(i / columns) * 60,
          size: 8,
        }),
      );
      for (const id of ids)
        for (const next of adjacency.get(id)!)
          if (!g.hasEdge(id, next)) g.addEdge(id, next);
      if (ids.length > 1)
        forceAtlas2.assign(g, {
          iterations: 240,
          settings: {
            gravity: 0.1,
            scalingRatio: 40,
            linLogMode: true,
            adjustSizes: true,
            barnesHutOptimize: ids.length > 100,
            slowDown: 5,
          },
        });
      const p = ids.map((id) => ({
        id,
        x: g.getNodeAttribute(id, "x") as number,
        y: g.getNodeAttribute(id, "y") as number,
      }));
      for (let pass = 0; pass < 120; pass++) {
        let moved = false;
        for (let i = 0; i < p.length; i++)
          for (let j = i + 1; j < p.length; j++) {
            let dx = p[j].x - p[i].x,
              dy = p[j].y - p[i].y;
            let d = Math.hypot(dx, dy);
            if (d >= 60) continue;
            if (d < 0.001) {
              dx = 1;
              dy = 0.5;
              d = Math.hypot(dx, dy);
            }
            const shift = (60 - d) / 2 + 0.01;
            p[i].x -= (dx / d) * shift;
            p[i].y -= (dy / d) * shift;
            p[j].x += (dx / d) * shift;
            p[j].y += (dy / d) * shift;
            moved = true;
          }
        if (!moved) break;
      }
      const minX = Math.min(...p.map((n) => n.x)),
        minY = Math.min(...p.map((n) => n.y));
      p.forEach((n) => {
        n.x -= minX;
        n.y -= minY;
      });
      return {
        points: p,
        width: Math.max(...p.map((n) => n.x)) + 100,
        height: Math.max(...p.map((n) => n.y)) + 100,
      };
    })
    .sort((a, b) => b.points.length - a.points.length);
  // Pack actual connected components; folder/service groups never compress positions.
  const rowWidth = Math.max(
    500,
    Math.sqrt(boxes.reduce((n, b) => n + b.width * b.height, 0)) * 1.4,
  );
  let x = 0,
    y = 0,
    rowHeight = 0;
  const output: Point[] = [];
  for (const box of boxes) {
    if (x > 0 && x + box.width > rowWidth) {
      x = 0;
      y += rowHeight;
      rowHeight = 0;
    }
    for (const p of box.points)
      output.push({ id: p.id, x: p.x + x, y: p.y + y });
    x += box.width;
    rowHeight = Math.max(rowHeight, box.height);
  }
  return output;
}
