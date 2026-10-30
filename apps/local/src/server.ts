import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, stat, rm } from "node:fs/promises";
import { createWriteStream, createReadStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import { join, resolve, basename, extname, relative, sep } from "node:path";
import { z } from "zod";
import { openWorkerStore } from "../../../packages/core/src/worker-client.js";
import { createContext } from "../../../packages/core/src/context.js";
import { RoGraphError } from "../../../packages/core/src/util.js";
import { querySchema } from "../../../packages/core/src/query.js";
import { projectRoot } from "../../../packages/adapters/src/native.js";
import { createJobs } from "./jobs.js";
import { watchProject } from "../../../packages/core/src/watch.js";
const json = async (req: IncomingMessage) => {
  let bytes = 0;
  const chunks: Buffer[] = [];
  if (!req.headers["content-type"]?.startsWith("application/json"))
    throw new RoGraphError("INVALID_REQUEST", "Expected JSON");
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > 1024 * 1024)
      throw new RoGraphError("BODY_LIMIT", "Request is too large");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new RoGraphError("INVALID_REQUEST", "Invalid JSON");
  }
};
export async function startServer(
  input: string | { workspacePath: string; port?: number; staticDir?: string },
): Promise<{ url: string; sessionToken: string; close: () => Promise<void> }> {
  const options = typeof input === "string" ? { workspacePath: input } : input,
    workspace = resolve(options.workspacePath),
    staticDir = resolve(options.staticDir ?? join(projectRoot, "dist", "web"));
  await mkdir(workspace, { recursive: true });
  const store = await openWorkerStore(join(workspace, "graph.db")),
    jobs = createJobs(store, workspace),
    sessionToken = randomBytes(32).toString("hex");
  let url = "",
    closing = false,
    uploading = false;
  const send = (res: ServerResponse, status: number, value: unknown) => {
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end(JSON.stringify(value));
  };
  let watchController: AbortController | undefined,
    watchPromise: Promise<void> | undefined,
    watchPath: string | undefined,
    watchError: string | undefined,
    watchJob: string | undefined;
  const stopWatch = async () => {
    watchController?.abort();
    await watchPromise;
    watchController = undefined;
  };
  const startWatch = async (projectPath: string) => {
    await stopWatch();
    const controller = new AbortController();
    watchController = controller;
    watchPath = projectPath;
    watchError = undefined;
    watchPromise = watchProject(
      projectPath,
      async (input) => {
        await jobs.idle();
        if (controller.signal.aborted) return;
        const job = jobs.start(input, basename(projectPath));
        watchJob = job.id;
        const cancel = () => jobs.cancel(job.id);
        controller.signal.addEventListener("abort", cancel, { once: true });
        try {
          await jobs.wait(job.id);
          watchError = jobs.get(job.id).error?.message;
        } finally {
          controller.signal.removeEventListener("abort", cancel);
        }
      },
      controller.signal,
      [workspace],
    ).catch((e) => {
      watchError = e.message;
    });
  };
  const server = createServer(async (req, res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; worker-src 'self' blob:; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    );
    try {
      if (req.headers.host !== new URL(url).host)
        throw new RoGraphError("FORBIDDEN", "Unrecognized local host");
      const target = new URL(req.url ?? "/", url),
        path = target.pathname,
        method = req.method ?? "GET";
      if (path.startsWith("/api/")) {
        const token = Buffer.from(
          String(req.headers["x-rograph-session"] ?? ""),
        );
        if (
          token.length !== 64 ||
          !timingSafeEqual(token, Buffer.from(sessionToken)) ||
          (req.headers.origin && req.headers.origin !== url) ||
          (method !== "GET" && req.headers.origin !== url)
        )
          throw new RoGraphError(
            "FORBIDDEN",
            "A same-origin local session is required",
          );
        if (closing) throw new RoGraphError("CLOSING", "RoGraph is stopping");
        if (method === "GET" && path === "/api/workspace") {
          const list = await store.listAnalyses(100);
          send(res, 200, {
            current: await store.current(),
            analyses: list.items,
            nextCursor: list.nextCursor,
            watch: {
              enabled: Boolean(
                watchController && !watchController.signal.aborted,
              ),
              projectPath: watchPath,
              error: watchError,
              jobId: watchJob,
            },
            capabilities: { runtimeCapture: false, rojo: true },
          });
          return;
        }
        if (method === "POST" && path === "/api/imports") {
          if (uploading || jobs.busy())
            throw new RoGraphError(
              "JOB_BUSY",
              "Wait for the current analysis or cancel it",
            );
          uploading = true;
          let destination: string | undefined;
          try {
            const name = basename(
              decodeURIComponent(
                String(req.headers["x-rograph-filename"] ?? "place.rbxlx"),
              ),
            );
            if (!name.toLowerCase().endsWith(".rbxlx"))
              throw new RoGraphError(
                "UNSUPPORTED_FORMAT",
                "Choose a .rbxlx XML place. In Studio, save as Roblox XML Place.",
              );
            const maximum = 512 * 1024 * 1024;
            if (Number(req.headers["content-length"] ?? 0) > maximum)
              throw new RoGraphError(
                "BODY_LIMIT",
                "Place exceeds the 512 MiB input limit",
              );
            await mkdir(join(workspace, "uploads"), { recursive: true });
            destination = join(workspace, "uploads", randomUUID() + ".rbxlx");
            let bytes = 0;
            const counter = new Transform({
              transform(chunk, encoding, callback) {
                bytes += chunk.length;
                callback(
                  bytes > maximum
                    ? new RoGraphError(
                        "BODY_LIMIT",
                        "Place exceeds the 512 MiB input limit",
                      )
                    : null,
                  chunk,
                );
              },
            });
            await pipeline(
              req,
              counter,
              createWriteStream(destination, { flags: "wx" }),
            );
            const job = jobs.start({ kind: "place", path: destination }, name),
              owned = destination;
            void jobs
              .wait(job.id)
              .then(() => rm(owned, { force: true }))
              .catch(() => {});
            destination = undefined;
            send(res, 202, job);
          } finally {
            uploading = false;
            if (destination) await rm(destination, { force: true });
          }
          return;
        }
        if (method === "POST" && path === "/api/rojo-imports") {
          const body = z
            .object({
              projectPath: z.string().min(1).max(4096),
              watch: z.boolean().optional(),
            })
            .strict()
            .parse(await json(req));
          const project = resolve(body.projectPath.replace(/^"|"$/g, ""));
          if (!/\.project\.jsonc?$/i.test(project))
            throw new RoGraphError(
              "INVALID_INPUT",
              "Choose a Rojo .project.json file",
            );
          const job = jobs.start(
            { kind: "rojo", projectPath: project },
            basename(project),
          );
          if (body.watch) await startWatch(project);
          send(res, 202, job);
          return;
        }
        if (method === "POST" && path === "/api/watch") {
          const body = z
            .object({
              enabled: z.boolean(),
              projectPath: z.string().max(4096).optional(),
            })
            .strict()
            .parse(await json(req));
          if (body.enabled) {
            if (
              !body.projectPath ||
              !/\.project\.jsonc?$/i.test(body.projectPath)
            )
              throw new RoGraphError(
                "INVALID_INPUT",
                "Choose a Rojo .project.json file",
              );
            await startWatch(resolve(body.projectPath));
          } else await stopWatch();
          send(res, 200, {
            enabled: Boolean(
              watchController && !watchController.signal.aborted,
            ),
          });
          return;
        }
        if (method === "POST" && path === "/api/diff") {
          const body = z
            .object({
              before: z.string().min(1).max(128),
              after: z.string().min(1).max(128),
            })
            .strict()
            .parse(await json(req));
          send(res, 200, await store.diff(body.before, body.after));
          return;
        }
        const match = /^\/api\/jobs\/([a-f0-9-]+)(\/cancel)?$/.exec(path);
        if (match) {
          if (method === "GET" && !match[2]) {
            send(res, 200, jobs.get(match[1]));
            return;
          }
          if (method === "DELETE" || (method === "POST" && match[2])) {
            send(res, 200, jobs.cancel(match[1]));
            return;
          }
        }
        if (method === "POST" && path === "/api/query") {
          const q = querySchema.strict().parse(await json(req));
          send(res, 200, await store.query(q));
          return;
        }
        if (method === "POST" && path === "/api/context") {
          const body = z
            .object({
              query: querySchema.strict(),
              estimatedTokenBudget: z
                .number()
                .int()
                .min(256)
                .max(128000)
                .optional(),
              maxBytes: z.number().int().min(2048).max(32000).optional(),
            })
            .strict()
            .parse(await json(req));
          send(res, 200, createContext(await store.query(body.query), body));
          return;
        }
        if (method === "POST" && path === "/api/shutdown") {
          send(res, 200, { stopping: true });
          setImmediate(() => {
            void close();
          });
          return;
        }
        send(res, 404, {
          error: { code: "NOT_FOUND", message: "Unknown local API route" },
        });
        return;
      }
      if (method !== "GET") {
        send(res, 405, { error: { code: "METHOD_NOT_ALLOWED" } });
        return;
      }
      const decoded = decodeURIComponent(path),
        file = resolve(
          staticDir,
          "." + (decoded === "/" ? "/index.html" : decoded),
        ),
        part = relative(staticDir, file);
      if (
        part.startsWith(".." + sep) ||
        part === ".." ||
        part.startsWith(sep) ||
        !(await stat(file)).isFile()
      ) {
        send(res, 404, { error: { code: "NOT_FOUND" } });
        return;
      }
      const types: Record<string, string> = {
        ".html": "text/html; charset=utf-8",
        ".js": "text/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".svg": "image/svg+xml",
        ".png": "image/png",
        ".woff2": "font/woff2",
      };
      res.writeHead(200, {
        "Content-Type": types[extname(file)] ?? "application/octet-stream",
        "Cache-Control":
          extname(file) === ".html" ? "no-store" : "public, max-age=3600",
      });
      await pipeline(createReadStream(file), res);
    } catch (error) {
      const e = error as any;
      if (res.headersSent) {
        res.destroy();
        return;
      }
      const code =
        e.code ??
        (e.name === "ZodError" ? "INVALID_REQUEST" : "INTERNAL_ERROR");
      send(
        res,
        code === "FORBIDDEN"
          ? 403
          : code === "JOB_BUSY"
            ? 409
            : code === "BODY_LIMIT"
              ? 413
              : code.endsWith("NOT_FOUND") || code === "ENOENT"
                ? 404
                : code === "INTERNAL_ERROR"
                  ? 500
                  : 400,
        {
          error: {
            code,
            message:
              e.name === "ZodError"
                ? "Request does not match the supported parameters"
                : (e.message ?? String(e)),
          },
        },
      );
    }
  });
  server.requestTimeout = 120000;
  server.headersTimeout = 15000;
  try {
    await new Promise<void>((accept, reject) => {
      server.once("error", reject);
      server.listen(options.port ?? 0, "127.0.0.1", () => accept());
    });
  } catch (e) {
    await store.close();
    throw e;
  }
  url = `http://127.0.0.1:${(server.address() as any).port}`;
  let closePromise: Promise<void> | undefined;
  const close = () =>
    (closePromise ??= (async () => {
      closing = true;
      watchController?.abort();
      await jobs.close();
      await stopWatch();
      await new Promise<void>((r) => server.close(() => r()));
      await store.close();
    })());
  return { url, sessionToken, close };
}
