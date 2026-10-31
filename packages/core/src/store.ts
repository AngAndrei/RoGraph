import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { mkdir, readFile, copyFile, rename, access } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { setImmediate } from "node:timers/promises";
import {
  validateGraph,
  type Graph,
  type Source,
  type RelationType,
} from "../../contracts/src/model.js";
import type {
  QueryResult,
  AnalysisSummary,
} from "../../contracts/src/query.js";
import { indexSource } from "./source-index.js";
import { RoGraphError } from "./util.js";
import { migrateDatabase } from "./migrations.js";
export type StoreSelection = {
  analysisId: string;
  limit: number;
  cursor?: string;
  classes?: string[];
  statuses?: string[];
  contexts?: string[];
} & (
  | { op: "nodes"; ids: string[] }
  | { op: "members"; ownerIds: string[] }
  | {
      op: "adjacent";
      nodeIds: string[];
      direction: "in" | "out";
      relationTypes?: RelationType[];
    }
  | { op: "search"; text: string }
  | { op: "sites"; ownerIds: string[] }
  | { op: "evidence"; relationIds: string[] }
  | {
      op: "sources";
      ids: string[];
      original?: boolean;
      startByte?: number;
      endByte?: number;
    }
  | { op: "children"; parentId: string | null }
  | {
      op: "overview";
      groupBy?: "service" | "folder";
      includeInstances?: boolean;
    }
  | { op: "manifest" }
  | { op: "diagnostics" }
);
export interface GraphStore {
  save(graph: Graph, signal?: AbortSignal): Promise<void>;
  publish(id: string): Promise<void>;
  current(): Promise<string | null>;
  listAnalyses(
    limit: number,
    cursor?: string,
  ): Promise<{ items: AnalysisSummary[]; nextCursor?: string }>;
  readGraph(id: string): Promise<Graph>;
  select(selection: StoreSelection): Promise<QueryResult>;
  close(): Promise<void>;
}
const placeholders = (values: unknown[]) => values.map(() => "?").join(",");
const parse = (rows: any[]) => rows.map((r) => JSON.parse(r.data));
export async function openStore(path: string): Promise<GraphStore> {
  await mkdir(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  const version = (db.prepare("PRAGMA user_version").get() as any).user_version;
  if (version !== 0 && version !== 1 && version !== 2) {
    db.close();
    throw new RoGraphError(
      "SCHEMA_VERSION",
      "Workspace uses an unsupported storage version",
    );
  }
  migrateDatabase(
    db,
    await readFile(new URL("./schema.sql", import.meta.url), "utf8"),
    version,
  );
  const all = (sql: string, ...args: SQLInputValue[]) =>
    db.prepare(sql).all(...args) as any[];
  const header = (id: string) => {
    const r = db
      .prepare("SELECT * FROM analyses WHERE id=? AND complete=1")
      .get(id) as any;
    if (!r)
      throw new RoGraphError(
        "ANALYSIS_NOT_FOUND",
        "Select an existing completed analysis",
      );
    return r;
  };
  const base = (id: string): QueryResult => {
    const h = JSON.parse(header(id).data);
    const diagnosticCount = Number(
      (
        db
          .prepare("SELECT COUNT(*) AS n FROM diagnostics WHERE analysis=?")
          .get(id) as any
      ).n,
    );
    return {
      analysisId: id,
      ...h,
      nodes: [],
      relations: [],
      evidence: [],
      sites: [],
      sources: [],
      diagnostics: parse(
        all(
          "SELECT data FROM diagnostics WHERE analysis=? ORDER BY ordinal LIMIT 100",
          id,
        ),
      ),
      paths: [],
      groups: [],
      meta: {
        truncated: diagnosticCount > 100,
        omittedCounts:
          diagnosticCount > 100 ? { diagnostics: diagnosticCount - 100 } : {},
        limits: { nodes: 1000, evidence: 5000 },
      },
    };
  };
  let saving = false;
  return {
    async save(input, signal) {
      signal?.throwIfAborted();
      if (saving)
        throw new RoGraphError(
          "SAVE_IN_PROGRESS",
          "Another snapshot is being saved",
        );
      saving = true;
      try {
        const g = validateGraph(input);
        if (
          db
            .prepare("SELECT id FROM analyses WHERE id=? AND complete=1")
            .get(g.analysisId)
        )
          return;
        const raw = (g.importManifest.inventory as any)?.rawInput;
        if (raw?.blobPath) {
          if (!/^[a-f0-9]{64}$/.test(raw.sha256))
            throw new Error("Invalid raw content hash");
          const hashFile = async (p: string) => {
            const h = createHash("sha256");
            for await (const chunk of createReadStream(p)) h.update(chunk);
            return h.digest("hex");
          };
          const blobs = join(dirname(path), "blobs");
          await mkdir(blobs, { recursive: true });
          const target = join(
            blobs,
            raw.sha256 + (raw.extension === ".rbxl" ? ".rbxl" : ".rbxlx"),
          );
          let present = false;
          try {
            await access(target);
            present = true;
          } catch {}
          if (!present) {
            if ((await hashFile(raw.blobPath)) !== raw.sha256)
              throw new Error("Raw input hash mismatch");
            const temporary = target + "." + process.pid + ".tmp";
            await copyFile(raw.blobPath, temporary);
            if ((await hashFile(temporary)) !== raw.sha256)
              throw new Error("Raw input changed while saving");
            await rename(temporary, target);
          } else if ((await hashFile(target)) !== raw.sha256)
            throw new RoGraphError(
              "BLOB_INTEGRITY",
              "Stored raw input failed its integrity check",
            );
          db.prepare("INSERT OR IGNORE INTO blobs VALUES(?,?)").run(
            raw.sha256,
            target,
          );
        }
        signal?.throwIfAborted();
        const originals = new Map<string, string>();
        for (const source of g.sources) {
          const original = source.origin.originalBinary;
          if (!original) continue;
          if (!/^[a-f0-9]{64}$/.test(original.sha256))
            throw new Error("Invalid original content hash");
          let target = originals.get(original.sha256);
          if (!target) {
            const directory = join(dirname(path), "blobs");
            await mkdir(directory, { recursive: true });
            target = join(directory, original.sha256 + ".rbxm");
            const digest = async (file: string) => {
              const h = createHash("sha256");
              for await (const chunk of createReadStream(file)) h.update(chunk);
              return h.digest("hex");
            };
            let present = false;
            try {
              await access(target);
              present = true;
            } catch {}
            if (!present) {
              if ((await digest(original.blobPath)) !== original.sha256)
                throw new Error("Original binary hash mismatch");
              const temporary = target + "." + process.pid + ".tmp";
              await copyFile(original.blobPath, temporary);
              if ((await digest(temporary)) !== original.sha256)
                throw new Error("Original binary changed while retaining it");
              await rename(temporary, target);
            } else if ((await digest(target)) !== original.sha256)
              throw new RoGraphError(
                "BLOB_INTEGRITY",
                "Stored binary original failed its integrity check",
              );
            db.prepare("INSERT OR IGNORE INTO blobs VALUES(?,?)").run(
              original.sha256,
              target,
            );
            originals.set(original.sha256, target);
          }
          source.origin.originalBinary = { ...original, blobPath: target };
        }
        signal?.throwIfAborted();
        db.exec("BEGIN IMMEDIATE");
        try {
          db.prepare("INSERT INTO analyses VALUES(?,?,?,?,?,?,?)").run(
            g.analysisId,
            g.snapshotId,
            String((g.importManifest.input as any)?.kind ?? "place"),
            0,
            Number(g.coverage.partialImport),
            new Date().toISOString(),
            JSON.stringify({
              snapshotId: g.snapshotId,
              versions: g.versions,
              coverage: g.coverage,
            }),
          );
          db.prepare("INSERT INTO manifests VALUES(?,?)").run(
            g.analysisId,
            JSON.stringify(g.importManifest),
          );
          const write = async (
            sql: string,
            rows: any[],
            values: (r: any, i: number) => SQLInputValue[],
          ) => {
            const statement = db.prepare(sql);
            for (let i = 0; i < rows.length; i++) {
              if (i % 1000 === 0) {
                await setImmediate();
                signal?.throwIfAborted();
              }
              statement.run(g.analysisId, ...values(rows[i], i));
            }
          };
          await write(
            "INSERT INTO nodes VALUES(?,?,?,?,?,?,?)",
            g.nodes,
            (n) => [
              n.id,
              n.ownerId ?? null,
              n.label,
              n.kind,
              n.attributes.className ?? null,
              JSON.stringify(n),
            ],
          );
          await write(
            "INSERT INTO node_search(analysis,id,label) VALUES(?,?,?)",
            g.nodes,
            (n) => [n.id, n.label],
          );
          await write(
            "INSERT INTO relations VALUES(?,?,?,?,?,?)",
            g.relations,
            (r) => [r.id, r.source, r.target, r.type, JSON.stringify(r)],
          );
          await write(
            "INSERT INTO evidence VALUES(?,?,?,?,?,?,?)",
            g.evidence,
            (e) => [
              e.id,
              e.relationId,
              e.sourceId ?? null,
              e.siteId ?? null,
              e.status,
              JSON.stringify(e),
            ],
          );
          await write("INSERT INTO sites VALUES(?,?,?,?,?,?)", g.sites, (s) => [
            s.id,
            s.ownerId,
            s.sourceId,
            s.status,
            JSON.stringify(s),
          ]);
          await write("INSERT INTO sources VALUES(?,?,?,?)", g.sources, (s) => [
            s.id,
            s.scriptId,
            JSON.stringify(s),
          ]);
          await write(
            "INSERT INTO diagnostics VALUES(?,?,?)",
            g.diagnostics,
            (d, i) => [i, JSON.stringify(d)],
          );
          signal?.throwIfAborted();
          db.prepare("UPDATE analyses SET complete=1 WHERE id=?").run(
            g.analysisId,
          );
          db.exec("COMMIT");
        } catch (e) {
          db.exec("ROLLBACK");
          throw e;
        }
      } finally {
        saving = false;
      }
    },
    async publish(id) {
      const row = header(id);
      if (row.partial)
        throw new RoGraphError(
          "PARTIAL_ANALYSIS",
          "Partial imports remain inspectable but cannot replace the current complete analysis",
        );
      db.prepare(
        "INSERT INTO current_analysis VALUES(1,?) ON CONFLICT(singleton) DO UPDATE SET analysis=excluded.analysis",
      ).run(id);
    },
    async current() {
      return (
        (
          db
            .prepare("SELECT analysis FROM current_analysis WHERE singleton=1")
            .get() as any
        )?.analysis ?? null
      );
    },
    async listAnalyses(limit, cursor) {
      const count = Math.min(100, Math.max(1, limit)),
        offset = Number(cursor ?? 0);
      if (!Number.isSafeInteger(offset) || offset < 0)
        throw new Error("Invalid cursor");
      const rows = all(
        "SELECT * FROM analyses WHERE complete=1 ORDER BY created DESC,id LIMIT ? OFFSET ?",
        count + 1,
        offset,
      );
      return {
        items: rows.slice(0, count).map((r) => ({
          analysisId: r.id,
          snapshotId: r.snapshot,
          inputKind: r.kind,
          complete: !r.partial,
          createdAt: r.created,
        })),
        nextCursor: rows.length > count ? String(offset + count) : undefined,
      };
    },
    async readGraph(id) {
      const h = JSON.parse(header(id).data),
        rows = (t: string) =>
          parse(
            all(
              `SELECT data FROM ${t} WHERE analysis=? ORDER BY ${t === "diagnostics" ? "ordinal" : "rowid"}`,
              id,
            ),
          );
      return {
        analysisId: id,
        ...h,
        importManifest: JSON.parse(
          (
            db
              .prepare("SELECT data FROM manifests WHERE analysis=?")
              .get(id) as any
          ).data,
        ),
        nodes: rows("nodes"),
        relations: rows("relations"),
        evidence: rows("evidence"),
        sites: rows("sites"),
        sources: rows("sources"),
        diagnostics: rows("diagnostics"),
      };
    },
    async select(q) {
      const result = base(q.analysisId),
        limit = Math.min(
          q.op === "evidence" ? 5000 : 1000,
          Math.max(1, q.limit),
        ),
        offset = Number(q.cursor ?? 0);
      if (!Number.isSafeInteger(offset) || offset < 0)
        throw new Error("Invalid selection cursor");
      if (q.op === "diagnostics") {
        result.diagnostics = parse(
          all(
            "SELECT data FROM diagnostics WHERE analysis=? ORDER BY ordinal LIMIT ? OFFSET ?",
            q.analysisId,
            limit,
            offset,
          ),
        );
        const total = Number(
            (
              db
                .prepare(
                  "SELECT COUNT(*) AS n FROM diagnostics WHERE analysis=?",
                )
                .get(q.analysisId) as any
            ).n,
          ),
          remaining = Math.max(0, total - offset - result.diagnostics.length);
        result.meta.truncated = remaining > 0;
        result.meta.omittedCounts = remaining ? { diagnostics: remaining } : {};
        if (remaining)
          result.meta.nextCursor = String(offset + result.diagnostics.length);
        return result;
      }
      if (q.op === "evidence") {
        const relationIds = [...new Set(q.relationIds)];
        if (!relationIds.length) return result;
        const first = db.prepare(
          "SELECT id,data FROM evidence WHERE analysis=? AND relation=? ORDER BY id LIMIT 1",
        );
        const heads = relationIds
            .map((id) => first.get(q.analysisId, id) as any)
            .filter(Boolean),
          headIds = heads.map((r) => r.id as string),
          pageHeads = heads.slice(offset, offset + limit),
          remaining = limit - pageHeads.length;
        const sql = `SELECT data FROM evidence WHERE analysis=? AND relation IN (${placeholders(relationIds)})${headIds.length ? ` AND id NOT IN (${placeholders(headIds)})` : ""} ORDER BY id LIMIT ? OFFSET ?`;
        const tail = all(
          sql,
          q.analysisId,
          ...relationIds,
          ...headIds,
          remaining + 1,
          Math.max(0, offset - heads.length),
        );
        result.evidence = parse([...pageHeads, ...tail.slice(0, remaining)]);
        if (
          tail.length > remaining ||
          offset + pageHeads.length < heads.length
        ) {
          result.meta.truncated = true;
          result.meta.omittedCounts.additionalRecordsAtLeast = 1;
          result.meta.nextCursor = String(offset + result.evidence.length);
        }
        return result;
      }
      let sql = "",
        args: SQLInputValue[] = [],
        key: "nodes" | "relations" | "sites" | "evidence" | "sources" = "nodes";
      const ids = (table: string, column: string, values: string[]) => {
        sql = `SELECT data FROM ${table} WHERE analysis=? AND ${column} IN (${placeholders(values)}) ORDER BY id`;
        args = [q.analysisId, ...values];
      };
      switch (q.op) {
        case "manifest":
          return result;
        case "nodes":
          ids("nodes", "id", q.ids);
          break;
        case "members":
          ids("nodes", "owner", q.ownerIds);
          break;
        case "adjacent":
          key = "relations";
          ids(
            "relations",
            q.direction === "out" ? "source" : "target",
            q.nodeIds,
          );
          if (q.relationTypes?.length) {
            sql = sql.replace(
              " ORDER BY",
              ` AND type IN (${placeholders(q.relationTypes)}) ORDER BY`,
            );
            args.push(...q.relationTypes);
          }
          break;
        case "sites":
          key = "sites";
          ids("sites", "owner", q.ownerIds);
          break;
        case "sources":
          key = "sources";
          ids("sources", "id", q.ids);
          break;
        case "children":
          sql =
            "SELECT data FROM nodes WHERE analysis=? AND owner IS ? ORDER BY id";
          args = [q.analysisId, q.parentId];
          break;
        case "overview":
          sql = q.includeInstances
            ? "SELECT data FROM nodes WHERE analysis=? AND kind='instance' ORDER BY id"
            : "SELECT data FROM nodes WHERE analysis=? AND kind='instance' AND class IN ('Script','LocalScript','ModuleScript') ORDER BY id";
          args = [q.analysisId];
          break;
        case "search": {
          const tokens = q.text.slice(0, 256).match(/[\p{L}\p{N}_]+/gu);
          if (!tokens?.length) return result;
          sql =
            "SELECT n.data FROM node_search JOIN nodes n ON n.analysis=node_search.analysis AND n.id=node_search.id WHERE node_search MATCH ? AND n.analysis=? ORDER BY n.id";
          args = [
            `analysis : "${q.analysisId.replaceAll('"', '""')}" AND label : (${tokens.map((t) => '"' + t + '"*').join(" AND ")})`,
            q.analysisId,
          ];
          break;
        }
      }
      const predicates: string[] = [];
      const alias = q.op === "search" ? "n" : "nodes";
      if (key === "nodes") {
        if (q.classes?.length) {
          predicates.push(
            `COALESCE(json_extract(${alias}.data,'$.attributes.className'),json_extract(${alias}.data,'$.attributes.scriptClassName')) IN (${placeholders(q.classes)})`,
          );
          args.push(...q.classes);
        }
        if (q.contexts?.length) {
          predicates.push(
            `EXISTS(SELECT 1 FROM json_each(${alias}.data,'$.contexts') WHERE value IN (${placeholders(q.contexts)}))`,
          );
          args.push(...q.contexts);
        }
        if (q.statuses?.length) {
          predicates.push(
            `COALESCE(json_extract(${alias}.data,'$.attributes.status'),CASE ${alias}.kind WHEN 'instance' THEN 'saved' WHEN 'unresolved' THEN 'unresolved' ELSE 'resolved' END) IN (${placeholders(q.statuses)})`,
          );
          args.push(...q.statuses);
        }
      }
      if (predicates.length)
        sql = sql.replace(
          " ORDER BY",
          ` AND ${predicates.join(" AND ")} ORDER BY`,
        );
      const rows = all(sql + " LIMIT ? OFFSET ?", ...args, limit + 1, offset);
      result.meta.truncated = rows.length > limit;
      if (result.meta.truncated) {
        result.meta.nextCursor = String(offset + limit);
        result.meta.omittedCounts.additionalRecordsAtLeast = 1;
      }
      const values = parse(rows.slice(0, limit));
      if (key === "sources")
        result.sources = values.map((s: Source) => {
          const original = q.op === "sources" && q.original;
          if (original && s.origin.originalText === undefined)
            throw new RoGraphError(
              s.origin.originalBinary
                ? "BINARY_ORIGINAL_NOT_TEXT"
                : "SOURCE_NOT_FOUND",
              s.origin.originalBinary
                ? "The exact binary model is retained as an owned blob; it has no UTF-8 text coordinates"
                : "No separate original file is stored for this source",
            );
          const text = original ? s.origin.originalText! : s.text;
          const bytes = Buffer.byteLength(text),
            start = q.op === "sources" ? (q.startByte ?? 0) : 0,
            end = Math.min(
              bytes,
              start + 32000,
              q.op === "sources" ? (q.endByte ?? bytes) : bytes,
            );
          const index = indexSource(text);
          const buf = Buffer.from(text);
          let a = Math.max(0, Math.min(start, bytes)),
            b = Math.max(a, end);
          while (a < bytes && (buf[a] & 192) === 128) a++;
          while (b > a && b < bytes && (buf[b] & 192) === 128) b--;
          const span = index.span(a, b);
          const origin = { ...s.origin, originalText: undefined };
          return {
            id: s.id,
            scriptId: s.scriptId,
            sha256: original ? s.origin.originalSha256! : s.sha256,
            origin,
            variant: original ? "original" : "saved",
            ...(a === 0 && b === bytes ? { text } : {}),
            excerpts: [{ span, text: buf.subarray(a, b).toString("utf8") }],
            omittedBytes: bytes - (b - a),
          };
        });
      else (result[key] as any[]) = values;
      return result;
    },
    async close() {
      db.close();
    },
  };
}
