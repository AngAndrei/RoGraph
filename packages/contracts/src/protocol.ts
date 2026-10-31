import type { Span, Diagnostic } from "./model.js";
export interface ParsedSource {
  sourceId: string;
  scriptId: string;
  ast: any;
  spans: { kind: string; span: Span }[];
  diagnostics: Diagnostic[];
  sha256: string;
  parserVersion: string;
  featureHash: string;
}
export interface NativeRequest {
  protocolVersion: 1;
  requestId: string;
  operation: string;
  [key: string]: unknown;
}
