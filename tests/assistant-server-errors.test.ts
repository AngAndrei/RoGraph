import { it, expect, vi } from "vitest";
import { startServer } from "../apps/local/src/server.js";
import { withWorkspace } from "./support/workspace.js";
vi.mock("../packages/assistant/src/assistant.js", async (original) => {
  const actual =
    await original<typeof import("../packages/assistant/src/assistant.js")>();
  return {
    ...actual,
    answerRequest: async (...args: Parameters<typeof actual.answerRequest>) => {
      if (args[0].message === "abort fixture")
        throw new DOMException("Question cancelled", "AbortError");
      if (args[0].message === "timeout fixture")
        throw new DOMException("Question timed out", "TimeoutError");
      if (args[0].message === "numeric fixture")
        throw Object.assign(new Error("Numeric native error"), { code: 42 });
      return actual.answerRequest(...args);
    },
  };
});
it("normalizes native abort/timeout error codes without crashing the server", async () =>
  withWorkspace(async (dir) => {
    const app = await startServer({ workspacePath: dir });
    try {
      const headers = {
        "X-RoGraph-Session": app.sessionToken,
        Origin: app.url,
        "Content-Type": "application/json",
      };
      for (const [id, message, code] of [
        ["a", "abort fixture", "CANCELLED"],
        ["t", "timeout fixture", "TIMEOUT"],
        ["n", "numeric fixture", "INTERNAL_ERROR"],
      ]) {
        const response = await fetch(app.url + "/api/chat/turns", {
          method: "POST",
          headers,
          body: JSON.stringify({ requestId: id, message }),
        });
        expect(response.status).toBe(code === "INTERNAL_ERROR" ? 500 : 400);
        expect(((await response.json()) as any).error.code).toBe(code);
      }
      const recovery = await fetch(app.url + "/api/chat/turns", {
        method: "POST",
        headers,
        body: JSON.stringify({ requestId: "recovery", message: "help" }),
      });
      expect(recovery.status).toBe(200);
      expect(((await recovery.json()) as any).cards.length).toBeGreaterThan(0);
    } finally {
      await app.close();
    }
  }));
