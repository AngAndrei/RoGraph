# RoGraph

Understand how a Roblox game connects, with evidence that humans and AI agents can inspect.

RoGraph reads a saved **`.rbxlx` XML place** or a **Rojo project**, preserves its saved object hierarchy, and maps script dependencies, functions, configuration reads/writes, and potential communication through remotes and bindables. Each relationship carries source or saved-property evidence. Unsupported dynamic references stay visible as unknowns.

## Try the Windows app

Extract the portable package into a writable folder and open **RoGraph.exe**. Your browser opens the local explorer. Choose a `.rbxlx` file and click **Analyze**. The included `samples/shop.rbxlx` demonstrates the complete workflow. No Roblox login, model account, API key, Node installation, or cloud upload is required to use the package.

- Search scripts, functions, fields, or any saved object; expand the hierarchy for geometry.
- Select a node to inspect its incoming/outgoing relationships and retained occurrences.
- Open **Source** for exact decoded code and revision/byte/line locators.
- Trace `ShopClient.BuySword` to `ShopConfig.Prices.Sword` to follow a potential client → remote → server-handler → method → configuration path.
- Export a bounded JSON/Markdown context pack, or connect an agent through read-only MCP.
- Use **Stop app** to stop the service and its owned workers. Closing a browser tab alone leaves the local app running.

This is static saved-file analysis. It does not execute game code or prove runtime behavior. Binary `.rbxl` import and Studio capture are deferred. Rojo imports cover their configured project; Studio-only objects are outside that input.

See the [user guide](docs/user-guide.md), [agent setup](docs/agent-setup.md), [troubleshooting](docs/troubleshooting.md), and [measured performance](docs/performance.md). The release is **fixture-validated**; a representative real game and a separate clean PC have not been validated yet.

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

Browser tests use Microsoft Edge. `npm run bench -- --profile release --output build/release-benchmark.json` also needs PowerShell 7 for memory sampling. `npm run package:windows` creates `dist/windows-x64/` and `dist/RoGraph-0.1.0-windows-x64.zip`; run `scripts/release-smoke.ps1` against the package before sharing it.

## Command line

The portable executable forwards arguments without a shell. During development, replace `RoGraph.exe` with `node --import tsx apps/local/src/cli.ts` from this checkout.

```powershell
RoGraph.exe analyze --input game.rbxlx --workspace .rograph
RoGraph.exe analyze --rojo default.project.json --workspace .rograph
RoGraph.exe query --workspace .rograph --analysis <analysis-id> --request query.json
RoGraph.exe export --workspace .rograph --analysis <analysis-id> --format graph --output graph.json
RoGraph.exe mcp --workspace .rograph
```

Query files contain an operation such as `search`, `inspect`, `dependencies`, `impact`, `trace`, `source`, or `coverage`. Every query pins an analysis ID. CLI progress/errors go to stderr; results go to stdout. Full `graph` export is separate from bounded agent context.

## Implementation

- `native/rbx-import`: Roblox XML/DOM importer with raw-input retention.
- `native/luau-parser`: official pinned Luau parser, with lossless JSON serialization for binary strings and non-finite literals.
- `packages/core`: typed resolution, evidence, SQLite snapshots, bounded queries, context, differences, and Rojo watching.
- `apps/local`: loopback HTTP jobs, CLI, read-only MCP, and worker RPC.
- `apps/web`: local React/Sigma explorer and source/context views.
- `native/launcher`: Windows launcher, bundled runtime, safe argument forwarding, and owned process cleanup.

The design drew inspiration from [Graphify](https://github.com/dobbo-ca/graphify-go) and [GitNexus](https://github.com/abhigyanpatwari/GitNexus). Their implementations are not bundled. Optional Rojo uses the unmodified pinned [Rojo 7.7.1](https://github.com/rojo-rbx/rojo/tree/v7.7.1) CLI. Component notices are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
