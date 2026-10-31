import { cp, readFile, writeFile, mkdir, mkdtemp } from "node:fs/promises";
import { join, resolve, dirname, sep } from "node:path";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
const source = resolve(process.argv[2]),
  owned = await mkdtemp(resolve("build", "portable-smoke-")),
  pkg = join(owned, "RoGraph space-é"),
  workspace = join(owned, "workspace");
await mkdir(pkg);
const manifest = JSON.parse(
  (await readFile(join(source, "checksums.json"), "utf8")).replace(
    /^\uFEFF/,
    "",
  ),
);
for (const file of manifest.files) {
  const destination = resolve(pkg, file.path);
  if (!destination.startsWith(pkg + sep)) throw Error("UNSAFE_PACKAGE_PATH");
  await mkdir(dirname(destination), { recursive: true });
  await cp(join(source, file.path), destination);
}
await cp(join(source, "checksums.json"), join(pkg, "checksums.json"));
const offline = join(owned, "offline.cjs");
await writeFile(
  offline,
  `const prefix=require('node:url').pathToFileURL(process.env.ROGRAPH_ROOT+require('node:path').sep).href;require('node:module').registerHooks({resolve(s,c,next){const r=next(s,c);if(r.url.startsWith('file:')&&!r.url.startsWith(prefix))throw Error('EXTERNAL_DEPENDENCY_BLOCKED');return r}});const net=require('node:net');const original=net.Socket.prototype.connect;net.Socket.prototype.connect=function(...args){const first=args[0];const host=typeof first==='object'?first.host:typeof args[1]==='string'?args[1]:undefined;if(host&&!['127.0.0.1','localhost','::1'].includes(host))throw Error('OFFLINE_NETWORK_BLOCKED');return original.apply(this,args)};globalThis.fetch=()=>Promise.reject(Error('OFFLINE_NETWORK_BLOCKED'));`,
);
const system = process.env.SystemRoot ?? "C:/Windows";
const env: NodeJS.ProcessEnv = {
  ...process.env,
  PATH: [
    join(system, "System32"),
    system,
    join(system, "System32", "WindowsPowerShell", "v1.0"),
  ].join(";"),
  NODE_OPTIONS: `--require "${offline.replaceAll("\\", "/")}"`,
  ROGRAPH_ROOT: pkg,
  ROGRAPH_WORKSPACE: workspace,
};
delete env.NODE_PATH;
const executable = join(pkg, "RoGraph.exe"),
  run = (args: string[]) =>
    promisify(execFile)(executable, args, {
      cwd: owned,
      env,
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024,
      timeout: 120000,
    });
const binary = await readFile(executable),
  pe = binary.readUInt32LE(0x3c);
if (binary.readUInt16LE(pe + 24 + 68) !== 2)
  throw Error("LAUNCHER_NOT_WINDOWLESS");
const rojoVersion = await promisify(execFile)(
  join(pkg, "build/bin/rojo.exe"),
  ["--version"],
  { env, windowsHide: true, timeout: 10000 },
);
if (!rojoVersion.stdout.includes("7.7.1")) throw Error("ROJO_START_FAILED");
const input = join(pkg, "samples", "shop.rbxlx"),
  before = await readFile(input),
  analysis = JSON.parse(
    (await run(["analyze", "--input", input, "--workspace", workspace])).stdout,
  ),
  analysisId = analysis.analysisId;
const binaryAnalysis = JSON.parse(
  (
    await run([
      "analyze",
      "--input",
      join(pkg, "samples", "shop.rbxl"),
      "--workspace",
      join(owned, "binary-workspace"),
    ])
  ).stdout,
);
if (
  binaryAnalysis.coverage.importedInstances < 1 ||
  binaryAnalysis.coverage.parsedScripts < 1 ||
  binaryAnalysis.coverage.partialImport
)
  throw Error("PACKAGED_BINARY_IMPORT_FAILED");
async function query(q: Record<string, unknown>, snapshotId = analysisId) {
  const path = join(owned, "request.json");
  await writeFile(path, JSON.stringify(q));
  return JSON.parse(
    (
      await run([
        "query",
        "--workspace",
        workspace,
        "--analysis",
        snapshotId,
        "--request",
        path,
      ])
    ).stdout,
  );
}
const search = await query({ op: "search", text: "Sword" });
if (!search.nodes.some((n: any) => n.label === "ShopConfig.Prices.Sword"))
  throw Error("CONFIG_SEARCH_FAILED");
const start = (await query({ op: "search", text: "BuySword" })).nodes.find(
    (n: any) => n.label === "ShopClient.BuySword",
  ),
  target = search.nodes.find((n: any) => n.label === "ShopConfig.Prices.Sword");
const trace = await query({
  op: "trace",
  fromId: start.id,
  toId: target.id,
  depth: 6,
});
if (
  trace.paths[0]?.length !== 4 ||
  !trace.paths[0].some((h: any) => h.transition === "potential-communication")
)
  throw Error("TRACE_FAILED");
for (const hop of trace.paths[0])
  if (!trace.evidence.some((e: any) => e.relationId === hop.relationId))
    throw Error("MISSING_TRACE_EVIDENCE");
const output = join(owned, "context.json");
await run([
  "export",
  "--workspace",
  workspace,
  "--analysis",
  analysisId,
  "--format",
  "json",
  "--output",
  output,
]);
const pack = JSON.parse(await readFile(output, "utf8"));
if (pack.json.analysisId !== analysisId || pack.utf8Bytes > 32000)
  throw Error("EXPORT_FAILED");
