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
  expect(dialog.style.left).toBe("8px");
  expect(dialog.style.width).toBe("374px");
  vi.stubGlobal("innerHeight", 350);
  fireEvent(window, new Event("resize"));
  expect(dialog.style.top).toBe("8px");
  expect(dialog.style.height).toBe("334px");
});
