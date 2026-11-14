# Assistant QA and improvements — 14 November 2026

The assistant is suitable as a bounded game-navigation and app-help preview after this pass. It initially failed meaningful user tasks and had a cancellation crash; those reproduced issues are fixed. This is a curated regression evaluation, including cases used to improve the implementation, not a claim of universal AI accuracy.

Changes are on **`chat_bot_RAG`**, with no merge to main. The Windows app on this machine is rebuilt with the existing Qwen3.5-2B Q4_K_M weights preserved. The model catalog remains optional; no weights or private game data enter Git.

## Results

| Check | Result |
| --- | --- |
| Original model-backed user tasks, baseline `8a6d9e2` | 26/32 passed |
| Same 32 task IDs after fixes | 32/32 passed |
| Expanded final user-task evaluation, two fixtures | 42/42 passed |
| No-model supported commands/help, same two fixtures | 37/37 passed |
| Realistic maintained-help questions, correct first feature | 60/87 before; 87/87 after |
| Maintained help labels and example goals | 109/109 correct first feature |
| Live HTTP checks with installed model | 18/18 passed |
| Explicit Vulkan/GPU smoke | 3/3 correct; actual backend confirmed GPU |
| Complete Vitest regression suite | 529 tests across 72 files passed |
| Assistant Edge browser suite | 3 scenarios passed |
| Typecheck and production build | Passed |

The user-task matrix checks named lookup, functions/config from Gameplay, source locators, dependency/impact direction, path direction, reverse/no-path replies, missing/ambiguous nodes, selection, case/quoting, everyday phrasing, unsupported requests and absence of a selected snapshot. The second fixture checks Chicken/Egg Gameplay lookup, connections and directed paths. Factual cards are checked against canonical node/source IDs and retained evidence; queries stay within the selected revision and six-query budget.

HTTP checks include authentication/Origin restrictions, maintained help, real imports, direct and model-backed replies, retry IDs/conflicts, stale analyses, concurrent questions, cancellation during model loading and inference, subsequent model recovery, snapshot-isolated history and exclusion of cancelled answers. The initial cancellation reproduction terminated the service with `TypeError: code.endsWith is not a function`; the final run returns a controlled error and continues serving requests.

Browser checks cover import, themes, docked launcher, drag/native resize and persistence, model settings/mobile geometry, source/context actions, and conversation scrolling. Delayed UI regressions use controlled responses to make races reproducible; real inference is exercised separately by the live HTTP harness.

## Response times on this machine

Windows x64, Intel i7-1165G7 (8 logical CPUs), 15.7 GiB RAM, Intel Iris Xe, llama.cpp b12359, Qwen3.5-2B Q4_K_M. Auto chose CPU. These are wall-clock observations on an active desktop, not controlled throughput benchmarks or a service-level guarantee. Timing excludes file import and UI typing; HTTP figures include response delivery/history work. Direct harness timings exclude HTTP/browser rendering.

| Path | Measured time |
| --- | --- |
| Maintained help over HTTP | 20.64 ms |
| Named lookup / source / path over HTTP | 14.92–32.94 ms |
| Final direct fast path, median / p95 (36 requests) | 3.56 / 13.51 ms |
| CPU model-backed cold request, final direct harness | 6.01 s |
| CPU model-backed warm requests, final direct harness | 0.84–1.42 s |
| CPU model request over HTTP after cancelling initial load | 4.97 s |
| CPU warm model request over HTTP | 0.98 s |
| CPU model request after cancelling inference | 1.96 s |
| Explicit GPU cold / two warm requests | 17.82 / 1.18, 1.48 s |
| Cancellation response after active inference | 3 ms |
| Cancellation during initial weight verification/loading | 1533 ms |

Other cold CPU observations in this pass were roughly 6–8 seconds. The longer loading-cancellation delay occurs while weight checksum verification finishes. GPU selection originally reported CPU incorrectly because default verbosity hid offload diagnostics. At level 4 the loader reports `offloaded 25/25 layers to GPU`, and the app confirms GPU. Auto remains CPU on this Intel integrated device because GPU cold startup is slower; this says nothing about dedicated NVIDIA/AMD performance.