const reopened = await query({ op: "coverage" });
if (reopened.analysisId !== analysisId) throw Error("REOPEN_FAILED");
if (!(await readFile(input)).equals(before)) throw Error("INPUT_MODIFIED");
const client = new Client({ name: "rograph-package-smoke", version: "1.0.0" }),
  transport = new StdioClientTransport({
    command: executable,
    args: ["mcp", "--workspace", workspace],
    env: env as Record<string, string>,
    cwd: owned,
    stderr: "pipe",
  });
try {
  await client.connect(transport);
  const tools = await client.listTools();
  if (
    !tools.tools.some((t) => t.name === "context") ||
    tools.tools.some((t) => !t.annotations?.readOnlyHint)
  )
    throw Error("MCP_TOOLS_FAILED");
  const result = await client.callTool({ name: "workspace", arguments: {} });
  if ((result.structuredContent as any).current !== analysisId)
    throw Error("MCP_DISCOVERY_FAILED");
} finally {
  await client.close();
  await transport.close();
}
const ui = spawn(executable, ["open", "--workspace", workspace], {
  cwd: owned,
  env,
  windowsHide: true,
  stdio: ["ignore", "pipe", "pipe"],
});
const closed = new Promise<void>((r) => ui.once("close", () => r()));
let origin = "";
ui.stdout.on("data", (d) => {
  origin = String(d).match(/http:\/\/127\.0\.0\.1:\d+/)?.[0] ?? origin;
});
ui.stderr.on("data", () => {});
try {
  for (let i = 0; i < 200 && !origin; i++) {
    await new Promise((r) => setTimeout(r, 100));
    if (ui.exitCode !== null) throw Error("UI_START_FAILED");
  }
  if (!origin) throw Error("UI_START_TIMEOUT");
  const response = await fetch(origin);
  if (!response.ok || !(await response.text()).includes("RoGraph"))
    throw Error("UI_ASSETS_FAILED");
  if (
    !response.headers
      .get("content-security-policy")
      ?.includes("frame-ancestors 'none'")
  )
    throw Error("MISSING_CSP");
} finally {
  if (ui.exitCode === null) ui.kill();
  await closed;
}
for (let i = 0; i < 50; i++) {
  try {
    await fetch(origin);
    await new Promise((r) => setTimeout(r, 100));
  } catch {
    origin = "";
    break;
  }
}
if (origin) throw Error("OWNED_PROCESS_LEAK");
const gameplayInput = join(pkg, "samples", "gameplay.rbxlx");
const gameplayAnalysis = JSON.parse(
  (await run(["analyze", "--input", gameplayInput, "--workspace", workspace]))
    .stdout,
);
const gameplay = await query(
  { op: "overview", view: "gameplay" },
  gameplayAnalysis.analysisId,
);
const chicken = gameplay.nodes.find((n: any) => n.label === "Chicken"),
  egg = gameplay.nodes.find((n: any) => n.label === "Egg");
if (!chicken || !egg || gameplay.nodes.some((n: any) => n.kind !== "instance"))
  throw Error("GAMEPLAY_CONCRETE_OBJECTS_FAILED");
const flow = await query(
  { op: "trace", view: "gameplay", fromId: chicken.id, toId: egg.id, depth: 6 },
  gameplayAnalysis.analysisId,
);
if (
  !flow.paths.length ||
  flow.paths.some((p: any[]) =>
    p.some(
      (h) => !flow.evidence.some((e: any) => e.relationId === h.relationId),
    ),
  )
)
  throw Error("GAMEPLAY_TRACE_PROOF_FAILED");
const eggProof = await query(
  { op: "inspect", view: "gameplay", nodeId: egg.id },
  gameplayAnalysis.analysisId,
);
const support = [
  ...new Set(
    eggProof.relations.flatMap((r: any) => r.gameplay?.supportSiteIds ?? []),
  ),
];
if (
  support.filter((id) => !eggProof.sites.some((s: any) => s.id === id)).length >
  (eggProof.meta.omittedCounts.supportSites ?? 0)
)
  throw Error("GAMEPLAY_SUPPORT_DISCLOSURE_FAILED");
if (
  !eggProof.relations.some((r: any) =>
    r.gameplay?.configInputs?.some((i: any) =>
      i.path.includes("EggTemplateName"),
    ),
  )
)
  throw Error("GAMEPLAY_CONFIG_PROVENANCE_FAILED");
const report = {
  passed: true,
  analysisId,
  checks: [
    "manifest hashes",
    "space and Unicode path",
    "bundled runtime with system-only PATH",
    "external dependency loading blocked",
    "Node networking blocked",
    "XML import",
    "binary place import",
    "indexed search",
    "four-hop evidence trace",
    "bounded context export",
    "reopen",
    "input immutability",
    "actual MCP stdio",
    "windowless PE subsystem",
    "pinned Rojo starts",
    "local UI assets",
    "launcher-owned process cleanup",
    "concrete Gameplay objects from bundled sample",
    "Gameplay model-to-template trace with evidence",
    "support-site retrieval and omission disclosure",
    "config-definition provenance",
  ],
  limitations: [
    "This is dependency-isolated validation on the development computer, not a separate clean PC.",
    "Browser background traffic and native operating-system networking are not blocked by the Node preload.",
  ],
  testedPackage: resolve(source),
};
await writeFile(join(owned, "result.json"), JSON.stringify(report, null, 2));
process.stdout.write(JSON.stringify(report) + "\n");
