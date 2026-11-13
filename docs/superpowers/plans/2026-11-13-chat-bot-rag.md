# RoGraph Local Assistant Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Ship a draggable floating game-navigation/help assistant, selectable local models and CPU/GPU execution, with one installed model on this development machine.

**Architecture:** Keep graph queries deterministic and pin every result to an analysis. Retrieve app functionality from one versioned JSON file. Use a narrow optional local model for intent extraction; display canonical graph/help cards independently of generation. Model weights and runtime downloads stay outside Git and release ZIPs.

**Tech Stack:** Existing TypeScript/Node 24, React, SQLite, Zod, Vitest, Playwright; pinned llama.cpp Windows CPU/Vulkan runtimes and approved GGUF model catalog.

**Spec:** `docs/superpowers/specs/2026-11-13-chat-bot-rag-architecture.md`, including revision 3 product additions below.

## Global Constraints

- Work on `chat_bot_RAG` exactly; push this feature branch, never merge main.
- Keep the user's existing checkout as the local runnable app. Existing graph/native tools and snapshots are preserved.
- GitHub source and portable packages include chatbot code/catalog/help but no model weights or workspace/chat data.
- Approved catalog includes weaker than 2B, 2B, 4B and stronger choices; a user explicitly installs/selects one.
- Probe supported CPU/GPU devices, expose Auto/CPU/GPU choice, report actual backend and visible fallback reason. Never infer GPU availability from a model name or memory size alone.
- The UI is a small fixed robot-head button at the lower right; an expanded movable window is draggable by its header and kept inside the viewport. It remains keyboard accessible on narrow screens.
- One-time approved local downloads, checksum verification, atomic install, cancel and visible progress; no arbitrary URLs/commands from the browser.
- No source edits or automatic sends to external models. Context/MCP works with no chat model.

## Review Focus

- Model downloads interrupted or corrupted: no partial artifact becomes usable; existing selected model survives failure.
- GPU detected but runtime cannot load/offload: CPU fallback is reported and remains usable; explicit GPU errors are visible.
- Duplicate node names or a stale/deleted snapshot: return choices or reject, never silently query another analysis.
- App update or changed help file: file version/hash is checked and steps remain tied to implemented features.
- Drag/resize/window restoration and mobile keyboard: controls remain reachable and chat navigation preserves snapshot scope.

### Task 1: Feature knowledge, contracts and lookup

Files: `docs/app-functionalities.json`, `packages/contracts/src/assistant.ts`, `packages/assistant/src/help.ts`, `tests/assistant-help.test.ts`.

Interfaces: `searchHelp(text, limit): HelpFeature[]`, `helpIdentity`, strict `chatRequestSchema`, `AssistantRequest`, `AssistantResponse`, `AssistantCard`, model/hardware/status types. Response cards carry validated queries/actions rather than generated file paths.

- [ ] Write failing tests for feature discovery (impact vs dependencies, source find), version validation and invalid request scope.
- [ ] Run the targeted test; implement versioned features and strict contracts; rerun green.
- [ ] Commit this task with tests.

### Task 2: Deterministic assistant and compact evidence

Files: `packages/assistant/src/assistant.ts`, `packages/assistant/src/history.ts`, `packages/core/src/context.ts`, `tests/assistant.test.ts`, `tests/assistant-context.test.ts`.

Interfaces: `answerRequest(request, {query, interpret?, signal}): Promise<AssistantResponse>`; `interpret` returns a validated intent with names/operation only. Existing `QueryResult` remains authoritative. File-backed workspace history is bounded, atomic and scoped by analysis; deletion removes relevant history. Compact context serializer emits one representation with byte/estimate metadata.

- [ ] Write failing real-fixture tests for entity search, path endpoints, ambiguous names, help-only mode, injection/invalid IDs and lean context integrity.
- [ ] Implement bounded fixed workflows and server-built result cards; watch targeted tests pass.
- [ ] Commit with tests.

### Task 3: Approved models, installation and hardware-aware runtime

Files: `tools/assistant-models.lock.json`, `apps/local/src/assistant/models.ts`, `hardware.ts`, `runtime.ts`, `tests/assistant-models.test.ts`, `tests/assistant-runtime.test.ts`.

Interfaces: model manager `status/install/cancel/select/remove/close`; runtime `interpret/unload/close`, hardware `detectHardware`. Catalog artifacts carry immutable URL/revision/bytes/SHA256. CPU baseline always works on supported x64; Vulkan device probe decides optional GPU offload. Runtime is authenticated loopback only and owns its child; startup/abort/output bounds enforced.

- [ ] Write failing tests with local HTTP fixtures for checksum/length corruption, interrupted install, selection persistence, unsupported IDs and hardware recommendations.
- [ ] Implement catalog, streaming/atomic downloads and CPU/GPU process lifecycle; use fake executable/provider only at process/network boundary in tests.
- [ ] Download approved runtime/weights locally and run real intent/helper smoke checks. Record resource/backend observations honestly.
- [ ] Commit code/catalog/tests only; keep artifacts ignored.

### Task 4: Authenticated routes, persistence and build

Files: `apps/local/src/assistant/routes.ts`, `apps/local/src/server.ts`, `apps/web/src/api.ts`, `scripts/build.ts`, `scripts/package-windows.ps1`, `tests/assistant-server.test.ts`.

Interfaces: status, models install/select/cancel, chat turn/cancel/history and scoped context endpoints behind existing session/Origin checks; browser API wraps these. Poll download progress separately from cancellable turn response. Server shutdown closes assistant and runtime, snapshot delete removes dependent history.

- [ ] Write failing integration tests for authentication, no-model help, scoped graph queries, invalid model selection and cancellation.
- [ ] Integrate routes and lifecycle, bundle the maintained functionality/catalog assets, preserve no-weights release packaging.
- [ ] Run targeted server tests and typecheck; commit.

### Task 5: Floating draggable chat and model settings

Files: `apps/web/src/chat/ChatWidget.tsx`, `chat.css`, `position.ts`, `apps/web/src/App.tsx`, `tests/ui/chat.test.tsx`, `tests/e2e/assistant.spec.ts`.

Interfaces: widget receives explicit analysis/view/selected ID and `onNavigate(query)`/`onSource(evidence)` callbacks. It shows robot button, movable expanded window, mode selector, candidate/result cards, question/history, model sizes/download progress, Auto/CPU/GPU choice and actual backend. Context preview uses canonical query, not chat text.

- [ ] Write failing UI tests for opening/minimizing, drag clamping, model-free help, candidate navigation and per-analysis reset.
- [ ] Implement accessible pointer/keyboard movement and responsive layout; integrate action routing without changing analysis silently.
- [ ] Run UI and actual Edge flows, then commit.

### Task 6: Verify, package and publish feature branch

Files: architecture, `README.md`, `docs/user-guide.md`, `docs/assistant-validation.md`, relevant notices.

- [ ] Update architecture to revision 3 for model catalog, CPU/GPU and exact floating-window requirements; keep current help records synchronized.
- [ ] Run typecheck, full unit suite, build, affected Edge checks and portable smoke checks; run installed model against actual shop/egg graph requests.
- [ ] Have a fresh reviewer inspect whole change, fix material findings with regressions and rerun affected checks.
- [ ] Produce the local portable app with its installed model in local ignored storage; release ZIP excludes weights.
- [ ] Commit and push `chat_bot_RAG`, verify remote branch and no merge to main. Report exact launch path/backend/model and measured limitations.
