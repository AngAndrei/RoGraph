import { arrangeGraph } from "./layout.js";
const scope = self as any;
scope.onmessage = (event: MessageEvent) =>
  scope.postMessage(arrangeGraph(event.data.nodes, event.data.edges));
