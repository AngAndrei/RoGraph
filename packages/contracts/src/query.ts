import type {
  Context,
  Status,
  Span,
  Origin,
  Graph,
  Node,
  Relation,
  Evidence,
  Site,
  Diagnostic,
  Coverage,
  RelationType,
} from "./model.js";
export interface Query {
  op:
    | "search"
    | "inspect"
    | "source"
    | "dependencies"
    | "impact"
    | "trace"
    | "overview"
    | "coverage"
    | "diagnostics"
    | "tree";
  analysisId: string;
  nodeId?: string;
  sourceId?: string;
  original?: boolean;
  text?: string;
  fromId?: string;
  toId?: string;
  parentId?: string | null;
  groupBy?: "service" | "folder";
  includeInstances?: boolean;
  depth?: number;
  limit?: number;
  cursor?: string;
  relationTypes?: RelationType[];
  statuses?: Status[];
  contexts?: Context[];
  classes?: string[];
  startByte?: number;
  endByte?: number;
}
export interface SourceView {
  id: string;
  scriptId: string;
  sha256: string;
  origin: Origin;
  variant?: "saved" | "original";
  text?: string;
  excerpts: { span: Span; text: string }[];
  omittedBytes: number;
}
export interface PathHop {
  relationId: string;
  fromId: string;
  toId: string;
  direction: "forward" | "reverse";
  transition: "dependency" | "potential-communication" | "potential-impact";
}
export interface QueryResult {
  analysisId: string;
  nodes: Node[];
  relations: Relation[];
  evidence: Evidence[];
  sites: Site[];
  sources: SourceView[];
  diagnostics: Diagnostic[];
  coverage: Coverage;
  paths: PathHop[][];
  groups: { id: string; label: string; nodeIds: string[] }[];
  meta: {
    truncated: boolean;
    omittedCounts: Record<string, number>;
    nextCursor?: string;
    limits: Record<string, number>;
  };
}
export interface ContextPack {
  json: QueryResult;
  markdown: string;
  estimatedTokens: number;
  estimateMethod: "characters/4";
  utf8Bytes: number;
  truncated: boolean;
}
export interface AnalysisSummary {
  analysisId: string;
  snapshotId: string;
  inputKind: string;
  complete: boolean;
  createdAt: string;
}
export type { Graph };
