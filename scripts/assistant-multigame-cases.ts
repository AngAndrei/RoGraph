/**
 * Derive private, metadata-only assistant holdouts from already imported places.
 * Run with: node --import tsx scripts/assistant-multigame-cases.ts --games=<comma-separated-name-fragments>
 * Generated labels and paths belong in ignored build/ output, never fixtures.
 * Existing workspaces are opened read-only; canonical queries use SQLite backups.
 */
import { DatabaseSync, backup } from "node:sqlite";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";
import { openStore } from "../packages/core/src/store.js";
import { createQueryEngine } from "../packages/core/src/query.js";
import { answerRequest } from "../packages/assistant/src/assistant.js";
import type { Node, Relation } from "../packages/contracts/src/model.js";
import type { Query, QueryResult } from "../packages/contracts/src/query.js";
import type { AssistantIntent } from "../packages/contracts/src/assistant.js";

type Snapshot = {
  game: string;
  snapshotId: string;
  analysisId: string;
  createdAt: string;
  databasePath: string;
  workspacePath: string;
  storageVersion: number;
  versions: Record<string, string>;
  coverage: QueryResult["coverage"];
};
type Expected = {
  op?: Query["op"];
  text?: string;
  targetId?: string;
  targetLabel?: string;
  sourceId?: string;
  fromId?: string;
  toId?: string;
  from?: string;
  to?: string;
  relationId?: string;
  view: "code";
  cardKind?: string;
  pathRequired?: boolean;
  noMatch?: boolean;
  ambiguous?: boolean;
  noQuery?: boolean;
  textPattern?: string;
};
type Case = {
  id: string;
  game: string;
  snapshotId: string;
  analysisId: string;
  query: string;
  kind: string;
  requiresModel: boolean;
  plannedModelHoldout?: boolean;
  expected: Expected;
  canonical?: { query: Query; resultSummary: ReturnType<typeof summarize> };
  routingVerified?: boolean;
};
const arg = (name: string) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const root = resolve(arg("root") ?? ".");
const output = resolve(root, arg("out") ?? "build/multigame-cases.json");
const buildRoot = join(root, "build");
if (
  isAbsolute(relative(buildRoot, output)) ||
  relative(buildRoot, output).startsWith("..") ||
  output === buildRoot
)
  throw Error("Private case output must be inside ignored build/");
const filters = arg("games")
  ?.split(",")
  .map((s) => s.toLowerCase());
const maxGames = Number(arg("max-games") ?? 4);

async function databases(directory: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error: any) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  const result: string[] = [];
  for (const entry of entries) {
    const file = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...(await databases(file)));
    else if (entry.name === "graph.db") result.push(file);
  }
  return result;
}
const inventory: Snapshot[] = [];
const skipped: { databasePath: string; reason: string }[] = [];
for (const file of [
  join(root, "dist/windows-x64/workspace/graph.db"),
  ...(await databases(join(root, "private-inputs"))),
]) {
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(file, { readOnly: true });
    const storageVersion = Number(
      (db.prepare("PRAGMA user_version").get() as any).user_version,
    );
    for (const row of db
      .prepare(
        "SELECT a.*,m.data AS manifest FROM analyses a LEFT JOIN manifests m ON m.analysis=a.id WHERE a.complete=1 ORDER BY a.created DESC",
      )
      .all() as any[]) {
      const header = JSON.parse(row.data);
      const manifest = row.manifest ? JSON.parse(row.manifest) : {};
      const game =
        manifest.displayName ??
        basename(
          String(manifest.input?.path ?? dirname(file)).replaceAll("\\", "/"),
        );
      inventory.push({
        game,
        snapshotId: row.snapshot,
        analysisId: row.id,
        createdAt: row.created,
        databasePath: file,
        workspacePath: dirname(file),
        storageVersion,
        versions: header.versions,
        coverage: header.coverage,
      });
    }
  } catch (error: any) {
    skipped.push({ databasePath: file, reason: error.message });
  } finally {
    db?.close();
  }
}
const chosen = new Map<string, Snapshot>();
for (const item of inventory.sort(
  (a, b) =>
    Number(b.versions.resolver) - Number(a.versions.resolver) ||
    b.createdAt.localeCompare(a.createdAt),
)) {
  if (
    filters &&
    !filters.some((f) =>
      `${item.game} ${item.databasePath}`.toLowerCase().includes(f),
    )
  )
    continue;
  if (!chosen.has(item.snapshotId)) chosen.set(item.snapshotId, item);
}
const selected = [...chosen.values()]
  .sort((a, b) => a.game.localeCompare(b.game))
  .slice(0, maxGames);
