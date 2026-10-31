import { it, expect } from "vitest";
import { request } from "node:http";
import { once } from "node:events";
import { join } from "node:path";
import { withWorkspace } from "./support/workspace.js";
import { startServer } from "../apps/local/src/server.js";
it("closes owned HTTP connections even when a client leaves its body unfinished", async () =>
  withWorkspace(async (directory) => {
    const app = await startServer({
      workspacePath: join(directory, "workspace"),
    });
    const req = request(app.url + "/api/query", {
      method: "POST",
      headers: {
        Origin: app.url,
        "X-RoGraph-Session": app.sessionToken,
        "Content-Type": "application/json",
        "Content-Length": "1000",
      },
    });
    req.on("error", () => {});
    req.write('{"op":');
    const socket = await once(req, "socket");
    if ((socket[0] as any).connecting) await once(socket[0], "connect");
    await new Promise((r) => setTimeout(r, 20));
    const closing = app.close();
    try {
      const closed = await Promise.race([
        closing.then(() => true),
        new Promise<boolean>((r) => setTimeout(() => r(false), 1000)),
      ]);
      expect(closed).toBe(true);
    } finally {
      req.destroy();
      await closing;
    }
  }));
