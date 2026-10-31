import type {
  Query,
  QueryResult,
  ContextPack,
  AnalysisSummary,
} from "../../../packages/contracts/src/query.js";
import type { Job } from "../../local/src/jobs.js";
import type { GraphDiff } from "../../../packages/core/src/diff.js";
const key = () => `rograph-session:${location.host}`;
export function bootstrapSession() {
  const p = new URLSearchParams(location.hash.slice(1)),
    token = p.get("session");
  if (token) {
    sessionStorage.setItem(key(), token);
    history.replaceState(null, "", location.pathname + location.search);
  }
}
async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set("X-RoGraph-Session", sessionStorage.getItem(key()) ?? "");
  const res = await fetch(path, { ...options, headers });
  const value = await res.json();
  if (!res.ok)
    throw new Error(
      value.error?.message ?? "RoGraph could not complete this request",
    );
  return value;
}
const post = <T>(path: string, value: unknown) =>
  request<T>(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(value),
  });
export const api = {
  diff: (before: string, after: string) =>
    post<GraphDiff>("/api/diff", { before, after }),
  watch: (enabled: boolean, projectPath?: string) =>
    post("/api/watch", { enabled, projectPath }),
  run: (q: Query) => post<QueryResult>("/api/query", q),
  workspace: () =>
    request<{
      current: string | null;
      analyses: AnalysisSummary[];
      watch?: { enabled: boolean; error?: string };
    }>("/api/workspace"),
  importFile: (file: File) =>
    request<Job>("/api/imports", {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "X-RoGraph-Filename": encodeURIComponent(file.name),
      },
      body: file,
    }),
  importRojo: (projectPath: string, watch = false) =>
    post<Job>("/api/rojo-imports", { projectPath, watch }),
  job: (id: string) => request<Job>("/api/jobs/" + id),
  cancel: (id: string) => request<Job>("/api/jobs/" + id, { method: "DELETE" }),
  context: (query: Query, budget = 2000) =>
    post<ContextPack>("/api/context", {
      query,
      estimatedTokenBudget: budget,
      maxBytes: 32000,
    }),
  stop: () => post("/api/shutdown", {}),
};
