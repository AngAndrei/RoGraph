import type {
  AssistantRequest,
  AssistantResponse,
  BackendPreference,
  HelpFeature,
  ModelStatus,
} from "../../../../packages/contracts/src/assistant.js";
export interface ChatTurn {
  message: string;
  response: AssistantResponse;
}
async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set(
    "X-RoGraph-Session",
    sessionStorage.getItem("rograph-session:" + location.host) ?? "",
  );
  if (init.body) headers.set("Content-Type", "application/json");
  const response = await fetch(path, { ...init, headers });
  if (!response.ok) {
    let detail = response.statusText;
    try {
      const body = await response.json();
      detail =
        typeof body.error === "string"
          ? body.error
          : typeof body.error?.message === "string"
            ? body.error.message
            : detail;
    } catch {
      /* HTTP status is sufficient if body is not JSON. */
    }
    throw new Error(detail || `Request failed (${response.status})`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
export const chatClient = {
  status: (signal?: AbortSignal) =>
    request<ModelStatus>("/api/assistant/status", { signal }),
  settings: (
    settings: { modelId?: string; backend?: BackendPreference },
    signal?: AbortSignal,
  ) =>
    request<ModelStatus>("/api/assistant/settings", {
      method: "POST",
      body: JSON.stringify(settings),
      signal,
    }),
  install: (modelId: string) =>
    request<unknown>("/api/assistant/models/install", {
      method: "POST",
      body: JSON.stringify({ modelId }),
    }),
  cancelInstall: (id: string) =>
    request<unknown>(
      `/api/assistant/models/install/${encodeURIComponent(id)}`,
      { method: "DELETE" },
    ),
  turn: (requestId: string, body: AssistantRequest, signal: AbortSignal) =>
    request<AssistantResponse>("/api/chat/turns", {
      method: "POST",
      body: JSON.stringify({ requestId, ...body }),
      signal,
    }),
  cancelTurn: (id: string) =>
    request<unknown>(`/api/chat/turns/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),
  history: (analysisId?: string, signal?: AbortSignal) =>
    request<{ turns: ChatTurn[] }>(
      "/api/chat/history" +
        (analysisId ? `?analysisId=${encodeURIComponent(analysisId)}` : ""),
      { signal },
    ),
  clearHistory: (analysisId?: string, signal?: AbortSignal) =>
    request<unknown>("/api/chat/history", {
      method: "DELETE",
      body: JSON.stringify(analysisId ? { analysisId } : {}),
      signal,
    }),
  help: (q: string, signal?: AbortSignal) =>
    request<{
      features: HelpFeature[];
      helpIdentity: ModelStatus["helpIdentity"];
    }>(`/api/help/features?q=${encodeURIComponent(q)}`, { signal }),
};
