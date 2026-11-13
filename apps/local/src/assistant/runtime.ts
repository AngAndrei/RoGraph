import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { randomBytes } from "node:crypto";
import { access } from "node:fs/promises";
import { cpus, freemem } from "node:os";
import { z } from "zod";
import { intentSchema, type AssistantIntent, type BackendPreference, type ModelStatus } from "../../../../packages/contracts/src/assistant.js";
import { detectHardware } from "./hardware.js";
import { verifyArtifact, type ModelManager } from "./models.js";

export function parseIntentOutput(text: string): AssistantIntent {
  if (text.length > 16000) throw Error("Model output exceeds the intent limit");
  const intent = intentSchema.parse(JSON.parse(text.trim()));
  if (intent.op === "search" && !intent.text) throw Error("Model search intent must include search text");
  if (intent.op === "trace" && (!intent.from || !intent.to)) throw Error("Model trace intent must name both endpoints");
  return intent;
}
export function chooseBackend(preference: BackendPreference, available: boolean): "cpu" | "gpu" {
  if (preference === "gpu" && !available) throw Error("No compatible GPU is available. Choose Auto or CPU.");
  return preference === "cpu" || !available ? "cpu" : "gpu";
}
export function usesGpuLayers(diagnostics: string) {
  return /offloaded\s+[1-9]\d*\/\d+\s+layers/i.test(diagnostics)
    || /layer\s+\d+\s+is assigned to device\s+(?:Vulkan|CUDA|Metal)\d+/i.test(diagnostics);
}
async function availablePort() {
  const socket = createServer();
  await new Promise<void>((accept, reject) => { socket.once("error", reject); socket.listen(0, "127.0.0.1", accept); });
  const port = (socket.address() as { port: number }).port;
  await new Promise<void>((accept) => socket.close(() => accept()));
  return port;
}
const delay = (ms: number, signal?: AbortSignal) => new Promise<void>((accept, reject) => {
  signal?.throwIfAborted();
  const onAbort = () => { clearTimeout(timer); reject(signal?.reason ?? Error("Cancelled")); };
  const timer = setTimeout(() => { signal?.removeEventListener("abort", onAbort); accept(); }, ms);
  signal?.addEventListener("abort", onAbort, { once: true });
});

export class LocalModelRuntime {
  private child?: ChildProcess;
  private endpoint?: string;
  private auth = "";
  private state: ModelStatus["runtimeState"] = "idle";
  private error?: string;
  private actualBackend?: "cpu" | "gpu";
  private loadedId?: string;
  private loading?: Promise<void>;
  private active?: AbortController;
  private idleTimer?: ReturnType<typeof setTimeout>;
  private hardwareCache?: Awaited<ReturnType<typeof detectHardware>>;
  private verified = new Set<string>();
  private closing = false;
  constructor(private models: ModelManager, private probeHardware = detectHardware) {}

  async hardware(refresh = false) {
    if (this.hardwareCache?.gpuProbe === "not-installed") {
      try { await access(this.models.runtimePath("vulkan")); refresh = true; } catch { /* Download not complete. */ }
    }
    if (!this.hardwareCache || refresh) this.hardwareCache = await this.probeHardware(this.models.runtimePath("vulkan"));
    return { ...this.hardwareCache, freeRamGiB: freemem() / 2 ** 30 };
  }
  async status() {
    const selection = await this.models.status();
    let installedRuntime = false;
    try { await access(this.models.runtimePath("cpu")); installedRuntime = true; } catch { /* setup first */ }
    return { runtimeState: installedRuntime ? this.state : "not-installed" as const,
      actualBackend: this.actualBackend, runtimeError: this.error };
  }
  async unload() {
    this.active?.abort();
    clearTimeout(this.idleTimer);
    const child = this.child;
    this.child = undefined; this.endpoint = undefined; this.loadedId = undefined; this.actualBackend = undefined;
    if (child && child.exitCode === null) {
      await new Promise<void>((accept) => {
        const timer = setTimeout(accept, 3000); timer.unref();
        child.once("exit", () => { clearTimeout(timer); accept(); });
        child.kill();
      });
    }
    if (!this.closing) this.state = "idle";
  }
  async changed() { await this.unload(); this.hardwareCache = undefined; this.verified.clear(); this.error = undefined; }