## Repaired behavior

- Cancellation and timeout DOMExceptions have numeric legacy codes. HTTP error normalization now produces string `CANCELLED`/`TIMEOUT` codes instead of crashing the service; native numeric errors become controlled internal errors.
- Common polite/name-oriented questions take the deterministic path. For example, `find the ShopConfig module`, `Could you show me the source code of ShopClient.BuySword?`, and `What uses the ShopConfig module?` now reach the correct canonical operations.
- Action keywords cannot consume the start of identifiers such as `sourceMap`, `source.Map` or `impactZone`. Literal target retrieval precedes prose-wrapper removal; names containing spaces remain searchable without weights.
- Missing selections ask the user to select a node instead of searching for a node literally named “selected node.” Source text-search instructions route to app help even with a game open.
- A failed prose lookup may use one model interpretation; failed interpretation is not retried, request scope/view wins, and a recovered view is honored when no view was pinned. Prompt examples distinguish named targets from selected nodes and source requests from app help.
- Help retrieval handles conversational filler, explicit task phrases and meaningful-term overlap. Unsupported queries no longer silently acquire unrelated instructions from a generic word match. Controls absent from the current UI are documented as unavailable, rather than explained as clickable buttons.
- Maintained instructions now reflect result-card context export, current snapshot controls, model reinstall, last-tab shutdown, theme/privacy controls and chat controls. Tests explicitly reject obsolete compare/startup/removal instructions.
- A reply preserves a newer composer draft. A stale model-status read cannot override a saved selection/backend. New replies scroll into view while the user is near the bottom, and leave the scroll position alone while older messages are being read.

## Architecture decision

Keep the small local model as an optional **intent interpreter**, not the author of game facts. Fast literal retrieval and bounded command handling serve frequent tasks. At most one model attempt handles unfamiliar phrasing; canonical tools resolve its names and construct factual cards. App-help RAG remains a versioned, bundled, maintained JSON registry with lexical/task-alias retrieval. A vector database or whole-game embeddings would add dependencies without a measured benefit for this small registry and navigation scope.

The assistant does not receive the full game in its prompt, infer undocumented runtime behavior, edit game files, or replace external foundation-model analysis. It reports static-evidence and omission limits, and preserves canonical source/context export for deeper analysis.

## Reproduction and raw records

From the repository root, with dependencies/native tools installed and the test model selected:

```powershell
npm test
npm run typecheck
npm run build
npm run test:e2e -- tests/e2e/assistant.spec.ts
node --import tsx scripts/assistant-qa.ts --model --out=build/qa-model.json
node --import tsx scripts/assistant-qa.ts --out=build/qa-no-model.json
node --import tsx scripts/assistant-qa.ts --model --smoke-backend=gpu --out=build/qa-gpu.json
node --import tsx scripts/assistant-qa-http.ts --out=build/qa-http.json
```

GPU smoke temporarily changes the repository model preference and restores it on normal completion. Do not run it concurrently with another inference evaluation. For Edge outside the default install path, set `ROGRAPH_EDGE_EXECUTABLE`. Scripts return a failing exit status when recorded checks fail. Temporary imports/workspaces are deleted; installed weights are not downloaded or replaced.

- [Initial model-backed task records](assistant-qa-baseline-results.json)
- [Final per-question accuracy and timings](assistant-qa-results.json)
- [No-model results](assistant-qa-no-model-results.json)
- [HTTP/cancellation results](assistant-qa-http-results.json)
- [GPU results and actual backend](assistant-qa-gpu-results.json)

## Remaining limits

English was evaluated, on two public synthetic fixtures, with only the installed 2B pack and this machine. These checks do not establish accuracy on every large/private game or unseen paraphrase. Other catalog sizes, dedicated GPUs, other operating systems, long-duration inference stress and a separate clean PC were not evaluated in this pass. Lexical help can still miss unfamiliar wording; naming a saved object or selecting it is the reliable fallback. No universal token-saving or response-time claim is made.
