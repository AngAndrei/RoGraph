import { it, expect } from "vitest";
import { startServer } from "../apps/local/src/server.js";
import { withWorkspace } from "./support/workspace.js";

it("authenticates assistant routes and answers maintained help without model weights", async () => withWorkspace(async (dir) => {
  const app = await startServer({ workspacePath: dir });
  try {
    expect((await fetch(app.url + "/api/assistant/status")).status).toBe(403);
    const headers = { "X-RoGraph-Session": app.sessionToken, Origin: app.url, "Content-Type": "application/json" };
    const response = await fetch(app.url + "/api/chat/turns", { method: "POST", headers,
      body: JSON.stringify({ requestId: "help-1", mode: "help", message: "How do I find text inside a script?" }) });
    expect(response.status).toBe(200);
    const answer = await response.json() as any;
    expect(answer.cards.some((c: any) => c.feature?.id === "source-find")).toBe(true);
    expect(answer.modelUsed).toBe(false);
    const invalid = await fetch(app.url + "/api/assistant/settings", { method: "POST", headers, body: JSON.stringify({ modelId: "../../private" }) });
    expect(invalid.status).toBe(400);
    const history = await (await fetch(app.url + "/api/chat/history", { headers })).json() as any;
    expect(history.turns[0].message).toBe("How do I find text inside a script?");
  } finally { await app.close(); }
}));