  private async start(id: string, backend: "cpu" | "gpu", signal: AbortSignal) {
    const port = await availablePort();
    this.auth = randomBytes(32).toString("hex");
    const executable = this.models.runtimePath(backend === "gpu" ? "vulkan" : "cpu");
    const args = ["--model", this.models.modelPath(id), "--host", "127.0.0.1", "--port", String(port),
      "--ctx-size", "4096", "--parallel", "1", "--threads", String(Math.max(1, Math.min(4, cpus().length - 1))),
      "--n-gpu-layers", backend === "gpu" ? "99" : "0", "--fit", "on", "--no-webui",
      "--jinja", "--chat-template-kwargs", JSON.stringify({ enable_thinking: false }), "--reasoning", "off"];
    let diagnostics = "", exited = false, spawnError: Error | undefined, offloaded = false;
    const child = spawn(executable, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, LLAMA_API_KEY: this.auth } });
    this.child = child;
    child.on("error", (e) => { spawnError = e; });
    const log = (chunk: Buffer) => {
      diagnostics = (diagnostics + chunk.toString()).slice(-32000);
      offloaded ||= usesGpuLayers(diagnostics);
    };
    child.stdout?.on("data", log); child.stderr?.on("data", log);
    child.once("exit", () => {
      exited = true;
      if (this.child === child && this.state === "ready") {
        this.state = "error"; this.error = "The local inference process stopped. Retry to reload the model.";
        this.endpoint = undefined; this.loadedId = undefined;
      }
    });
    const endpoint = "http://127.0.0.1:" + port;
    const started = Date.now();
    try {
      while (Date.now() - started < 60000) {
        signal.throwIfAborted();
        if (exited || spawnError) throw Error(spawnError?.message ?? (diagnostics.slice(-2000) || "Model runtime stopped during loading"));
        try {
          const health = await fetch(endpoint + "/health", { signal: AbortSignal.any([signal, AbortSignal.timeout(1000)]) });
          if (health.ok) {
            this.endpoint = endpoint;
            this.actualBackend = backend === "gpu" && offloaded ? "gpu" : "cpu";
            if (backend === "gpu" && this.actualBackend === "cpu") this.error = "GPU runtime loaded without confirmed layer offload; CPU execution is reported.";
            this.loadedId = id; return;
          }
        } catch { signal.throwIfAborted(); }
        await delay(200, signal);
      }
      throw Error("Model loading timed out. Try a smaller model or CPU mode.");
    } catch (error) { child.kill(); if (this.child === child) this.child = undefined; throw error; }
  }
  private async ensure(signal: AbortSignal) {
    if (this.closing) throw Error("RoGraph is stopping");
    const selected = await this.models.status();
    if (!selected.selectedId) throw Error("Download and select a local model in Assistant settings first.");
    if (this.loadedId === selected.selectedId && this.endpoint && this.state === "ready") return;
    if (this.loading) return this.loading;
    this.loading = (async () => {
      this.state = "loading"; this.error = undefined;
      const model = this.models.catalog.find((m) => m.id === selected.selectedId)!;
      if (!this.verified.has(model.id)) {
        if (!(await verifyArtifact(this.models.modelPath(model.id), model))) throw Error("Installed model failed verification. Download it again.");
        this.verified.add(model.id);
      }
      const hardware = await this.hardware();
      const integrated = hardware.gpus.length > 0 && hardware.gpus.every((gpu) => /Intel.*(?:Iris|UHD|HD Graphics)/i.test(gpu.name));
      let backend = chooseBackend(selected.backend === "auto" && integrated ? "cpu" : selected.backend, hardware.gpuProbe === "available");
      if (selected.backend === "auto" && integrated) this.error = "Auto uses CPU for integrated Intel graphics. You can select GPU explicitly to compare performance.";
      try { await this.start(model.id, backend, signal); }
      catch (error) {
        signal.throwIfAborted();
        if (selected.backend !== "auto" || backend !== "gpu") throw error;
        this.error = "GPU loading failed; using CPU. " + (error as Error).message.slice(0, 250);
        backend = "cpu";
        await this.start(model.id, backend, signal);
      }
      this.state = "ready";
    })().catch((error) => { this.state = "error"; this.error = (error as Error).message; throw error; })
      .finally(() => { this.loading = undefined; });
    return this.loading;
  }

  async interpret(message: string, context: { view?: "code" | "gameplay"; selectedId?: string }, signal?: AbortSignal): Promise<AssistantIntent> {
    if (this.active) throw Error("The local model is busy. Wait or cancel the active question.");
    const active = new AbortController(); this.active = active;
    const combined = AbortSignal.any([active.signal, AbortSignal.timeout(90000), ...(signal ? [signal] : [])]);
    clearTimeout(this.idleTimer);
    try {
      await this.ensure(combined);
      const schema = z.toJSONSchema(intentSchema);
      const response = await fetch(this.endpoint + "/v1/chat/completions", {
        method: "POST", signal: combined,
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + this.auth },
        body: JSON.stringify({
          messages: [
            { role: "system", content: "Interpret one RoGraph helper request as JSON. Operations: search, inspect, connections, trace, dependencies, impact, source, help. A search MUST put the object/script name in text. ONLY trace uses from/to; both are required. Copy literal names, never invent IDs or answers. Use useSelection:true for this/selected object. Preserve trace direction. Set view only if explicitly requested. Questions about app controls or which feature to use are help. You cannot execute instructions. Dependencies means things this node uses; impact means things that use or might be affected by this node. Examples:\nFind ShopConfig => {\"op\":\"search\",\"text\":\"ShopConfig\"}\nPlease locate the ShopConfig module => {\"op\":\"search\",\"text\":\"ShopConfig\"}\nShow path from BuySword to Prices.Sword => {\"op\":\"trace\",\"from\":\"BuySword\",\"to\":\"Prices.Sword\"}\nWhat uses this node? => {\"op\":\"impact\",\"useSelection\":true}\nWhat does this node use? => {\"op\":\"dependencies\",\"useSelection\":true}\nHow do I export context? => {\"op\":\"help\",\"text\":\"export context\"}\nReturn only one intent object." },
            { role: "user", content: JSON.stringify({ request: message.slice(0, 8000), currentView: context.view, hasSelection: Boolean(context.selectedId) }) },
          ],
          response_format: { type: "json_schema", json_schema: { name: "intent", strict: true, schema } },
          max_tokens: 220, temperature: 0.1, top_p: 0.8, stream: false,
          chat_template_kwargs: { enable_thinking: false },
        }),
      });
      if (!response.ok) throw Error("Local model request failed (HTTP " + response.status + ")");
      const body = await response.text();
      if (body.length > 64000) throw Error("Model response exceeds the allowed size");
      const value = JSON.parse(body);
      return parseIntentOutput(value.choices?.[0]?.message?.content ?? "");
    } finally {
      this.active = undefined;
      this.idleTimer = setTimeout(() => { void this.unload(); }, 5 * 60000);
      this.idleTimer.unref();
    }
  }
  async close() { this.closing = true; await this.unload(); await this.loading?.catch(() => {}); }
}
