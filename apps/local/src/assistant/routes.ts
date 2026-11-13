import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import { z } from "zod";
import { chatRequestSchema } from "../../../../packages/contracts/src/assistant.js";
import type { WorkerStore } from "../../../../packages/core/src/worker-client.js";
import { answerRequest } from "../../../../packages/assistant/src/assistant.js";
import { createHistory } from "../../../../packages/assistant/src/history.js";
import { searchHelp, helpIdentity } from "../../../../packages/assistant/src/help.js";
import { projectRoot } from "../../../../packages/adapters/src/native.js";
import { createModelManager } from "./models.js";
import { LocalModelRuntime } from "./runtime.js";

export async function createAssistantRoutes(workspace: string, store: WorkerStore) {
  const models = await createModelManager({ root: process.env.ROGRAPH_MODELS ?? join(projectRoot, "models") });
  const runtime = new LocalModelRuntime(models);
  const history = await createHistory(join(workspace, "assistant"));
  const turns = new Map<string, { controller: AbortController; analysisId?: string; promise: Promise<unknown> }>();
  const scope = (id?: string) => id ?? "help";
  const status = async () => ({ catalog: models.catalog, ...(await models.status()), ...(await runtime.status()),
    hardware: await runtime.hardware(), helpIdentity });
  const send = (res: ServerResponse, value: unknown) => {
    if (res.destroyed) return;
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    res.end(JSON.stringify(value));
  };
  const idSchema = z.string().min(1).max(2048);
  return {
    async handle(req: IncomingMessage, res: ServerResponse, path: string, method: string, json: () => Promise<unknown>): Promise<boolean> {
      try {
      if (method === "GET" && path === "/api/assistant/status") { send(res, await status()); return true; }
      if (method === "GET" && path === "/api/help/features") {
        const params = new URL(req.url!, "http://localhost").searchParams;
        send(res, { features: searchHelp((params.get("q") ?? "").slice(0, 8000), 5), helpIdentity }); return true;
      }
      if (method === "POST" && path === "/api/assistant/models/install") {
        const body = z.object({ modelId: z.string().min(1).max(100) }).strict().parse(await json());
        await runtime.changed();
        send(res, models.install(body.modelId)); return true;
      }
      const download = /^\/api\/assistant\/models\/install\/([\w-]+)$/.exec(path);
      if (method === "DELETE" && download) { models.cancel(download[1]); send(res, { cancelled: true }); return true; }
      if (method === "POST" && path === "/api/assistant/settings") {
        const body = z.object({ modelId: z.string().min(1).max(100).optional(), backend: z.enum(["auto", "cpu", "gpu"]).optional() }).strict().parse(await json());
        await models.configure(body); await runtime.changed(); send(res, await status()); return true;
      }
      if (method === "GET" && path === "/api/chat/history") {
        const raw = new URL(req.url!, "http://localhost").searchParams.get("analysisId");
        const analysisId = raw ? idSchema.parse(raw) : undefined;
        if (analysisId) await store.query({ op: "coverage", analysisId });
        send(res, { turns: await history.list(scope(analysisId)) }); return true;
      }
      if (method === "DELETE" && path === "/api/chat/history") {
        const body = z.object({ analysisId: idSchema.optional() }).strict().parse(await json());
        await history.clear(scope(body.analysisId)); send(res, { deleted: true }); return true;
      }
      const turn = /^\/api\/chat\/turns\/([\w-]+)$/.exec(path);
      if (method === "DELETE" && turn) { turns.get(turn[1])?.controller.abort(); send(res, { cancelled: true }); return true; }
      if (method === "POST" && path === "/api/chat/turns") {
        const body = chatRequestSchema.extend({ requestId: z.string().regex(/^[\w-]{1,100}$/) }).strict().parse(await json());
        const { requestId, ...request } = body;
        if (turns.has(requestId)) throw Error("This request is already running.");
        if (turns.size >= 4) throw Error("Assistant queue is full. Wait for the active question.");
        const controller = new AbortController();
        const abort = () => { if (!res.writableEnded) controller.abort(); };
        res.once("close", abort);
        const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(120000)]);
        const promise = (async () => {
          // Canonical existence check makes deleted/stale snapshots fail before any model access.
          if (request.analysisId) await store.query({ op: "coverage", analysisId: request.analysisId }, signal);
          const selected = await models.status();
          const answer = await answerRequest(request, { query: (q, s) => store.query(q, s ?? signal), signal,
            interpret: selected.selectedId ? (message, context, s) => runtime.interpret(message, context, s ?? signal) : undefined });
          signal.throwIfAborted();
          await history.append(scope(request.analysisId), request.message, answer);
          send(res, answer);
        })();
        turns.set(requestId, { controller, analysisId: request.analysisId, promise });
        try { await promise; } finally { turns.delete(requestId); res.removeListener("close", abort); }
        return true;
      }
      return false;
      } catch (error) {
        if (error instanceof Error && !("code" in error) && error.name !== "ZodError") Object.assign(error, { code: "ASSISTANT_ERROR" });
        throw error;
      }
    },
    async deleteAnalysis(id: string) {
      const active = [...turns.values()].filter((t) => t.analysisId === id);
      for (const turn of active) turn.controller.abort();
      await Promise.allSettled(active.map((t) => t.promise));
      await history.clear(scope(id));
    },
    async close() {
      for (const turn of turns.values()) turn.controller.abort();
      await runtime.close(); await models.close();
      await Promise.allSettled([...turns.values()].map((t) => t.promise));
    },
  };
}
