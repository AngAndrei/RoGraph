# Local assistant preview validation

Implementation branch: `chat_bot_RAG`. This feature is not merged into main.

The assistant locates objects, connections and paths using revision-pinned graph operations, and retrieves app guidance from `docs/app-functionalities.json`. The optional model interprets natural-language requests; returned facts/actions are built from canonical queries. External context/MCP works without installing a model.

## Model distribution and local installation

Git and the portable release archive contain no weights, model preferences, chat histories or private game inputs. Model settings offers pinned Qwen3.5 Q4_K_M packs at 0.8B, 2B, 4B and 9B. The maintained catalog records upstream revision, exact bytes and SHA-256. The installer verifies length/checksum before activation and supports cancellation; an interrupted transfer restarts rather than resuming. Runtime CPU/Vulkan assets are also verified downloads.

For this machine, Qwen3.5-2B is installed in ignored local storage. Its file is 1,280,835,840 bytes with SHA-256 `aaf42c8b7c3cab2bf3d69c355048d4a0ee9973d48f16c731c0520ee914699223`. The inference runtime is llama.cpp b12359. Other catalog sizes are offered but were not benchmarked here.

## Hardware observations, 14 November 2026

Reference machine: Windows x64, Intel i7-1165G7, approximately 15.7 GiB physical RAM. The installed Vulkan runtime reports Intel Iris Xe (Vulkan0). Driver/device detection alone does not establish offload; runtime status checks actual layer-offload diagnostics.

The 2B model correctly interpreted a named path query and a module lookup in the recorded CPU smoke runs. Representative observations: 5.2–12.0 seconds including a cold model load and path interpretation; approximately 0.9–2.0 seconds for a subsequent module lookup. Runs were performed on an active development desktop, not controlled performance trials. An earlier GPU-runtime run took about 26 seconds cold and 4 seconds warm. Auto therefore prefers CPU for integrated Intel graphics; explicit GPU mode remains selectable for comparison. Dedicated compatible devices can be selected by Auto, with visible CPU fallback on loading failure.

The initial smoke exposed a structurally valid search intent lacking search text. The prompt now includes concrete intent examples, and response validation rejects missing search/trace slots. Updated smoke queries produced correct bounded intents. This is a small compatibility check, not certification of the proposed 120-task model evaluation or universal model/hardware performance.

## Checks

Targeted tests cover maintained-help discovery/version validation, strict contracts, ambiguous/truncated searches, gameplay/code search scope, evidence-backed path/source operations, corrupt/cross-snapshot history, atomic verified downloads/cancellation, runtime intent validation, compact context provenance and floating-window behavior. Real HTTP checks exercise session/Origin protections and model-independent help/history. Browser checks exercise import, floating help, keyboard movement, model choices/mobile geometry and context export.

Full regression run: **309 tests passed across 70 files**. The subsequent scoped UI fix passed **14 UI tests** (including the new source-window regression). Typecheck and production build passed. Edge checks exercise the assistant plus existing source/snapshot flows; their final results are recorded with this branch's task ledger. A fresh engineering review found four Important issues; hardware-cache refresh, actual-status refresh, source navigation and dependency-direction fixes were reviewed and cleared.

Existing parser/import/runtime limitations remain explicit. Separate clean-PC and AMD/NVIDIA device validation, broad model-quality evaluation, semantic retrieval and external-provider token-savings measurements remain unperformed. No token-reduction percentage is claimed.

## Updating functionality

Update `docs/app-functionalities.json` alongside each feature change; its app version must match `package.json`. Help retrieval validates the schema/version and uses a content identity. JSON is bundled into the app, so updates require rebuilding the installed app. Model weights need no retraining when controls change.

## Using the local preview

Launch the rebuilt portable `RoGraph.exe`, then click the robot button at the lower right. Drag its header or focus Move assistant window and use arrow keys. Model settings selects an installed/downloadable pack and Auto/CPU/GPU preference. Normal help and explicit Find/Trace commands work without loading a model. Snapshot-specific results never silently navigate to another game. Use Source or Export context on a result to inspect or hand off the retained evidence.
