import { optimizeGraph } from "./network-layout.js";
import type { LayoutRequest, LayoutResponse } from "./layout-protocol.js";
const scope = self as any;
scope.onmessage = async (event: MessageEvent<LayoutRequest>) => {
  const request = event.data,
    start = performance.now();
  let response: LayoutResponse;
  try {
    const result = await optimizeGraph(request.nodes, request.edges, {
      intent: request.intent,
      aspectRatio: request.aspectRatio,
      previous: request.previous,
      pins: request.pins,
    });
    response = {
      requestId: request.requestId,
      positions: result.positions,
      engine: result.engine,
      milliseconds: performance.now() - start,
      warnings: result.warnings,
    };
  } catch (e) {
    response = {
      requestId: request.requestId,
      error: e instanceof Error ? e.message : "Graph layout failed",
    };
  }
  scope.postMessage(response);
};
