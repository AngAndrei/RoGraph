import { readFile, mkdir, rename, rm } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { resolve, dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { analyze } from "../../../packages/core/src/pipeline.js";
import { openWorkerStore } from "../../../packages/core/src/worker-client.js";
import { createContext } from "../../../packages/core/src/context.js";
import { RoGraphError } from "../../../packages/core/src/util.js";
async function writeJson(path: string, value: Record<string, any>) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = path + "." + randomUUID() + ".tmp";
  function* chunks() {
    yield "{";
    let first = true;
    for (const [key, item] of Object.entries(value)) {
      yield (first ? "" : ",") + JSON.stringify(key) + ":";
      first = false;
      if (Array.isArray(item)) {
        yield "[";
        for (let i = 0; i < item.length; i++)
          yield (i ? "," : "") + JSON.stringify(item[i]);
        yield "]";
      } else yield JSON.stringify(item);
    }
    yield "}";
  }
  try {
    await pipeline(
      Readable.from(chunks()),
      createWriteStream(temporary, { encoding: "utf8" }),
    );
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}
async function main() {
  const args = process.argv.slice(2),
    command = args.shift() ?? "open",
    flags: Record<string, string> = {};
  if (["--help", "-h", "help"].includes(command)) {
    process.stdout.write(
      "RoGraph\n  open --workspace <dir>\n  analyze --input <place.rbxlx> --workspace <dir>\n  analyze --rojo <default.project.json> --workspace <dir>\n  query --workspace <dir> --analysis <id> --request <query.json>\n  export --workspace <dir> --analysis <id> --format graph|json|markdown --output <path>\n  mcp --workspace <dir>\n",
    );
    return;
  }
  for (let i = 0; i < args.length; i += 2) {
    if (
      !/^--[a-z]+$/.test(args[i]) ||
      !args[i + 1] ||
      args[i + 1].startsWith("--")
    )
      throw new RoGraphError("INVALID_ARGUMENT", "Flags require a value");
    flags[args[i].slice(2)] = args[i + 1];
  }
  const allowed = [
    "input",
    "rojo",
    "workspace",
    "analysis",
    "request",
    "format",
    "output",
  ];
  for (const key of Object.keys(flags))
    if (!allowed.includes(key))
      throw new RoGraphError("INVALID_ARGUMENT", "Unknown option: " + key);
  const workspace = resolve(flags.workspace ?? ".rograph");
  if (command === "mcp") {
    const { serveMcp } = await import("./mcp.js");
    await serveMcp(workspace);
    return;
  }
  if (command === "open") {
    const { startServer } = await import("./server.js");
    const app = await startServer(workspace);
    const { execFile } = await import("node:child_process");
    const target = app.url + "/#session=" + app.sessionToken;
    const command =
      process.platform === "win32"
        ? "rundll32.exe"
        : process.platform === "darwin"
          ? "open"
          : "xdg-open";
    execFile(
      command,
      process.platform === "win32"
        ? ["url.dll,FileProtocolHandler", target]
        : [target],
      { windowsHide: true },
      (error) => {
        if (error)
          process.stderr.write(
            "Could not open the browser. Restart RoGraph after setting a default browser.\n",
          );
      },
    );
    process.stdout.write(
      "RoGraph is running at " +
        app.url +
        ". Use Stop app in the explorer to close it.\n",
    );
    const stop = () => {
      void app.close();
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    return;
  }
  if (!["analyze", "query", "export"].includes(command))
    throw new RoGraphError("INVALID_ARGUMENT", "Unknown command");
  const store = await openWorkerStore(join(workspace, "graph.db"));
  const controller = new AbortController(),
    cancel = () => controller.abort();
  process.once("SIGINT", cancel);
  process.once("SIGTERM", cancel);
  try {
    if (command === "analyze") {
      if (Boolean(flags.input) === Boolean(flags.rojo))
        throw new RoGraphError(
          "INVALID_ARGUMENT",
          "Choose one saved place or Rojo project",
        );
      let stage = "";
      let previous = -1;
      const graph = await analyze(
        flags.input
          ? { kind: "place", path: resolve(flags.input) }
          : { kind: "rojo", projectPath: resolve(flags.rojo) },
        store,
        controller.signal,
        {
          cacheDir: join(workspace, "cache"),
          excludedRoots: [workspace],
          onProgress: (p) => {
            if (
              p.stage !== stage ||
              p.completed - previous >= 50 ||
              p.completed === p.total
            ) {
              process.stderr.write(JSON.stringify(p) + "\n");
              stage = p.stage;
              previous = p.completed;
            }
          },
        },
      );
      process.stdout.write(
        JSON.stringify({
          analysisId: graph.analysisId,
          snapshotId: graph.snapshotId,
          coverage: graph.coverage,
        }) + "\n",
      );
      return;
    }
    if (!flags.analysis)
      throw new RoGraphError(
        "INVALID_ARGUMENT",
        "Choose an explicit analysis ID",
      );
    const request = flags.request
      ? JSON.parse(await readFile(resolve(flags.request), "utf8"))
      : { op: "overview" };
    if (request.analysisId && request.analysisId !== flags.analysis)
      throw new RoGraphError(
        "INVALID_ARGUMENT",
        "Request analysis conflicts with --analysis",
      );
    if (command === "query") {
      process.stdout.write(
        JSON.stringify(
          await store.query(
            { ...request, analysisId: flags.analysis },
            controller.signal,
          ),
        ) + "\n",
      );
      return;
    }
    if (!flags.output)
      throw new RoGraphError("INVALID_ARGUMENT", "Choose an output file");
    const output = resolve(flags.output),
      format = flags.format ?? "json";
    if (format === "graph")
      await writeJson(output, await store.readGraph(flags.analysis));
    else if (format === "json" || format === "markdown") {
      const pack = createContext(
        await store.query(
          { ...request, analysisId: flags.analysis },
          controller.signal,
        ),
      );
      if (format === "json") await writeJson(output, pack as any);
      else {
        await mkdir(dirname(output), { recursive: true });
        const { writeFile } = await import("node:fs/promises");
        await writeFile(output, pack.markdown, "utf8");
      }
    } else
      throw new RoGraphError(
        "INVALID_ARGUMENT",
        "Format must be graph, json, or markdown",
      );
    process.stdout.write(
      JSON.stringify({ output, analysisId: flags.analysis, format }) + "\n",
    );
  } finally {
    process.removeListener("SIGINT", cancel);
    process.removeListener("SIGTERM", cancel);
    await store.close();
  }
}
main().catch((error) => {
  process.stderr.write(
    JSON.stringify({
      error: {
        code: error.code ?? "ROGRAPH_ERROR",
        message: error.message ?? String(error),
      },
    }) + "\n",
  );
  process.exitCode = 1;
});
