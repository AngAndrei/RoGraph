# RoGraph

Understand how a Roblox game connects, with evidence that humans and AI agents can inspect.

RoGraph reads a saved **`.rbxlx` XML or `.rbxl` binary place** or a **Rojo project**. **Gameplay** connects actual models, tools, GUI controls, scripts and configurations through supported interactions and effects. **Code** retains function/module dependencies and configuration inspection. Both views share one revision-pinned graph and source evidence.

Nodes use real project names. A cloned Egg is represented through its actual Egg template and the source operation; the viewer does not invent a “symbolic spawned egg” object. Player references are anchored to the saved Players service, with runtime role paths in the evidence. Unknown/candidate sites remain inspectable without flooding the gameplay canvas with placeholders.

## Try the Windows app

Extract the portable package into a writable folder and open **RoGraph.exe**. Your browser opens the local explorer. Choose a `.rbxlx` or `.rbxl` file and click **Analyze**. `samples/gameplay.rbxlx` demonstrates Chicken → controller → Egg/config connections; `samples/shop.rbxlx` demonstrates Code inspection and remote/config tracing. Reimport older snapshots to generate gameplay relationships. No Roblox login, model account, API key, Node installation, or cloud upload is required to use the package.

- Search scripts, functions, fields, or any saved object; expand the hierarchy for geometry.
- Select a node to inspect its incoming/outgoing relationships and retained occurrences.
- Open **Source** for exact decoded code and revision/byte/line locators.
- Switch to **Code** and trace `ShopClient.BuySword` to `ShopConfig.Prices.Sword` to follow a potential client → remote → server-handler → method → configuration path.
- Export a bounded JSON/Markdown context pack, or connect an agent through read-only MCP.
- Use **Stop app** to stop the service and its owned workers. Closing a browser tab alone leaves the local app running.

This is static saved-file analysis. It does not execute game code or prove runtime behavior. Studio runtime capture is deferred. Rojo imports cover their configured project; Studio-only objects are outside that input.

See the [user guide](docs/user-guide.md), [agent setup](docs/agent-setup.md), [troubleshooting](docs/troubleshooting.md), and [measured performance](docs/performance.md). The preview has been tested with synthetic fixtures and three supplied games; see [provided-game validation](docs/provided-game-validation.md) for partial-import and parsing limits. A separate clean PC remains untested.

## Development on Windows

The tested toolchain is Node 24.19.0, npm 11.17.0, Rust 1.90.0 with the MSVC toolchain, Visual Studio 2022 C++ Build Tools/Windows SDK, and CMake 3.31 or newer. Pins are recorded in [versions.lock.json](tools/versions.lock.json). Network access is needed for initial dependencies and pinned source downloads, then the built app works locally.

```powershell
npm ci
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/bootstrap-tools.ps1
npm run build:native
npm run typecheck
npm test
npm run build
npm run test:e2e
npm run dev
```

Browser tests use Microsoft Edge. `npm run bench -- --profile release --output build/release-benchmark.json` also needs PowerShell 7 for memory sampling. `npm run package:windows` creates `dist/windows-x64/` and `dist/RoGraph-0.2.0-windows-x64.zip`; run `scripts/release-smoke.ps1` against the package before sharing it.

## Command line

The portable executable forwards arguments without a shell. During development, replace `RoGraph.exe` with `node --import tsx apps/local/src/cli.ts` from this checkout.

```powershell
RoGraph.exe analyze --input game.rbxlx --workspace .rograph
RoGraph.exe analyze --rojo default.project.json --workspace .rograph
RoGraph.exe query --workspace .rograph --analysis <analysis-id> --request query.json
RoGraph.exe export --workspace .rograph --analysis <analysis-id> --format graph --output graph.json
RoGraph.exe mcp --workspace .rograph
```

Query files contain an operation such as `search`, `inspect`, `explain`, `implementation`, `dependencies`, `impact`, `trace`, `source`, or `coverage`, and can select `"view":"gameplay"` or `"view":"code"`. Omitted views retain Code compatibility; the UI explicitly defaults to Gameplay. The CLI also accepts `--view gameplay`. Every query pins an analysis ID. CLI progress/errors go to stderr; results go to stdout. Full `graph` export is separate from bounded agent context.

The optional local assistant/model weights and Studio observations remain future updates. Deterministic analysis requires neither. See the [accepted architecture](docs/superpowers/specs/2026-10-31-gameplay-semantic-architecture-design.md) and [implementation plan](docs/superpowers/plans/2026-10-31-gameplay-implementation.md).

## Implementation

- `native/rbx-import`: Roblox XML/DOM importer with raw-input retention.
- `native/luau-parser`: official pinned Luau parser, with lossless JSON serialization for binary strings and non-finite literals.
- `packages/core`: typed resolution, evidence, SQLite snapshots, bounded queries, context, differences, and Rojo watching.
- `apps/local`: loopback HTTP jobs, CLI, read-only MCP, and worker RPC.
- `apps/web`: local React/Sigma explorer and source/context views.
- `native/launcher`: Windows launcher, bundled runtime, safe argument forwarding, and owned process cleanup.

The design drew inspiration from [Graphify](https://github.com/dobbo-ca/graphify-go) and [GitNexus](https://github.com/abhigyanpatwari/GitNexus). Their implementations are not bundled. Optional Rojo uses the unmodified pinned [Rojo 7.7.1](https://github.com/rojo-rbx/rojo/tree/v7.7.1) CLI. Component notices are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
