// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChatWidget } from "../../apps/web/src/chat/ChatWidget.js";
import { clampPosition } from "../../apps/web/src/chat/position.js";
import type {
  AssistantResponse,
  ModelStatus,
} from "../../packages/contracts/src/assistant.js";

const status: ModelStatus = {
  catalog: [
    {
      id: "small",
      label: "Qwen 0.8B",
      parameters: "0.8B",
      description: "Fast local model",
      fileName: "small.gguf",
      url: "https://example.test/model",
      bytes: 1234567890,
      sha256: "a",
      recommendedRamGiB: 4,
      license: "Apache",
      upstream: "Qwen",
    },
  ],
  installed: [],
  backend: "auto",
  runtimeState: "not-installed",
  hardware: {
    platform: "win32",
    arch: "x64",
    cpu: "CPU",
    logicalCpus: 8,
    totalRamGiB: 8,
    freeRamGiB: 2,
    gpus: [],
    gpuProbe: "not-installed",
    notes: ["GPU runtime not installed"],
  },
  helpIdentity: { appVersion: "0.2.0", sha256: "hash" },
};
const response: AssistantResponse = {
  id: "r",
  conversationId: "c",
  text: "Use the search field",
  cards: [],
  warnings: [],
  modelUsed: false,
  helpIdentity: status.helpIdentity,
};
const props = {
  view: "code" as const,
  onNavigate: vi.fn(),
  onSource: vi.fn(),
  onContext: vi.fn(),
};
let requests: { url: string; init?: RequestInit }[];
beforeEach(() => {
  requests = [];
  localStorage.clear();
  sessionStorage.clear();
  sessionStorage.setItem("rograph-session:" + location.host, "test-session");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      requests.push({ url, init });
      return new Response(
        JSON.stringify(
          url.includes("/status") || url.includes("/settings")
            ? status
            : url.includes("/history")
              ? { turns: [] }
              : response,
        ),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("clamps the complete window within a narrow viewport and ignores non-finite positions", () => {
  expect(
    clampPosition(
      { x: 999, y: -40 },
      { width: 390, height: 700 },
      { width: 374, height: 600 },
    ),
  ).toEqual({ x: 8, y: 8 });
  expect(
    clampPosition(
      { x: NaN, y: Infinity },
      { width: 390, height: 700 },
      { width: 374, height: 600 },
    ),
  ).toEqual({ x: 8, y: 8 });
});
it("opens and minimizes the accessible floating assistant before an import", async () => {
  render(<ChatWidget {...props} />);
  await userEvent.click(
    screen.getByRole("button", { name: "Open RoGraph assistant" }),
  );
  expect(
    screen.getByRole("dialog", { name: "RoGraph assistant" }),
  ).toBeTruthy();
  expect(screen.getByRole("button", { name: "Model settings" })).toBeTruthy();
  await userEvent.click(
    screen.getByRole("button", { name: "Minimize assistant" }),
  );
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(
    screen.getByRole("button", { name: "Open RoGraph assistant" }),
  ).toBeTruthy();
});
it("answers model-free help through authenticated HTTP and exposes backend settings", async () => {
  render(<ChatWidget {...props} />);
  await userEvent.click(
    screen.getByRole("button", { name: "Open RoGraph assistant" }),
  );
  await userEvent.selectOptions(
    screen.getByRole("combobox", { name: "Assistant mode" }),
    "help",
  );
  await userEvent.type(
    screen.getByRole("textbox", { name: "Ask RoGraph" }),
    "How do I search?",
  );
  await userEvent.click(screen.getByRole("button", { name: "Send message" }));
  expect(await screen.findByText("Use the search field")).toBeTruthy();
  const turn = requests.find((r) => r.url === "/api/chat/turns")!;
  expect(new Headers(turn.init?.headers).get("X-RoGraph-Session")).toBe(
    "test-session",
  );
  expect(JSON.parse(turn.init!.body as string)).toMatchObject({
    mode: "help",
    message: "How do I search?",
  });
  await userEvent.click(screen.getByRole("button", { name: "Model settings" }));
  expect(screen.getByText(/1,234,567,890 bytes/)).toBeTruthy();
  expect(screen.getByText(/Free RAM: 2/)).toBeTruthy();
  const backend = screen.getByRole("combobox", { name: "Inference backend" });
  expect(
    Array.from((backend as HTMLSelectElement).options).map((o) => o.text),
  ).toEqual(["Auto", "CPU", "GPU"]);
  await userEvent.selectOptions(backend, "cpu");
  await waitFor(() =>
    expect(
      requests.some(
        (r) =>
          r.url === "/api/assistant/settings" &&
          r.init?.body === '{"backend":"cpu"}',
      ),
    ).toBe(true),
  );
});
it("discards late history when the selected snapshot changes", async () => {
  let release!: (r: Response) => void;
  const original = fetch;
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) =>
      url === "/api/chat/history?analysisId=old"
        ? new Promise<Response>((resolve) => {
            release = resolve;
          })
        : original(url, init),
    ),
  );
  const view = render(<ChatWidget {...props} analysisId="old" />);
  await userEvent.click(
    screen.getByRole("button", { name: "Open RoGraph assistant" }),
  );
  await waitFor(() => expect(release).toBeTruthy());
  view.rerender(<ChatWidget {...props} analysisId="new" />);
  await act(async () => {
    release(
      new Response(
        JSON.stringify({
          turns: [{ message: "Stale old snapshot", response }],
        }),
      ),
    );
  });
  await waitFor(() =>
    expect(
      requests.some((r) => r.url === "/api/chat/history?analysisId=new"),
    ).toBe(true),
  );
  expect(screen.queryByText("Stale old snapshot")).toBeNull();
});
it("routes canonical cards and minimizes before opening context", async () => {
  const query = { op: "inspect" as const, analysisId: "a", nodeId: "shop" };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      requests.push({ url, init });
      return new Response(
        JSON.stringify(
          url.includes("/status")
            ? status
            : url.includes("/history")
              ? { turns: [] }
              : {
                  ...response,
                  cards: [{ kind: "node", id: "shop", label: "Shop", query }],
                },
        ),
      );
    }),
  );
  render(<ChatWidget {...props} analysisId="a" />);
  await userEvent.click(
    screen.getByRole("button", { name: "Open RoGraph assistant" }),
  );
  await userEvent.type(
    screen.getByRole("textbox", { name: "Ask RoGraph" }),
    "shop",
  );
  await userEvent.click(screen.getByRole("button", { name: "Send message" }));
  await userEvent.click(
    await screen.findByRole("button", { name: "Inspect Shop" }),
  );
  expect(props.onNavigate).toHaveBeenCalledWith(query);
  await userEvent.click(
    screen.getByRole("button", { name: "Export context for Shop" }),
  );
  expect(props.onContext).toHaveBeenCalledWith(query);
  expect(
    screen.queryByRole("dialog", { name: "RoGraph assistant" }),
  ).toBeNull();
  expect(
    screen.getByRole("button", { name: "Open RoGraph assistant" }),
  ).toBeTruthy();
});
it("renders structured HTTP errors clearly", async () => {
  const original = fetch;
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) =>
      url === "/api/chat/turns"
        ? Promise.resolve(
            new Response(
              JSON.stringify({
                error: { message: "Snapshot was deleted. Import it again." },
              }),
              { status: 409 },
            ),
          )
        : original(url, init),
    ),
  );
  render(<ChatWidget {...props} analysisId="a" />);
  await userEvent.click(
    screen.getByRole("button", { name: "Open RoGraph assistant" }),
  );
  await userEvent.type(
    screen.getByRole("textbox", { name: "Ask RoGraph" }),
    "shop",
  );
  await userEvent.click(screen.getByRole("button", { name: "Send message" }));
  expect(await screen.findByRole("alert")).toHaveProperty(
    "textContent",
    "Snapshot was deleted. Import it again.",
  );
});
it("aborts and deletes the active turn when the snapshot changes", async () => {
  let signal: AbortSignal | undefined;
  let release!: (r: Response) => void;
  const original = fetch;
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/chat/turns") {
        signal = init?.signal ?? undefined;
        return new Promise<Response>((resolve) => {
          release = resolve;
        });
      }
      return original(url, init);
    }),
  );
  const view = render(<ChatWidget {...props} analysisId="a" />);
  await userEvent.click(
    screen.getByRole("button", { name: "Open RoGraph assistant" }),
  );
  await userEvent.type(
    screen.getByRole("textbox", { name: "Ask RoGraph" }),
    "shop",
  );
  await userEvent.click(screen.getByRole("button", { name: "Send message" }));
  await waitFor(() => expect(signal).toBeTruthy());
  view.rerender(<ChatWidget {...props} analysisId="b" />);
  expect(signal?.aborted).toBe(true);
  await waitFor(() =>
    expect(
      requests.some(
        (r) =>
          r.url.startsWith("/api/chat/turns/") && r.init?.method === "DELETE",
      ),
    ).toBe(true),
  );
  await act(async () => {
    release(
      new Response(
        JSON.stringify({ ...response, text: "Old snapshot answer" }),
      ),
    );
  });
  expect(screen.queryByText("Old snapshot answer")).toBeNull();
});
it("keeps keyboard movement and resizing in the viewport", async () => {
  vi.stubGlobal("innerWidth", 390);
  vi.stubGlobal("innerHeight", 700);
  render(<ChatWidget {...props} />);
  await userEvent.click(
    screen.getByRole("button", { name: "Open RoGraph assistant" }),
  );
  const header = screen.getByRole("button", { name: "Move assistant window" });
  fireEvent.keyDown(header, { key: "ArrowRight" });
  const dialog = screen.getByRole("dialog");
  expect(dialog.style.left).toBe("32px");
  expect(dialog.style.width).toBe("350px");
  vi.stubGlobal("innerHeight", 350);
  fireEvent(window, new Event("resize"));
  expect(dialog.style.top).toBe("8px");
  expect(dialog.style.height).toBe("334px");
});
it.each([false, true])(
  "refreshes runtime status after a turn (failed=%s)",
  async (failed) => {
    let current: ModelStatus = { ...status, runtimeState: "idle" };
    let statusReads = 0;
    const original = fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init?: RequestInit) => {
        if (url === "/api/assistant/status") {
          statusReads++;
          return Promise.resolve(new Response(JSON.stringify(current)));
        }
        if (url === "/api/chat/turns") {
          current = {
            ...status,
            actualBackend: "cpu",
            runtimeState: failed ? "error" : "ready",
            runtimeError: failed
              ? "GPU failed; CPU fallback unavailable"
              : undefined,
          };
          return Promise.resolve(
            new Response(
              JSON.stringify(
                failed ? { error: { message: "Inference failed" } } : response,
              ),
              { status: failed ? 500 : 200 },
            ),
          );
        }
        return original(url, init);
      }),
    );
    render(<ChatWidget {...props} analysisId="a" />);
    await userEvent.click(
      screen.getByRole("button", { name: "Open RoGraph assistant" }),
    );
    await waitFor(() => expect(statusReads).toBe(1));
    await userEvent.type(
      screen.getByRole("textbox", { name: "Ask RoGraph" }),
      "shop",
    );
    await userEvent.click(screen.getByRole("button", { name: "Send message" }));
    await waitFor(() => expect(statusReads).toBe(2));
    await userEvent.click(
      screen.getByRole("button", { name: "Model settings" }),
    );
    expect(
      await screen.findByText(
        new RegExp(
          `Actual backend: CPU.*Runtime: ${failed ? "error" : "ready"}`,
        ),
      ),
    ).toBeTruthy();
    if (failed)
      expect(
        screen.getByText("GPU failed; CPU fallback unavailable"),
      ).toBeTruthy();
  },
);
it("refreshes status when model settings opens", async () => {
  let current = status;
  const original = fetch;
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) =>
      url === "/api/assistant/status"
        ? Promise.resolve(new Response(JSON.stringify(current)))
        : original(url, init),
    ),
  );
  render(<ChatWidget {...props} />);
  await userEvent.click(
    screen.getByRole("button", { name: "Open RoGraph assistant" }),
  );
  await userEvent.click(screen.getByRole("button", { name: "Model settings" }));
  expect(await screen.findByText(/Actual backend: Not running/)).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "Model settings" }));
  current = { ...status, runtimeState: "ready", actualBackend: "gpu" };
  await userEvent.click(screen.getByRole("button", { name: "Model settings" }));
  expect(
    await screen.findByText(/Actual backend: GPU.*Runtime: ready/),
  ).toBeTruthy();
});
it("reinstalls installed weights and prevents another repair during download", async () => {
  let current: ModelStatus = {
    ...status,
    installed: ["small"],
    selectedId: "small",
  };
  const original = fetch;
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/assistant/status")
        return Promise.resolve(new Response(JSON.stringify(current)));
      if (url === "/api/assistant/models/install") {
        requests.push({ url, init });
        current = {
          ...current,
          download: {
            id: "d",
            modelId: "small",
            status: "downloading",
            receivedBytes: 100,
            totalBytes: 1000,
          },
        };
        return Promise.resolve(new Response(JSON.stringify(current.download)));
      }
      return original(url, init);
    }),
  );
  render(<ChatWidget {...props} />);
  await userEvent.click(
    screen.getByRole("button", { name: "Open RoGraph assistant" }),
  );
  await userEvent.click(screen.getByRole("button", { name: "Model settings" }));
  const repair = await screen.findByRole("button", {
    name: "Reinstall 0.8B weights",
  });
  await userEvent.click(repair);
  await waitFor(() =>
    expect(
      requests.find((r) => r.url === "/api/assistant/models/install")?.init
        ?.body,
    ).toBe('{"modelId":"small"}'),
  );
  await waitFor(() =>
    expect((repair as HTMLButtonElement).disabled).toBe(true),
  );
});
it("aborts a status refresh and ignores its late result after a snapshot change", async () => {
  let statusReads = 0;
  let release!: (r: Response) => void;
  let signal: AbortSignal | undefined;
  const original = fetch;
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/assistant/status") {
        statusReads++;
        if (statusReads === 2) {
          signal = init?.signal ?? undefined;
          return new Promise<Response>((resolve) => {
            release = resolve;
          });
        }
        return Promise.resolve(
          new Response(
            JSON.stringify({
              ...status,
              runtimeState: "ready",
              actualBackend: "cpu",
            }),
          ),
        );
      }
      return original(url, init);
    }),
  );
  const view = render(<ChatWidget {...props} analysisId="a" />);
  await userEvent.click(
    screen.getByRole("button", { name: "Open RoGraph assistant" }),
  );
  await userEvent.type(
    screen.getByRole("textbox", { name: "Ask RoGraph" }),
    "shop",
  );
  await userEvent.click(screen.getByRole("button", { name: "Send message" }));
  await waitFor(() => expect(release).toBeTruthy());
  view.rerender(<ChatWidget {...props} analysisId="b" />);
  expect(signal?.aborted).toBe(true);
  await act(async () => {
    release(
      new Response(
        JSON.stringify({
          ...status,
          runtimeError: "Stale runtime failure",
          runtimeState: "error",
        }),
      ),
    );
  });
  await userEvent.click(screen.getByRole("button", { name: "Model settings" }));
  expect(
    await screen.findByText(/Actual backend: CPU.*Runtime: ready/),
  ).toBeTruthy();
  expect(screen.queryByText("Stale runtime failure")).toBeNull();
});
it("minimizes source-query cards before navigating to the source window", async () => {
  const query = {
    op: "source" as const,
    analysisId: "a",
    sourceId: "source-1",
    startByte: 10,
    endByte: 25,
  };
  const original = fetch;
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) =>
      url === "/api/chat/turns"
        ? Promise.resolve(
            new Response(
              JSON.stringify({
                ...response,
                cards: [
                  {
                    kind: "notice",
                    id: "source-only",
                    label: "Source match",
                    query,
                  },
                ],
              }),
            ),
          )
        : original(url, init),
    ),
  );
  const onNavigate = vi.fn();
  render(<ChatWidget {...props} analysisId="a" onNavigate={onNavigate} />);
  await userEvent.click(
    screen.getByRole("button", { name: "Open RoGraph assistant" }),
  );
  await userEvent.type(
    screen.getByRole("textbox", { name: "Ask RoGraph" }),
    "open source",
  );
  await userEvent.click(screen.getByRole("button", { name: "Send message" }));
  await userEvent.click(
    await screen.findByRole("button", { name: "Inspect Source match" }),
  );
  expect(onNavigate).toHaveBeenCalledWith(query);
  expect(
    screen.queryByRole("dialog", { name: "RoGraph assistant" }),
  ).toBeNull();
  expect(
    screen.getByRole("button", { name: "Open RoGraph assistant" }),
  ).toBeTruthy();
});
it("uses the compact AI Assistant header without a reset-position control", async () => {
  render(<ChatWidget {...props} />);
  await userEvent.click(
    screen.getByRole("button", { name: "Open RoGraph assistant" }),
  );
  expect(
    screen.getByRole("button", { name: "Move assistant window" }).textContent,
  ).toBe("AI Assistant");
  expect(
    screen.queryByRole("button", { name: "Reset assistant position" }),
  ).toBeNull();
  const dialog = screen.getByRole("dialog");
  expect(dialog.style.width).toBe("350px");
  expect(dialog.style.height).toBe("440px");
  expect(screen.getByRole("button", { name: "Send message" }).textContent).toBe(
    "",
  );
});
it("moves the minimized launcher into the graph slot and restores fallback when it unmounts", async () => {
  render(<ChatWidget {...props} />);
  const controls = document.createElement("div");
  controls.className = "graph-controls";
  const fit = document.createElement("button");
  fit.setAttribute("aria-label", "Fit graph");
  const slot = document.createElement("span");
  slot.id = "rograph-assistant-under-fit";
  controls.append(fit, slot);
  await act(async () => {
    document.body.append(controls);
  });
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Open RoGraph assistant" })
        .parentElement,
    ).toBe(slot),
  );
  expect(fit.nextElementSibling).toBe(slot);
  await userEvent.click(
    screen.getByRole("button", { name: "Open RoGraph assistant" }),
  );
  expect(slot.childElementCount).toBe(0);
  await userEvent.click(
    screen.getByRole("button", { name: "Minimize assistant" }),
  );
  expect(
    screen.getByRole("button", { name: "Open RoGraph assistant" })
      .parentElement,
  ).toBe(slot);
  await act(async () => {
    controls.remove();
  });
  await waitFor(() =>
    expect(
      screen
        .getByRole("button", { name: "Open RoGraph assistant" })
        .closest(".rg-chat-root"),
    ).toBeTruthy(),
  );
});
it("persists user-resized dimensions while preserving them through viewport clamps", async () => {
  let notify!: ResizeObserverCallback;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: ResizeObserverCallback) {
        notify = callback;
      }
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  );
  const view = render(<ChatWidget {...props} />);
  await userEvent.click(
    screen.getByRole("button", { name: "Open RoGraph assistant" }),
  );
  const dialog = screen.getByRole("dialog");
  const measured = vi
    .spyOn(dialog, "getBoundingClientRect")
    .mockReturnValue({ width: 480, height: 510 } as DOMRect);
  await act(async () => {
    notify(
      [
        {
          target: dialog,
          contentRect: dialog.getBoundingClientRect(),
          borderBoxSize: [],
          contentBoxSize: [],
          devicePixelContentBoxSize: [],
        },
      ],
      {} as ResizeObserver,
    );
  });
  measured.mockRestore();
  expect(dialog.style.width).toBe("480px");
  expect(dialog.style.height).toBe("510px");
  vi.stubGlobal("innerWidth", 390);
  vi.stubGlobal("innerHeight", 400);
  fireEvent(window, new Event("resize"));
  expect(dialog.style.width).toBe("374px");
  expect(dialog.style.height).toBe("384px");
  const clampedMeasurement = vi
    .spyOn(dialog, "getBoundingClientRect")
    .mockReturnValue({ width: 374, height: 384 } as DOMRect);
  await act(async () => {
    notify([], {} as ResizeObserver);
  });
  clampedMeasurement.mockRestore();
  vi.stubGlobal("innerWidth", 1024);
  vi.stubGlobal("innerHeight", 768);
  fireEvent(window, new Event("resize"));
  expect(dialog.style.width).toBe("480px");
  expect(dialog.style.height).toBe("510px");
  view.unmount();
  render(<ChatWidget {...props} />);
  await userEvent.click(
    screen.getByRole("button", { name: "Open RoGraph assistant" }),
  );
  expect(screen.getByRole("dialog").style.width).toBe("480px");
});
