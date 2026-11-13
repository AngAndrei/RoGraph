import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AssistantCard,
  AssistantMode,
  BackendPreference,
  ModelStatus,
} from "../../../../packages/contracts/src/assistant.js";
import type { Evidence } from "../../../../packages/contracts/src/model.js";
import type { Query } from "../../../../packages/contracts/src/query.js";
import { chatClient, type ChatTurn } from "./client.js";
import { clampPosition, type Position } from "./position.js";
import "./chat.css";

export interface ChatWidgetProps {
  analysisId?: string;
  view: "code" | "gameplay";
  selectedId?: string;
  onNavigate: (query: Query) => void;
  onSource: (source: { analysisId: string; evidence: Evidence }) => void;
  onContext: (query: Query) => void;
}
const POSITION_KEY = "rograph-assistant-position";
const HISTORY_LIMIT = 30;
function viewport() {
  return {
    width: window.visualViewport?.width ?? window.innerWidth,
    height: window.visualViewport?.height ?? window.innerHeight,
  };
}
function windowSize() {
  const v = viewport();
  return {
    width: Math.min(420, Math.max(0, v.width - 16)),
    height: Math.min(650, Math.max(0, v.height - 16)),
  };
}
function initialPosition(): Position {
  const v = viewport(),
    size = windowSize();
  try {
    const stored = JSON.parse(localStorage.getItem(POSITION_KEY) ?? "null");
    if (stored) return clampPosition(stored, v, size);
  } catch {
    /* Position persistence is optional. */
  }
  return clampPosition(
    { x: v.width - size.width - 20, y: v.height - size.height - 20 },
    v,
    size,
  );
}
function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
function activeDownload(status?: ModelStatus) {
  return (
    status?.download?.status === "downloading" ||
    status?.download?.status === "verifying"
  );
}
export function ChatWidget(props: ChatWidgetProps) {
  const [open, setOpen] = useState(false),
    [settings, setSettings] = useState(false);
  const [position, setPosition] = useState(initialPosition);
  const [size, setSize] = useState(windowSize);
  const [mode, setMode] = useState<AssistantMode>("auto"),
    [message, setMessage] = useState("");
  const scope = mode === "help" ? undefined : props.analysisId;
  const scopeKey = scope ?? "app-help";
  const [history, setHistory] = useState<{ scope: string; turns: ChatTurn[] }>({
    scope: scopeKey,
    turns: [],
  });
  const [historyReady, setHistoryReady] = useState(false),
    [busy, setBusy] = useState(false);
  const [error, setError] = useState(""),
    [status, setStatus] = useState<ModelStatus>();
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [statusRevision, setStatusRevision] = useState(0);
  const panel = useRef<HTMLDivElement>(null),
    launcher = useRef<HTMLButtonElement>(null),
    input = useRef<HTMLTextAreaElement>(null);
  const pending = useRef<
    { id: string; controller: AbortController } | undefined
  >(undefined);
  const generation = useRef(0);
  const drag = useRef<
    { x: number; y: number; start: Position; pointerId: number } | undefined
  >(undefined);
  const turns = history.scope === scopeKey ? history.turns : [];
  const move = useCallback((next: Position) => {
    const size = panel.current?.getBoundingClientRect();
    setPosition(
      clampPosition(next, viewport(), size?.width ? size : windowSize()),
    );
  }, []);
  const cancelPending = useCallback(() => {
    const active = pending.current;
    if (!active) return;
    pending.current = undefined;
    active.controller.abort();
    void chatClient.cancelTurn(active.id).catch(() => {
      /* The cancelled turn may already have finished. */
    });
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(POSITION_KEY, JSON.stringify(position));
    } catch {
      /* Storage may be unavailable. */
    }
  }, [position]);
  useEffect(() => {
    const resize = () => {
      const next = windowSize();
      setSize(next);
      setPosition((p) => clampPosition(p, viewport(), next));
    };
    window.addEventListener("resize", resize);
    window.visualViewport?.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("resize", resize);
      window.visualViewport?.removeEventListener("resize", resize);
    };
  }, []);
  useEffect(() => {
    if (!open) return;
    move(position);
    input.current?.focus();
    const controller = new AbortController();
    let disposed = false,
      timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      try {
        const next = await chatClient.status(controller.signal);
        if (disposed) return;
        setStatus(next);
        if (activeDownload(next)) timer = setTimeout(load, 1000);
      } catch (e) {
        if (!disposed && !controller.signal.aborted) setError(errorText(e));
      }
    };
    void load();
    return () => {
      disposed = true;
      controller.abort();
      clearTimeout(timer);
    };
  }, [open, scopeKey, status?.download?.id, statusRevision]);
  useEffect(() => {
    const current = ++generation.current;
    cancelPending();
    setBusy(false);
    setError("");
    setMessage("");
    setHistoryReady(false);
    setHistory({ scope: scopeKey, turns: [] });
    if (!open) return;
    const controller = new AbortController();
    void chatClient
      .history(scope, controller.signal)
      .then((result) => {
        if (current !== generation.current || controller.signal.aborted) return;
        setHistory({
          scope: scopeKey,
          turns: result.turns.slice(-HISTORY_LIMIT),
        });
        setHistoryReady(true);
      })
      .catch((e) => {
        if (!controller.signal.aborted && current === generation.current) {
          setError(errorText(e));
          setHistoryReady(true);
        }
      });
    return () => {
      controller.abort();
      cancelPending();
    };
  }, [scopeKey, open, cancelPending]);
  useEffect(() => () => cancelPending(), [cancelPending]);
  const minimize = () => {
    setOpen(false);
    requestAnimationFrame(() => launcher.current?.focus());
  };
  const send = async () => {
    if (!message.trim() || busy || !historyReady) return;
    if (mode === "game" && !scope) {
      setError("Import and select a snapshot to find items in your game.");
      return;
    }
    const current = generation.current,
      text = message.trim(),
      id = crypto.randomUUID();
    const controller = new AbortController();
    pending.current = { id, controller };
    setBusy(true);
    setError("");
    try {
      const response = await chatClient.turn(
        id,
        {
          message: text,
          mode,
          ...(scope
            ? {
                analysisId: scope,
                view: props.view,
                selectedId: props.selectedId,
              }
            : {}),
        },
        controller.signal,
      );
      if (
        current !== generation.current ||
        pending.current?.id !== id ||
        controller.signal.aborted
      )
        return;
      setHistory((old) => ({
        scope: scopeKey,
        turns: [
          ...(old.scope === scopeKey ? old.turns : []),
          { message: text, response },
        ].slice(-HISTORY_LIMIT),
      }));
      setMessage("");
    } catch (e) {
      if (current === generation.current && !controller.signal.aborted)
        setError(errorText(e));
    } finally {
      if (pending.current?.id === id) {
        pending.current = undefined;
        setBusy(false);
        if (current === generation.current && !controller.signal.aborted)
          setStatusRevision((revision) => revision + 1);
      }
    }
  };
  const updateSettings = async (value: {
    modelId?: string;
    backend?: BackendPreference;
  }) => {
    setSettingsBusy(true);
    setError("");
    try {
      setStatus(await chatClient.settings(value));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSettingsBusy(false);
    }
  };
  const install = async (id: string) => {
    setSettingsBusy(true);
    setError("");
    try {
      await chatClient.install(id);
      setStatus(await chatClient.status());
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSettingsBusy(false);
    }
  };
  const renderCard = (card: AssistantCard) => (
    <article className="rg-chat-card" key={card.id}>
      <strong>{card.label}</strong>
      {card.detail && <p>{card.detail}</p>}
      {card.feature && (
        <>
          <p>{card.feature.purpose}</p>
          <ol>
            {card.feature.steps.map((step, i) => (
              <li key={i}>{step}</li>
            ))}
          </ol>
          <p>
            <strong>Limitations</strong>
          </p>
          <ul>
            {card.feature.limitations.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>
          <small>App {card.feature.implementedIn} and later</small>
        </>
      )}
      <div className="rg-chat-actions">
        {card.query && card.query.analysisId === props.analysisId && (
          <>
            <button
              type="button"
              onClick={() => {
                if (card.query!.op === "source") setOpen(false);
                props.onNavigate(card.query!);
              }}
            >
              {card.kind === "path" ? "Show path" : "Inspect"} {card.label}
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                props.onContext(card.query!);
              }}
            >
              Export context for {card.label}
            </button>
          </>
        )}
        {card.source && card.source.analysisId === props.analysisId && (
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              props.onSource(card.source!);
            }}
          >
            View source for {card.label}
          </button>
        )}
      </div>
    </article>
  );
  return (
    <div className="rg-chat-root">
      {!open && (
        <button
          className="rg-chat-launcher"
          type="button"
          aria-label="Open RoGraph assistant"
          ref={launcher}
          onClick={() => setOpen(true)}
        >
          <svg width="29" height="29" viewBox="0 0 32 32" aria-hidden="true">
            <path
              d="M16 3v5m-9 3h18v15H7zM3 15v7m26-7v7M12 22h8"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <circle cx="12" cy="16" r="2" fill="currentColor" />
            <circle cx="20" cy="16" r="2" fill="currentColor" />
            <circle cx="16" cy="3" r="2" fill="currentColor" />
          </svg>
        </button>
      )}
      {open && (
        <div
          className="rg-chat-window"
          role="dialog"
          aria-label="RoGraph assistant"
          ref={panel}
          style={{
            left: position.x,
            top: position.y,
            width: size.width,
            height: size.height,
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.stopPropagation();
              minimize();
            }
          }}
        >
          <div className="rg-chat-header">
            <div
              className="rg-chat-drag"
              role="button"
              tabIndex={0}
              aria-label="Move assistant window"
              title="Drag to move, or use arrow keys"
              onKeyDown={(event) => {
                const offsets: Record<string, Position> = {
                  ArrowLeft: { x: -16, y: 0 },
                  ArrowRight: { x: 16, y: 0 },
                  ArrowUp: { x: 0, y: -16 },
                  ArrowDown: { x: 0, y: 16 },
                };
                const offset = offsets[event.key];
                if (offset) {
                  event.preventDefault();
                  event.stopPropagation();
                  move({ x: position.x + offset.x, y: position.y + offset.y });
                }
              }}
              onPointerDown={(event) => {
                if (event.button !== 0) return;
                drag.current = {
                  x: event.clientX,
                  y: event.clientY,
                  start: position,
                  pointerId: event.pointerId,
                };
                event.currentTarget.setPointerCapture?.(event.pointerId);
              }}
              onPointerMove={(event) => {
                const d = drag.current;
                if (d && d.pointerId === event.pointerId)
                  move({
                    x: d.start.x + event.clientX - d.x,
                    y: d.start.y + event.clientY - d.y,
                  });
              }}
              onPointerUp={() => {
                drag.current = undefined;
              }}
              onPointerCancel={() => {
                drag.current = undefined;
              }}
            >
              <strong>RoGraph assistant</strong>
              <small>Local help & game navigation</small>
            </div>
            <button
              type="button"
              aria-label="Reset assistant position"
              title="Reset position"
              onClick={() => {
                const v = viewport(),
                  s = windowSize();
                move({
                  x: v.width - s.width - 20,
                  y: v.height - s.height - 20,
                });
              }}
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  d="M4 10a8 8 0 1 1 1 7M4 4v6h6"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
            <button
              type="button"
              aria-label="Minimize assistant"
              title="Minimize"
              onClick={minimize}
            >
              −
            </button>
          </div>
          <div className="rg-chat-toolbar">
            <label>
              Mode
              <select
                aria-label="Assistant mode"
                value={mode}
                onChange={(e) => setMode(e.target.value as AssistantMode)}
              >
                <option value="auto">Auto</option>
                <option value="game">Find in game</option>
                <option value="help">App help</option>
              </select>
            </label>
            <button
              type="button"
              aria-label="Model settings"
              aria-expanded={settings}
              onClick={() => {
                if (!settings) setStatusRevision((revision) => revision + 1);
                setSettings(!settings);
              }}
            >
              Model settings
            </button>
          </div>
          {error && (
            <p className="rg-chat-error" role="alert">
              {error}
            </p>
          )}
          {settings ? (
            <div className="rg-chat-settings">
              <h3>Local models</h3>
              <p>Help and deterministic searches work without a model.</p>
              {!status && <p role="status">Loading model status…</p>}
              {status && (
                <>
                  <label>
                    Inference backend
                    <select
                      aria-label="Inference backend"
                      value={status.backend}
                      disabled={settingsBusy}
                      onChange={(event) =>
                        void updateSettings({
                          backend: event.target.value as BackendPreference,
                        })
                      }
                    >
                      <option value="auto">Auto</option>
                      <option value="cpu">CPU</option>
                      <option value="gpu">GPU</option>
                    </select>
                  </label>
                  <p>
                    Actual backend:{" "}
                    {status.actualBackend?.toUpperCase() ?? "Not running"} ·
                    Runtime: {status.runtimeState}
                  </p>
                  {status.runtimeError && (
                    <p className="rg-chat-error">{status.runtimeError}</p>
                  )}
                  <p>
                    Free RAM:{" "}
                    {status.hardware.freeRamGiB.toFixed(1).replace(/\.0$/, "")}{" "}
                    GiB / {status.hardware.totalRamGiB.toFixed(1)} GiB
                  </p>
                  <p>
                    GPU probe: {status.hardware.gpuProbe}.{" "}
                    {status.hardware.gpus.length
                      ? status.hardware.gpus
                          .map(
                            (gpu) =>
                              gpu.name +
                              (gpu.memoryMiB ? ` (${gpu.memoryMiB} MiB)` : ""),
                          )
                          .join(", ")
                      : "No supported GPU reported."}
                  </p>
                  {status.hardware.notes.map((note, i) => (
                    <p key={i}>{note}</p>
                  ))}
                  {status.catalog.map((model) => (
                    <article className="rg-chat-card" key={model.id}>
                      <strong>
                        {model.label} · {model.parameters}
                      </strong>
                      <p>{model.description}</p>
                      <p>
                        {model.bytes.toLocaleString("en-US")} bytes ·{" "}
                        {model.recommendedRamGiB} GiB RAM recommended
                      </p>
                      {status.hardware.freeRamGiB < model.recommendedRamGiB && (
                        <p className="rg-chat-warning">
                          Available RAM is below the recommendation; close other
                          apps or choose a smaller model.
                        </p>
                      )}
                      <button
                        type="button"
                        disabled={
                          settingsBusy ||
                          status.selectedId === model.id ||
                          (!status.installed.includes(model.id) &&
                            activeDownload(status))
                        }
                        onClick={() =>
                          void (status.installed.includes(model.id)
                            ? updateSettings({ modelId: model.id })
                            : install(model.id))
                        }
                      >
                        {status.selectedId === model.id
                          ? "Selected"
                          : status.installed.includes(model.id)
                            ? "Select"
                            : "Download"}{" "}
                        {model.label}
                      </button>
                      {status.installed.includes(model.id) && (
                        <button
                          type="button"
                          disabled={settingsBusy || activeDownload(status)}
                          onClick={() => void install(model.id)}
                        >
                          Reinstall {model.parameters} weights
                        </button>
                      )}
                    </article>
                  ))}
                  {status.download && (
                    <div role="status">
                      <p>
                        {status.download.status}:{" "}
                        {status.download.receivedBytes.toLocaleString("en-US")}{" "}
                        / {status.download.totalBytes.toLocaleString("en-US")}{" "}
                        bytes
                      </p>
                      <progress
                        aria-label="Model download progress"
                        max={status.download.totalBytes || 1}
                        value={status.download.receivedBytes}
                      />
                      {status.download.error && (
                        <p className="rg-chat-error">{status.download.error}</p>
                      )}
                      {activeDownload(status) && (
                        <button
                          type="button"
                          onClick={() => {
                            void chatClient
                              .cancelInstall(status.download!.id)
                              .then(() => chatClient.status())
                              .then(setStatus)
                              .catch((e) => setError(errorText(e)));
                          }}
                        >
                          Cancel download
                        </button>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          ) : (
            <>
              <div
                className="rg-chat-transcript"
                role="log"
                aria-label="Assistant conversation"
                aria-live="polite"
              >
                {!turns.length && (
                  <p>
                    {scope
                      ? "Find game objects, inspect connections, or ask how RoGraph works."
                      : "Ask how RoGraph works. Import a snapshot to search your game."}
                  </p>
                )}
                {turns.map((turn, i) => (
                  <section
                    className="rg-chat-turn"
                    key={turn.response.id + ":" + i}
                  >
                    <p className="rg-chat-question">{turn.message}</p>
                    <p>{turn.response.text}</p>
                    {turn.response.cards.map(renderCard)}
                    {turn.response.warnings.map((warning, index) => (
                      <p className="rg-chat-warning" key={index}>
                        {warning}
                      </p>
                    ))}
                    <small>
                      {turn.response.modelUsed
                        ? "Local model assisted"
                        : "Deterministic answer"}{" "}
                      · Help v{turn.response.helpIdentity.appVersion}
                    </small>
                  </section>
                ))}
                {busy && <p role="status">Working…</p>}
              </div>
              <form
                className="rg-chat-composer"
                onSubmit={(event) => {
                  event.preventDefault();
                  void send();
                }}
              >
                <label htmlFor="rg-chat-input">Ask RoGraph</label>
                <textarea
                  id="rg-chat-input"
                  aria-label="Ask RoGraph"
                  ref={input}
                  maxLength={8000}
                  rows={2}
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  onKeyDown={(event) => {
                    if (
                      event.key === "Enter" &&
                      !event.shiftKey &&
                      !event.nativeEvent.isComposing
                    ) {
                      event.preventDefault();
                      void send();
                    }
                  }}
                />
                <div className="rg-chat-actions">
                  <button
                    type="submit"
                    aria-label="Send message"
                    disabled={busy || !historyReady || !message.trim()}
                  >
                    Send
                  </button>
                  {busy && (
                    <button
                      type="button"
                      onClick={() => {
                        cancelPending();
                        setBusy(false);
                      }}
                    >
                      Cancel response
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={busy || !historyReady}
                    onClick={() => {
                      const current = generation.current;
                      setHistoryReady(false);
                      void chatClient
                        .clearHistory(scope)
                        .then(() => {
                          if (generation.current === current)
                            setHistory({ scope: scopeKey, turns: [] });
                        })
                        .catch((e) => {
                          if (generation.current === current)
                            setError(errorText(e));
                        })
                        .finally(() => {
                          if (generation.current === current)
                            setHistoryReady(true);
                        });
                    }}
                  >
                    Clear history
                  </button>
                </div>
              </form>
            </>
          )}
        </div>
      )}
    </div>
  );
}
