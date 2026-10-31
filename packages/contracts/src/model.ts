import { z } from "zod";
import {
  gameplayRelationSchema,
  gameplayTypes,
  type GameplayRelation,
} from "./gameplay.js";
export type Context = "client" | "server" | "unknown";
export type Status = "saved" | "resolved" | "candidate" | "unresolved";
export type Input =
  | { kind: "place"; path: string }
  | { kind: "rojo"; projectPath: string };
export interface Span {
  startByte: number;
  endByte: number;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
}
export interface Diagnostic {
  code: string;
  severity: "info" | "warning" | "error";
  message: string;
  ownerId?: string;
  siteId?: string;
  sourceId?: string;
  span?: Span;
}
export interface Origin {
  kind: "place" | "file" | "generated";
  path?: string;
  originalPath?: string;
  originalSha256?: string;
  originalText?: string;
  originalBinary?: {
    encoding: "binary";
    mediaType: string;
    sha256: string;
    byteLength: number;
    blobPath: string;
  };
  mapping?: "identity" | "crlf-to-lf" | "unavailable";
}
export interface Source {
  id: string;
  scriptId: string;
  text: string;
  sha256: string;
  origin: Origin;
}
export interface SerializedValue {
  type: string;
  value: unknown;
  rawName?: string;
  unsupported?: boolean;
}
export interface Instance {
  id: string;
  parentId: string | null;
  name: string;
  className: string;
  siblingOrdinal: number;
  originalReferent?: string;
  properties: Record<string, SerializedValue>;
  sourceId?: string;
  synthetic: boolean;
}
export interface Coverage {
  importedInstances: number;
  discoveredScripts: number;
  parsedScripts: number;
  discoveredSites: number;
  resolvedSites: number;
  candidateSites: number;
  unresolvedSites: number;
  partialImport: boolean;
  limitations: string[];
}
export interface Inventory {
  items: Record<string, unknown>[];
  rawInput: {
    sha256: string;
    byteLength: number;
    bytesBase64?: string;
    blobPath?: string;
    extension?: ".rbxl" | ".rbxlx";
  };
  [key: string]: unknown;
}
export interface Snapshot {
  snapshotId: string;
  input: Input;
  versions: Record<string, string>;
  instances: Instance[];
  sources: Source[];
  diagnostics: Diagnostic[];
  coverage: Coverage;
  inventory: Inventory;
}
export interface Node {
  id: string;
  kind: "instance" | "function" | "field" | "external" | "unresolved" | "group";
  ownerId?: string;
  label: string;
  contexts: Context[];
  attributes: Record<string, unknown>;
}
export const relationTypes = [
  "CONTAINS",
  "DECLARES",
  "REQUIRES",
  "CALLS",
  "READS",
  "WRITES",
  "REFERENCES",
  "SENDS_VIA",
  "HANDLES",
  "CONNECTS_SIGNAL",
  "MEMBER_OF",
  ...gameplayTypes,
] as const;
export type RelationType = (typeof relationTypes)[number];
export interface Relation {
  id: string;
  source: string;
  target: string;
  type: RelationType;
  gameplay?: GameplayRelation;
}
export interface Evidence {
  id: string;
  relationId: string;
  siteId?: string;
  sourceId?: string;
  span?: Span;
  instanceId?: string;
  propertyName?: string;
  rule: string;
  status: Status;
  assumptions: string[];
  mechanism?: string;
  contexts: Context[];
}
export interface Expr {
  kind: string;
  span: Span;
  [key: string]: unknown;
}
export interface Site {
  id: string;
  ownerId: string;
  sourceId: string;
  span: Span;
  kind: string;
  expression: Expr;
  status: Status;
  targetIds: string[];
  reason?: string;
  assumptions: string[];
  contexts: Context[];
}
export interface Symbol {
  id: string;
  ownerId: string;
  name: string;
  span: Span;
  parameters: string[];
  bodyScopeId: string;
  [key: string]: unknown;
}
export interface Binding {
  id: string;
  scopeId: string;
  name: string;
  initializer?: Expr;
  assignments: { span: Span; value: Expr }[];
}
export interface Facts {
  scriptId: string;
  sourceId: string;
  scopes: Record<string, unknown>[];
  bindings: Binding[];
  symbols: Symbol[];
  sites: Site[];
  exports: Record<string, unknown>[];
  diagnostics: Diagnostic[];
  [key: string]: unknown;
}
export interface Resolution {
  sites: Site[];
  nodes: Node[];
  relations: Relation[];
  evidence: Evidence[];
  diagnostics: Diagnostic[];
}
export interface Graph {
  analysisId: string;
  snapshotId: string;
  versions: Record<string, string>;
  importManifest: Record<string, unknown>;
  nodes: Node[];
  relations: Relation[];
  evidence: Evidence[];
  sites: Site[];
  sources: Source[];
  diagnostics: Diagnostic[];
  coverage: Coverage;
}
export const spanSchema = z
  .object({
    startByte: z.number().int().nonnegative(),
    endByte: z.number().int().nonnegative(),
    startLine: z.number().int().positive(),
    startColumn: z.number().int().positive(),
    endLine: z.number().int().positive(),
    endColumn: z.number().int().positive(),
  })
  .refine((v) => v.endByte >= v.startByte, "Reversed source span");
