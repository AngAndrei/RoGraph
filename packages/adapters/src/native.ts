import { spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Source } from "../../contracts/src/model.js";
import type { ParsedSource } from "../../contracts/src/protocol.js";
import { indexSource } from "../../contracts/src/position.js";
export async function parseSource(
  source: Source,
  signal?: AbortSignal,
  session?: NativeSession,
): Promise<ParsedSource> {
  const request = {
    protocolVersion: 1,
    requestId: source.id,
    sourceId: source.id,
    scriptId: source.scriptId,
    text: source.text,
  };
  const result = session
    ? await session.run<any>(request, signal)
    : await runNative<any>("luau-parser", request, signal);
  const index = indexSource(source.text),
    spans: ParsedSource["spans"] = [];
  const walk = (value: any) => {
    if (!value || typeof value !== "object") return;
    if (typeof value.location === "string" && typeof value.type === "string") {
      value.span = index.fromLocation(value.location);
      spans.push({ kind: value.type, span: value.span });
    }
    for (const [k, v] of Object.entries(value))
      if (k !== "span") {
        if (Array.isArray(v)) v.forEach(walk);
        else if (v && typeof v === "object") walk(v);
      }
  };
  walk(result.ast);
  return {
    sourceId: source.id,
    scriptId: source.scriptId,
    ast: result.ast,
    spans,
    diagnostics: result.diagnostics,
    sha256: source.sha256,
    parserVersion: result.parserVersion,
    featureHash:
      "comments-on-declaration-off-upstream-defaults-binary-nonfinite-v2",
  };
}
export const projectRoot = resolve(
  process.env.ROGRAPH_ROOT ??
    fileURLToPath(
      new URL(
        import.meta.url.endsWith(".ts") ? "../../../" : "../",
        import.meta.url,
      ),
    ),
);
export function toolPath(tool: string) {
  return resolve(
    projectRoot,
    "build",
    "bin",
    `${tool}${process.platform === "win32" ? ".exe" : ""}`,
  );
}
export interface NativeSession {
  run<T = any>(request: unknown, signal?: AbortSignal): Promise<T>;
  close(): Promise<void>;
  stats: { spawns: number; requests: number; active: boolean };
}
export function createNativeSession(tool: string): NativeSession {
  let child: ReturnType<typeof spawn> | undefined,
    closed = false,
    buffer = "",
    stderr = "",
    fatal: unknown,
    exitPromise: Promise<void> | undefined,
    exitResolve: (() => void) | undefined;
  let pending:
    | {
        resolve: (v: any) => void;
        reject: (e: unknown) => void;
        cleanup: () => void;
        bytes: number;
      }
    | undefined;
  const stats = { spawns: 0, requests: 0, active: false },
    decoder = new StringDecoder("utf8");
  const settle = (error?: unknown, value?: unknown) => {
    const p = pending;
    if (!p) return;
    pending = undefined;
    p.cleanup();
    error ? p.reject(error) : p.resolve(value);
  };
  const stop = (error: unknown) => {
    fatal = error;
    closed = true;
    child?.kill();
  };
  const start = () => {
    if (child) return;
    stats.spawns++;
    stats.active = true;
    exitPromise = new Promise<void>((r) => {
      exitResolve = r;
    });
    child = spawn(toolPath(tool), [], {
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    child.stdout!.on("data", (data: Buffer) => {
      if (fatal) return;
      if (!pending) {
        stop(new Error("Unexpected native response"));
        return;
      }
      pending.bytes += data.length;
      if (pending.bytes > 256 * 1024 * 1024) {
        stop(new Error("Native output limit exceeded"));
        return;
      }
      buffer += decoder.write(data);
      let end: number;
      while ((end = buffer.indexOf("\n")) >= 0) {
        const frame = buffer.slice(0, end);
        buffer = buffer.slice(end + 1);
        try {
          const result = JSON.parse(frame);
          settle(result.error ? new Error(result.error) : undefined, result);
        } catch {
          stop(new Error("Native helper returned invalid JSON"));
        }
      }
    });
    child.stderr!.on("data", (data) => {
      stderr = (stderr + data).slice(-8192);
    });
    child.stdin!.on("error", () => {});
    child.on("error", (error) => {
      fatal = new Error(
        `Cannot start ${tool}: ${error.message}. Build the native helpers.`,
      );
      stats.active = false;
      closed = true;
      settle(fatal);
      exitResolve?.();
    });
    child.on("close", (code) => {
      stats.active = false;
      closed = true;
      settle(fatal ?? new Error(stderr || `Native helper exited (${code})`));
      exitResolve?.();
    });
  };
  return {
    stats,
    run<T>(request: unknown, signal?: AbortSignal): Promise<T> {
      signal?.throwIfAborted();
      if (closed) return Promise.reject(new Error("Native session is closed"));
      if (pending)
        return Promise.reject(new Error("Native session queue is full"));
      start();
      stats.requests++;
      return new Promise<T>((resolve, reject) => {
        const abort = () =>
            stop(signal?.reason ?? new Error("Analysis canceled")),
          timer = setTimeout(
            () => stop(new Error("Native helper timed out")),
            120000,
          );
        pending = {
          resolve,
          reject,
          bytes: 0,
          cleanup: () => {
            clearTimeout(timer);
            signal?.removeEventListener("abort", abort);
          },
        };
        signal?.addEventListener("abort", abort, { once: true });
        child!.stdin!.write(JSON.stringify(request) + "\n");
      });
    },
    async close() {
      if (!child) {
        closed = true;
        return;
      }
      closed = true;
      if (pending) stop(new Error("Native session closed"));
      else child.stdin!.end();
      const timer = setTimeout(() => child?.kill(), 1000);
      try {
        await exitPromise;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
export async function runNative<T>(
  tool: string,
  request: unknown,
  signal?: AbortSignal,
): Promise<T> {
  signal?.throwIfAborted();
  return new Promise((accept, reject) => {
    const child = spawn(toolPath(tool), [], {
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const decoder = new StringDecoder("utf8");
    let output = "";
    let error = "";
    let finished = false;
    const finish = (e?: unknown, value?: T) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      if (e) reject(e);
      else accept(value!);
    };
    const abort = () => {
      child.kill();
      finish(signal?.reason ?? new Error("Analysis canceled"));
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(new Error("Native helper timed out"));
    }, 120000);
    signal?.addEventListener("abort", abort, { once: true });
    child.on("error", (e) =>
      finish(
        new Error(
          `Cannot start ${tool}: ${e.message}. Run npm run build:native.`,
        ),
      ),
    );
    let outputBytes = 0;
    child.stdout.on("data", (data) => {
      outputBytes += data.length;
      output += decoder.write(data);
      if (outputBytes > 256 * 1024 * 1024) {
        child.kill();
        finish(new Error("Native output limit exceeded"));
      }
    });
    child.stderr.on("data", (data) => {
      error = (error + data).slice(-8192);
    });
    child.on("close", (code) => {
      if (finished) return;
      output += decoder.end();
      try {
        const value = JSON.parse(output);
        if (value.error) finish(new Error(value.error));
        else if (code !== 0)
          finish(new Error(error || `Native helper failed (${code})`));
        else finish(undefined, value);
      } catch {
        finish(new Error(error || "Native helper returned invalid JSON"));
      }
    });
    child.stdin.on("error", () => {});
    child.stdin.end(JSON.stringify(request) + "\n");
  });
}