if (selected.length < 3)
  throw Error(
    `At least three distinct real snapshots are required; found ${selected.length}`,
  );

function summarize(result: QueryResult) {
  return {
    analysisId: result.analysisId,
    nodeIds: result.nodes.map((n) => n.id),
    relationIds: result.relations.map((r) => r.id),
    sourceIds: result.sources.map((s) => s.id),
    sources: result.sources.map((s) => ({
      id: s.id,
      sha256: s.sha256,
      omittedBytes: s.omittedBytes,
    })),
    pathCount: result.paths.length,
    paths: result.paths,
    evidenceCount: result.evidence.length,
    evidenceRelationIds: [
      ...new Set(result.evidence.map((e) => e.relationId).filter(Boolean)),
    ],
    truncated: result.meta.truncated,
    omittedCounts: result.meta.omittedCounts,
  };
}
const cases: Case[] = [];
const snapshots = [];
for (const snapshot of selected) {
  const privateDb = new DatabaseSync(snapshot.databasePath, { readOnly: true });
  const evaluationDatabasePath = join(
    buildRoot,
    "multigame-workspaces",
    `${snapshot.snapshotId.slice(0, 12)}-${snapshot.analysisId.slice(0, 12)}`,
    "graph.db",
  );
  await mkdir(dirname(evaluationDatabasePath), { recursive: true });
  // SQLite backup includes a consistent view of any committed WAL pages.
  await backup(privateDb, evaluationDatabasePath, { rate: 8192 });
  const nodes = (
    privateDb
      .prepare("SELECT data FROM nodes WHERE analysis=?")
      .all(snapshot.analysisId) as any[]
  ).map((r) => JSON.parse(r.data) as Node);
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const labels = new Map<string, number>();
  for (const node of nodes)
    labels.set(
      node.label.toLowerCase(),
      (labels.get(node.label.toLowerCase()) ?? 0) + 1,
    );
  const relations = (
    privateDb
      .prepare(
        "SELECT data FROM relations WHERE analysis=? AND type IN ('CALLS','REQUIRES','READS')",
      )
      .all(snapshot.analysisId) as any[]
  ).map((r) => JSON.parse(r.data) as Relation);
  const edgeScore = (edge: Relation) => {
    const from = nodeMap.get(edge.source)!,
      to = nodeMap.get(edge.target)!;
    return (
      (/buy|input|player|map|camera|spawn|vote|item/i.test(from.label)
        ? 100
        : 0) +
      (edge.type === "CALLS" ? 20 : 0) -
      (from.label.length + to.label.length) / 100
    );
  };
  const edges = relations
    .filter((r) => {
      const a = nodeMap.get(r.source),
        b = nodeMap.get(r.target);
      return (
        a &&
        b &&
        a.id !== b.id &&
        a.kind === "function" &&
        b.kind === "function" &&
        a.attributes.sourceId &&
        b.attributes.sourceId &&
        labels.get(a.label.toLowerCase()) === 1 &&
        labels.get(b.label.toLowerCase()) === 1 &&
        !/callback|anonymous|@|^Script\./i.test(a.label) &&
        !/callback|anonymous|@|^Script\./i.test(b.label)
      );
    })
    .sort((a, b) => edgeScore(b) - edgeScore(a) || a.id.localeCompare(b.id));
  const edge = edges.find((r) =>
    privateDb
      .prepare(
        "SELECT 1 FROM evidence WHERE analysis=? AND json_extract(data,'$.relationId')=? LIMIT 1",
      )
      .get(snapshot.analysisId, r.id),
  );
  if (!edge)
    throw Error(`No unique named, evidenced function edge in ${snapshot.game}`);
  const from = nodeMap.get(edge.source)!,
    to = nodeMap.get(edge.target)!;
  const ownPath = (n: Node): string =>
    String(
      n.attributes.path ??
        n.attributes.instancePath ??
        nodeMap.get(n.ownerId ?? "")?.attributes.path ??
        n.label,
    );
  let ambiguous = nodes
    .filter(
      (n) =>
        n.kind === "function" &&
        (labels.get(n.label.toLowerCase()) ?? 0) > 1 &&
        !/callback|@/.test(n.label),
    )
    .sort((a, b) => a.label.length - b.label.length)[0]?.label;
  if (!ambiguous) {
    const stem = from.label.split(".")[0];
    for (let length = stem.length - 1; length >= 3; length--) {
      const prefix = stem.slice(0, length);
      if (
        !labels.has(prefix.toLowerCase()) &&
        nodes.filter((n) =>
          n.label.toLowerCase().includes(prefix.toLowerCase()),
        ).length > 1
      ) {
        ambiguous = prefix;
        break;
      }
    }
  }
  if (!ambiguous)
    throw Error(`No real ambiguity candidate in ${snapshot.game}`);
  const edgeCount = Number(
    (
      privateDb
        .prepare("SELECT count(*) AS n FROM relations WHERE analysis=?")
        .get(snapshot.analysisId) as any
    ).n,
  );
  privateDb.close();
  const store = await openStore(evaluationDatabasePath);
  const engine = createQueryEngine(store);
  const base = {
    analysisId: snapshot.analysisId,
    view: "code" as const,
    limit: 60,
  };
  const relationExpected = { relationId: edge.id };
  const target = (node: Node): Expected => ({
    view: "code",
    targetId: node.id,
    targetLabel: node.label,
    text: node.label,
  });
  const definitions: {
    suffix: string;
    query: string;
    kind: string;
    requiresModel?: boolean;
    expected: Expected;
    canonical?: Omit<Query, "analysisId">;
  }[] = [];
  const add = (
    suffix: string,
    query: string,
    expected: Expected,
    canonical?: Omit<Query, "analysisId">,
    requiresModel = false,
    kind = expected.op ?? suffix,
  ) =>
    definitions.push({
      suffix,
      query,
      expected,
      canonical,
      requiresModel,
      kind,
    });
  const search = (n: Node) => ({ op: "search" as const, text: n.label });
  const source = (n: Node) => ({
    op: "source" as const,
    sourceId: String(n.attributes.sourceId),
    startByte: Number((n.attributes.span as any)?.startByte ?? 0),
    endByte: Number((n.attributes.span as any)?.endByte ?? 256),
  });
  const deps = { op: "dependencies" as const, nodeId: from.id, depth: 3 };
  const impact = { op: "impact" as const, nodeId: to.id, depth: 3 };
  const trace = {
    op: "trace" as const,
    fromId: from.id,
    toId: to.id,
    depth: 6,
  };
  const traceExpected: Expected = {
    view: "code",
    op: "trace",
    fromId: from.id,
    toId: to.id,
    from: from.label,
    to: to.label,
    pathRequired: true,
    cardKind: "path",
    ...relationExpected,
  };
  add(
    "fast-search",
    `find ${from.label}`,
    { ...target(from), op: "search", cardKind: "node" },
    search(from),
  );
  add(
    "fast-source",
    `source of ${from.label}`,
    {
      ...target(from),
      op: "source",
      sourceId: String(from.attributes.sourceId),
    },
    source(from),
  );
  add(
    "fast-dependencies",
    `dependencies of ${from.label}`,
    { ...target(from), op: "dependencies", ...relationExpected },
    deps,
  );
  add(
    "fast-impact",
    `impact of ${to.label}`,
    { ...target(to), op: "impact", ...relationExpected },
    impact,
  );
  add(
    "fast-trace",
    `trace from ${from.label} to ${to.label}`,
    traceExpected,
    trace,
  );
  add(
    "fast-ambiguous",
    `dependencies of ${ambiguous}`,
    {
      view: "code",
      text: ambiguous,
      ambiguous: true,
      textPattern: "choose|qualified",
    },
    { op: "search", text: ambiguous },
  );
  const missing = `RoGraphAbsent_${snapshot.snapshotId.slice(0, 12)}_QA`;
  add(
    "fast-no-match",
    `find ${missing}`,
    {
      view: "code",
      op: "search",
      text: missing,
      noMatch: true,
      textPattern: "no literal matches",
    },
    { op: "search", text: missing },
  );
  add(
    "fast-unsupported",
    "Why is this game lagging while players are online?",
    { view: "code", noQuery: true, textPattern: "static|runtime" },
  );
  add(
    "model-search-1",
    `I'm trying to track down the routine named ${from.label}. Can you point me at it?`,
    { ...target(from), op: "search", cardKind: "node" },
    search(from),
    true,
  );
  add(
    "model-search-2",
    `Where in this saved place is ${to.label}?`,
    { ...target(to), op: "search", cardKind: "node" },
    search(to),
    true,
  );
  add(
    "model-source-1",
    `I want to read the implementation of ${from.label}.`,
    {
      ...target(from),
      op: "source",
      sourceId: String(from.attributes.sourceId),
    },
    source(from),
    true,
  );
  add(
    "model-source-2",
    `Let me see the Luau for ${to.label}.`,
    { ...target(to), op: "source", sourceId: String(to.attributes.sourceId) },
    source(to),
    true,
  );
  add(
    "model-dependencies-1",
    `Give me the outgoing dependency chain for ${from.label}.`,
    { ...target(from), op: "dependencies", ...relationExpected },
    deps,
    true,
  );
  add(
    "model-dependencies-2",
    `Which other routines does ${from.label} rely on?`,
    { ...target(from), op: "dependencies", ...relationExpected },
    deps,
    true,
  );
  add(
    "model-impact-1",
    `If ${to.label} changes, which callers could be affected?`,
    { ...target(to), op: "impact", ...relationExpected },
    impact,
    true,
  );
  add(
    "model-impact-2",
    `Identify the routines that rely on ${to.label}.`,
    { ...target(to), op: "impact", ...relationExpected },
    impact,
    true,
  );
  add(
    "model-trace-1",
    `Walk the modeled route starting at ${from.label} and ending at ${to.label}.`,
    traceExpected,
    trace,
    true,
  );
  add(
    "model-trace-2",
    `Is ${to.label} reachable through the graph from ${from.label}?`,
    traceExpected,
    trace,
    true,
  );
  try {
    for (const definition of definitions) {
      const expected = definition.expected;
      const row: Case = {
        id: `${snapshot.snapshotId.slice(0, 12)}-${definition.suffix}`,
        game: snapshot.game,
        snapshotId: snapshot.snapshotId,
        analysisId: snapshot.analysisId,
        query: definition.query,
        requiresModel: false,
        plannedModelHoldout: !!definition.requiresModel,
        kind: definition.kind,
        expected,
      };
      if (definition.canonical) {
        const query = { ...base, ...definition.canonical } as Query;
        const result = await engine.run(query);
        row.canonical = { query, resultSummary: summarize(result) };
        if (expected.noMatch && result.nodes.length)
          throw Error(`No-match term actually matched: ${row.id}`);
        if (
          expected.targetId &&
          expected.op === "search" &&
          !result.nodes.some((n) => n.id === expected.targetId)
        )
          throw Error(`Search lost exact target: ${row.id}`);
        if (
          expected.sourceId &&
          !result.sources.some((s) => s.id === expected.sourceId)
        )
          throw Error(`Source identity mismatch: ${row.id}`);
        if (
          expected.relationId &&
          !result.relations.some((r) => r.id === expected.relationId)
        )
          throw Error(`Expected relationship missing: ${row.id}`);
        if (
          expected.pathRequired &&
          (!result.paths.length ||
            result.paths[0].some(
              (hop) =>
                !result.evidence.some((e) => e.relationId === hop.relationId),
            ))
        )
          throw Error(`Trace lacks evidence: ${row.id}`);
      }
      let interpreted = false;
      const calls: Query[] = [];
      // A fixed oracle checks routing and expectations; no actual model is invoked.
      const intent: AssistantIntent =
        expected.op === "trace"
          ? { op: "trace", from: expected.from, to: expected.to }
          : { op: expected.op as AssistantIntent["op"], text: expected.text };
      const response = await answerRequest(
        {
          message: row.query,
          analysisId: snapshot.analysisId,
          view: "code",
          mode: "game",
        },
        {
          query: async (query, signal) => {
            calls.push(query);
            return engine.run(query, signal);
          },
          interpret: async () => {
            interpreted = true;
            return intent;
          },
        },
      );
      // Parser coverage can grow while these exact holdout questions stay fixed.
      row.requiresModel = interpreted;
      if (
        expected.op &&
        !calls.some(
          (q) =>
            q.op === expected.op &&
            (!expected.sourceId || q.sourceId === expected.sourceId) &&
            (!expected.targetId ||
              expected.op === "search" ||
              expected.op === "source" ||
              q.nodeId === expected.targetId) &&
            (!expected.fromId || q.fromId === expected.fromId) &&
            (!expected.toId || q.toId === expected.toId),
        )
      )
        throw Error(`Oracle operation or target mismatch: ${row.id}`);
      if (
        expected.cardKind &&
        !response.cards.some((c) => c.kind === expected.cardKind)
      )
        throw Error(`Oracle card mismatch: ${row.id}`);
      if (
        expected.ambiguous &&
        (calls.some((q) => q.op !== "search") ||
          !/choose|qualified/i.test(response.text))
      )
        throw Error(`Ambiguity silently resolved: ${row.id}`);
      if (expected.noQuery && calls.length)
        throw Error(`Unsupported request executed query: ${row.id}`);
      if (
        expected.textPattern &&
        !new RegExp(expected.textPattern, "i").test(response.text)
      )
        throw Error(`Oracle answer mismatch: ${row.id}`);
      row.routingVerified = true;
      cases.push(row);
    }
    snapshots.push({
      ...snapshot,
      evaluationDatabasePath,
      nodeCount: nodes.length,
      edgeCount,
      selectedEndpoints: [from, to].map((n) => ({
        id: n.id,
        label: n.label,
        kind: n.kind,
        sourceId: n.attributes.sourceId,
        path: ownPath(n),
      })),
      selectedRelation: {
        id: edge.id,
        type: edge.type,
        source: edge.source,
        target: edge.target,
      },
      modelCases: cases.filter(
        (c) => c.analysisId === snapshot.analysisId && c.requiresModel,
      ).length,
      fastCases: cases.filter(
        (c) => c.analysisId === snapshot.analysisId && !c.requiresModel,
      ).length,
      limitations: [
        "Only already saved static analysis evidence is evaluated; no re-import or runtime observation.",
        ...(snapshot.coverage.limitations ?? []),
      ],
    });
    console.log(
      JSON.stringify({
        game: snapshot.game,
        analysisId: snapshot.analysisId,
        nodes: nodes.length,
        cases: definitions.length,
        routingVerified: true,
      }),
    );
  } finally {
    await store.close();
  }
}
await mkdir(dirname(output), { recursive: true });
await writeFile(
  output,
  JSON.stringify(
    {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      metadataOnly: true,
      verification:
        "Canonical engine on SQLite backup copies; oracle intent routing only; actual model inference intentionally excluded.",
      summary: {
        games: snapshots.length,
        cases: cases.length,
        modelCases: cases.filter((c) => c.requiresModel).length,
        canonicalVerified: cases.filter((c) => c.canonical).length,
        routingVerified: cases.filter((c) => c.routingVerified).length,
      },
      inventory: inventory.map(({ coverage, ...metadata }) => metadata),
      skipped,
      snapshots,
      cases,
    },
    null,
    2,
  ) + "\n",
);
console.log(`Private metadata-only cases: ${output}`);