const contexts = z.array(z.enum(["client", "server", "unknown"]));
const status = z.enum(["saved", "resolved", "candidate", "unresolved"]);
const schema = z.object({
  analysisId: z.string().min(1),
  snapshotId: z.string().min(1),
  versions: z.record(z.string(), z.string()),
  importManifest: z.record(z.string(), z.unknown()),
  nodes: z.array(
    z.object({
      id: z.string(),
      kind: z.enum([
        "instance",
        "function",
        "field",
        "external",
        "unresolved",
        "group",
      ]),
      ownerId: z.string().optional(),
      label: z.string(),
      contexts,
      attributes: z.record(z.string(), z.unknown()),
    }),
  ),
  relations: z.array(
    z.object({
      id: z.string(),
      source: z.string(),
      target: z.string(),
      type: z.enum(relationTypes),
      gameplay: gameplayRelationSchema.optional(),
    }),
  ),
  evidence: z.array(
    z
      .object({
        id: z.string(),
        relationId: z.string(),
        siteId: z.string().optional(),
        sourceId: z.string().optional(),
        span: spanSchema.optional(),
        instanceId: z.string().optional(),
        propertyName: z.string().optional(),
        rule: z.string(),
        status,
        assumptions: z.array(z.string()),
        mechanism: z.string().optional(),
        contexts,
      })
      .refine(
        (v) =>
          Boolean(v.sourceId && v.span) !==
          Boolean(v.instanceId && v.propertyName),
        "Evidence requires exactly one locator",
      ),
  ),
  sites: z.array(
    z.object({
      id: z.string(),
      ownerId: z.string(),
      sourceId: z.string(),
      span: spanSchema,
      kind: z.string(),
      expression: z
        .object({ kind: z.string(), span: spanSchema })
        .passthrough(),
      status,
      targetIds: z.array(z.string()),
      reason: z.string().optional(),
      assumptions: z.array(z.string()),
      contexts,
    }),
  ),
  sources: z.array(
    z.object({
      id: z.string(),
      scriptId: z.string(),
      text: z.string(),
      sha256: z.string(),
      origin: z
        .object({ kind: z.enum(["place", "file", "generated"]) })
        .passthrough(),
    }),
  ),
  diagnostics: z.array(
    z.object({
      code: z.string(),
      severity: z.enum(["info", "warning", "error"]),
      message: z.string(),
      ownerId: z.string().optional(),
      siteId: z.string().optional(),
      sourceId: z.string().optional(),
      span: spanSchema.optional(),
    }),
  ),
  coverage: z.object({
    importedInstances: z.number().nonnegative(),
    discoveredScripts: z.number().nonnegative(),
    parsedScripts: z.number().nonnegative(),
    discoveredSites: z.number().nonnegative(),
    resolvedSites: z.number().nonnegative(),
    candidateSites: z.number().nonnegative(),
    unresolvedSites: z.number().nonnegative(),
    partialImport: z.boolean(),
    limitations: z.array(z.string()),
  }),
});
export function validateGraph(value: unknown): Graph {
  const result = schema.parse(value) as Graph;
  for (const [kind, items] of Object.entries({
    nodes: result.nodes,
    relations: result.relations,
    evidence: result.evidence,
    sites: result.sites,
    sources: result.sources,
  }))
    if (new Set(items.map((v) => v.id)).size !== items.length)
      throw new Error(`Duplicate ${kind} identity`);
  const nodes = new Set(result.nodes.map((v) => v.id)),
    rels = new Set(result.relations.map((v) => v.id)),
    sources = new Map(result.sources.map((v) => [v.id, v]));
  const siteIds = new Set(result.sites.map((s) => s.id));
  const nodesById = new Map(result.nodes.map((n) => [n.id, n]));
  for (const relation of result.relations)
    if (relation.gameplay) {
      if (!nodes.has(relation.gameplay.sourceScriptId))
        throw new Error("Gameplay source unavailable");
      if (relation.gameplay.supportSiteIds.some((id) => !siteIds.has(id)))
        throw new Error("Gameplay support site unavailable");
      for (const id of [relation.source, relation.target]) {
        const node = nodesById.get(id);
        if (node?.kind !== "instance")
          throw new Error(
            "Gameplay endpoints must be concrete project objects",
          );
      }
    }
  for (const r of result.relations)
    if (!nodes.has(r.source) || !nodes.has(r.target))
      throw new Error("Dangling relation endpoint");
  for (const e of result.evidence) {
    if (!rels.has(e.relationId)) throw new Error("Dangling evidence relation");
    if (
      e.sourceId &&
      (!sources.has(e.sourceId) ||
        e.span!.endByte > Buffer.byteLength(sources.get(e.sourceId)!.text))
    )
      throw new Error("Evidence source/span is unavailable");
    if (e.instanceId && !nodes.has(e.instanceId))
      throw new Error("Evidence instance unavailable");
  }
  return result;
}
