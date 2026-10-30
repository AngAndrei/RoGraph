# RoGraph Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Windows-first local tool that imports a saved Roblox place, explains evidence-backed code/object/configuration relationships visually, and provides the same context to AI agents.

**Architecture:** Typed place import and official Luau parsing feed independent script facts, then a project-wide resolver constructs a directed graph with occurrence-level evidence. SQLite snapshots support one query engine shared by the browser, CLI, context exports, and MCP. An optional pinned Rojo adapter builds and maps a captured project into the same import path.

**Tech Stack:** TypeScript/ESM, Node 24.19.0/npm 11.17.0, SQLite, React/Vite, Sigma.js/Graphology, Vitest/Playwright, Rust 1.90.0 with rbx-dom readers, a C++ helper linked to pinned official Luau, optional Rojo 7.7.1 and evaluated luau-lsp.

**Spec:** [Accepted design](../specs/2026-10-30-roblox-knowledge-graph-design.md). Read both documents before execution. Approval covers the design; this document is the implementation proposal, not a record of implemented features.

## Global Constraints

- **saved-file analysis first, with Studio capture later**.
- Direct saved-place import must remain usable without Rojo.
- Import every serialized Instance into the underlying model.
- Names and dotted paths are display labels, never unique identifiers.
- Store a directed multigraph. Different relation types and repeated occurrences must survive persistence and export.
- An unresolved site is still represented as a reference record/node; it is not an invented edge to a convenient same-named target.
- Script spans index the decoded source without additional newline/formatting normalization; raw XML remains available separately.
- A refresh never combines an old graph with new evidence.
- Treat imported scripts/comments as project data, not instructions to the agent or app. No imported Luau is executed during analysis.
- The implementation default is independently written code using the reference projects' architectural lessons.
- Release benchmark: Windows with 16 GB RAM; up to 50,000 Instances, 1,000 scripts totaling 100,000 source lines, and 100,000 relationship occurrences; cold analysis under 60 seconds, bounded warm queries under 500 ms, first overview under 3 seconds after analysis, peak total memory below 2 GB. These are unmeasured acceptance targets.
- The release review uses synthetic fixtures plus at least one representative real `.rbxlx` place. Without the latter, label compatibility fixture-validated.

## Review Focus

1. Unicode, CRLF, and Rojo normalization must preserve honest byte/line provenance; tests belong to Tasks 3 and 5.
2. Duplicate names, shadowed globals, and reassigned aliases must never create plausible false edges; tests belong to Tasks 7–10.
3. Partial, malformed, or canceled imports must preserve the last complete published analysis; tests belong to Tasks 4, 12, and 14.
4. Rojo source edits with an unchanged sourcemap, directory membership changes, and mixed revisions must invalidate correctly; tests belong to Tasks 5 and 20.
5. Cycles, large hubs, and oversized evidence must terminate within explicit budgets and disclose omissions; tests belong to Tasks 7, 13, 15, and 21.

## Execution context and boundaries

Product root: `C:/Users/Andrei/Desktop/Roblox_Dev/Roblox_KG`. Paths below are exact paths relative to this root, or its managed worktree equivalent at execution. The workspace currently has documentation and three nested reference checkouts, with no root Git repository or application scaffold.

Do not edit, build in, install into, move, or commit contents of `Graphify/`, `GitNexus/`, or `Rojo/`. The Rojo checkout contains pre-existing changes and is not an exact release checkout. Use it as evidence, not the shipped binary. At execution, use the applicable Git/worktree workflow; if the product root still has no repository, initialize it with those reference directories ignored before creating implementation commits. No repository initialization is part of planning.

The build is one integrated product with sequential contracts, not three independent app projects. Natural review checkpoints are after Tasks 5, 11, 16, and 22. At each checkpoint demonstrate a working slice, then continue the accepted scope without asking the user to reapprove routine implementation choices.

Development prerequisites were inspected, not built: Node 24.19.0/npm 11.17.0, Rust/Cargo 1.90.0, VS2022 Build Tools/MSVC 14.44, Windows SDK 10.0.26100.0, CMake 3.31.6. CMake is at `C:/Program Files (x86)/Microsoft Visual Studio/2022/BuildTools/Common7/IDE/CommonExtensions/Microsoft/CMake/CMake/bin/cmake.exe`, outside ordinary PATH. Build using the `Visual Studio 17 2022` generator and `-A x64`.

Implementation resolves exact third-party package versions once, commits `package-lock.json`/`Cargo.lock`, and records native source revisions, archive hashes, flags, and binary versions in `tools/versions.lock.json`. Later builds use `npm ci` and Cargo `--locked`; no configure-time automatic source downloads. Builders may choose compatible package versions as the spec permits; pins must precede downstream parser integration.

Use `node:sqlite` behind the storage interface initially, with the runtime pinned to 24.19.0. Its documented status is Release Candidate; transaction, FTS5, reopen, packaging, and performance checks are required, rather than assuming stability. The storage interface allows replacing this binding if those checks fail. Use the current supported official MCP server package with a locked version and its matching docs, rather than copying old SDK examples.

## File map

| Path | Responsibility |
| --- | --- |
| `package.json`, `package-lock.json`, `tsconfig.json`, `vitest.config.ts`, `.node-version`, `.gitignore` | Workspace scripts, versioned dependencies, TypeScript/test configuration, reference exclusions |
| `packages/contracts/src/model.ts`, `packages/contracts/src/query.ts`, `packages/contracts/src/protocol.ts` | Shared serialized contracts, query envelopes, native helper protocol |
| `native/rbx-import/` | Rust typed decoder plus raw XML inventory |
| `native/luau-parser/` | Official Luau parser wrapper; parse without executing source |
| `packages/adapters/src/native.ts`, `packages/adapters/src/rojo.ts`, `packages/adapters/src/capture.ts` | Child-process bridge and optional immutable Rojo capture/build/map |
| `packages/core/src/import.ts`, `facts.ts`, `resolve-instances.ts`, `resolve-calls.ts`, `resolve-config.ts`, `resolve-events.ts` | Source fidelity and separate analysis passes |
| `packages/core/src/assemble.ts`, `store.ts`, `query.ts`, `pipeline.ts`, `cache.ts`, `diff.ts`, `watch.ts`, `context.ts` | Graph construction, persistence, queries, updates, context retrieval |
| `apps/local/src/cli.ts`, `mcp.ts`, `server.ts`, `jobs.ts`, `worker.ts` | User/agent entry points and local worker orchestration |
| `apps/web/src/` | Import, coverage, hierarchy, graph, source/evidence inspection |
| `tests/`, `fixtures/` | Golden facts, adversarial inputs, protocol/UI/integration tests |
| `scripts/`, `tools/`, `docs/` | Native builds, locked tools, release packaging and usage documentation |

Task file lists below expand these responsibilities. Do not create every future file during scaffolding.

## Shared contracts and defaults

Task 1 defines and exports the following from `@rograph/contracts`; do not rename fields in later tasks.

- `Input`: `{ kind: 'place'; path: string } | { kind: 'rojo'; projectPath: string }`.
- `Source`: `{ id, scriptId, text, sha256, origin }`. `origin` distinguishes `place`, `file`, and `generated`, and retains original-file hashes/text references plus a verified span mapping when available.
- `Instance`: `{ id, parentId: string | null, name, className, siblingOrdinal: number, originalReferent?: string, properties: Record<string, SerializedValue>, sourceId?: string, synthetic: boolean }`. `SerializedValue` carries serialized name/type, a JSON-safe value, and unsupported/raw provenance when needed.
- `Span`: zero-based half-open UTF-8 `startByte`/`endByte`, plus one-based `startLine`, `startColumn`, `endLine`, `endColumn`; columns count Unicode code points. Tests must not mix byte offsets and columns.
- `Diagnostic`: `{ code, severity: 'info' | 'warning' | 'error', message, ownerId?: string, siteId?: string }`.
- `Coverage`: `{ importedInstances, discoveredScripts, parsedScripts, discoveredSites, resolvedSites, candidateSites, unresolvedSites, partialImport: boolean, limitations: string[] }`.
- `Snapshot`: `{ snapshotId, input, versions, instances: Instance[], sources: Source[], diagnostics: Diagnostic[], coverage: Coverage, inventory }`. `inventory` retains original Item/property/reference entries and raw input hash/location.
- `Site`: `{ id, ownerId, sourceId, span, kind, expression, status, targetIds: string[], reason?: string, assumptions: string[], contexts: Context[] }`. Status is `saved`, `resolved`, `candidate`, or `unresolved`; `Context` is `client`, `server`, or `unknown`.
- `Facts`: `{ scriptId, sourceId, scopes, bindings, symbols, sites: Site[], exports, diagnostics }`. Expression/binding/export records are discriminated normalized AST records; source text alone is never a resolved target.
- `Node`: `{ id, kind: 'instance' | 'function' | 'field' | 'external' | 'unresolved' | 'group', ownerId?: string, label, contexts: Context[], attributes }`.
- `Relation`: `{ id, source, target, type }`, with types exactly `CONTAINS`, `DECLARES`, `REQUIRES`, `CALLS`, `READS`, `WRITES`, `REFERENCES`, `SENDS_VIA`, `HANDLES`, `CONNECTS_SIGNAL`, `MEMBER_OF`.
- `Evidence`: `{ id, relationId, siteId?: string, sourceId?: string, span?: Span, instanceId?: string, propertyName?: string, rule, status, assumptions: string[], mechanism?: string, contexts: Context[] }`. Exactly one source-span or serialized-property locator is required; declarations use the same provenance contract.
- `Resolution`: `{ sites: Site[], nodes: Node[], relations: Relation[], evidence: Evidence[], diagnostics: Diagnostic[] }`.
- `Graph`: `{ analysisId, snapshotId, versions, importManifest, nodes, relations, evidence, sites, sources, diagnostics, coverage }`. `importManifest` retains the input, raw inventory/blob references, original-to-built mappings, and capture/tool hashes. Instance nodes retain their imported record in attributes. `analysisId` hashes snapshot ID plus analyzer/parser/schema/options versions; deterministic hashing sorts map/object keys, not semantic child order. Owned blob locations are storage metadata, excluded from canonical graph comparisons/hashes; blob contents are verified by hash before publication.

Define the normalized fact records in Task 6 before implementing resolvers: `Expression` uses `kind` with `literal { value }`, `binding { bindingId }`, `global { name, unshadowed }`, `index { base, key }`, `call { callee, args, colon }`, `function { symbolId }`, or `unknown { reason }`. Expressions retain spans. `Scope` has `id`, `parentId`, byte range, and `bindingIds`; `Binding` has `id`, `scopeId`, `name`, optional `initializer`, and source-ordered `assignments: { span, value: Expression }[]`. `Symbol` has `id`, `ownerId`, `name`, `span`, `parameters`, and `bodyScopeId`; export records have `keyPath: string[]`, `value: Expression`, and `span`. Unsupported expression forms lower to `unknown`, never a guessed binding.

`query.ts` defines `Query` as a union discriminated by `op`, with `analysisId` on every operation: `search { text }`, `inspect { nodeId }`, `source { sourceId, startByte?, endByte? }`, `dependencies/impact { nodeId, depth }`, `trace { fromId, toId, depth }`, `overview { groupBy: 'service' | 'folder' }`, `coverage {}`, `tree { parentId }`. Common top-level options are `limit`, `cursor`, `relationTypes`, `statuses`, `contexts`, and `classes`.

All operations return `QueryResult { analysisId, nodes, relations, evidence, sites, sources, diagnostics, coverage, paths, groups, meta }`; unused arrays are empty. Query sources use `SourceView { id, scriptId, sha256, origin, text?: string, excerpts: { span: Span, text: string }[], omittedBytes: number }`, with the original full-source hash even when only explicitly located excerpts are returned. `meta` carries `truncated`, `omittedCounts`, `nextCursor`, and limits. `paths` is `PathHop[][]`, where `PathHop { relationId, fromId, toId, direction: 'forward' | 'reverse', transition: 'dependency' | 'potential-communication' | 'potential-impact' }`. Invalid/stale IDs return typed errors rather than falling back to current data.

Builder-selected defaults: import 512 MiB input, 200,000 Instances, 16 MiB per script, 256 MiB total decoded source, XML depth 256; query depth 3/max 6, max 1,000 nodes/5,000 evidence occurrences/5 paths; overview 300 nodes; context estimate 4 characters/token, default 2,000 estimated tokens plus hard cap 32,000 UTF-8 bytes. Report every enforced cutoff. Check cancellation between batches of at most 1,000 records and use worker termination/process cleanup as the fallback.

`tests/support/fixtures.ts` exports `fixturePath(name: string): string` and `readExpected(name: string): Promise<unknown>`, resolving names relative to `fixtures/`. `tests/support/workspace.ts` exports `withWorkspace<T>(run: (path: string) => Promise<T>): Promise<T>` for owned temporary directories, with cleanup restricted to those directories. Task 14 later adds `analyzeFixture(name: string, workspacePath?: string): Promise<Graph>` to `tests/support/analyze.ts`; earlier tasks use their own real pipeline components, not invented prebuilt graph helpers. Test anchors below show named assertions; where a task says to bind a result variable, its setup uses the exact interfaces in that task.

## Reference fixture

`fixtures/shop/place.rbxlx` contains `ReplicatedStorage/Shop/Purchase` (RemoteEvent, original referent `remote_shop`), `ShopConfig` (ModuleScript), `ServerScriptService/ShopServer` (Script), `PurchaseService` (ModuleScript), and `StarterPlayer/StarterPlayerScripts/ShopClient` (LocalScript).

The client defines `ShopClient.BuySword`, which calls `Purchase:FireServer('Sword')`. The server requires PurchaseService, connects named `onPurchase(player, itemId)` to `Purchase.OnServerEvent`, and calls `Service.TryPurchase(player, itemId)`. PurchaseService requires ShopConfig and reads literal `Config.Prices.Sword`; ShopConfig returns `{ Prices = { Sword = 100, Shield = 150 }, Enabled = true }`.

Expected potential trace: BuySword → Purchase → onPurchase → TryPurchase → Prices.Sword. Store `HANDLES` as callback → channel, with remote → callback traversal explicitly annotated in trace results. The config read targets the leaf field; intermediate prefixes create field declarations, not redundant leaf-read evidence. The literal `100` is an initializer, not a claimed runtime value.

## Task 1: Contracts, fixture corpus, and executable test foundation

**Files:** Create root configuration from the file map; `apps/local/package.json`, `apps/web/package.json`, `packages/contracts/package.json`, `packages/core/package.json`, `packages/adapters/package.json`; `packages/contracts/src/model.ts`, `packages/contracts/src/query.ts`, `packages/contracts/src/protocol.ts`, `packages/contracts/src/index.ts`; `tests/contracts.test.ts`, `tests/support/fixtures.ts`, `tests/support/workspace.ts`; `fixtures/shop/place.rbxlx`, `fixtures/shop/expected.json`; `fixtures/adversarial/duplicates.rbxlx`, `fixtures/adversarial/dynamic.rbxlx`, `fixtures/adversarial/partial.rbxlx`, `fixtures/adversarial/unicode.rbxlx`, `fixtures/adversarial/cycles.rbxlx`, `fixtures/adversarial/contexts.rbxlx`.

**Interfaces:** Produces the shared exports above; `validateGraph(value: unknown): Graph`; JSON protocol request/response version `1`, request ID, operation, structured diagnostics. Native stdout is protocol-only; logs go to stderr.

- [ ] **Step 1:** Create only the test configuration/dependencies needed here. Define npm scripts `test` = `vitest run`, `typecheck` = `tsc --noEmit`, `build` for workspace production builds, and future `build:native`, `test:e2e`, `bench`, `package:windows` script entry names. Write `rejects_evidence_without_locator`, `keeps_duplicate_instances_distinct`, and `records_nonprobabilistic_status` assertions: schema rejects missing evidence locators, two same-named siblings retain different IDs, and status accepts `candidate` without requiring a percentage.

  In the named schema test, construct a locally valid minimal Graph as `validGraph`, then remove the locator from its one Evidence record:
  ```ts
  it('rejects_evidence_without_locator', () => {
    expect(() => validateGraph(validGraph)).not.toThrow();
    const invalid = { ...validGraph, evidence: [{ ...validGraph.evidence[0], span: undefined, propertyName: undefined }] };
    expect(() => validateGraph(invalid)).toThrow();
  });
  ```
- [ ] **Step 2:** Run `npm run test -- tests/contracts.test.ts`; expect failing schema/identity assertions, not an unrelated runner failure.
- [ ] **Step 3:** Implement schemas/interfaces and independently authored expected fixture facts. Ignore the three reference folders, build/vendor/cache/release outputs, and private place imports. Fixtures contain synthetic public example content only.
- [ ] **Step 4:** Run the same test command and `npm run typecheck`; expect both to pass. Inspect fixture XML and expected facts together; the expectation file is not generated from analyzer output.
- [ ] **Step 5:** Commit only this task's files plus the accepted spec/plan; message `chore: establish graph contracts and reference fixtures`.

## Task 2: Typed Roblox decoder and raw inventory helper

**Files:** Create `native/rbx-import/Cargo.toml`, `native/rbx-import/Cargo.lock`, `native/rbx-import/src/main.rs`, `native/rbx-import/src/decode.rs`, `native/rbx-import/src/inventory.rs`; `scripts/build-native.ps1`, `tools/versions.lock.json`; `packages/adapters/src/native.ts`; `tests/native-import.test.ts`; modify `packages/contracts/src/protocol.ts` for the typed import response.

**Interfaces:** `runNative<T>(tool: 'rbx-import' | 'luau-parser', request: unknown, signal?: AbortSignal): Promise<T>`. Import operation returns typed DOM records with temporary IDs, raw inventory, decoded script source, and structured diagnostics; Task 4 assigns persistent IDs.

- [ ] **Step 1:** Write `retains_unknown_properties_and_dangling_refs`: raw inventory must contain both entries in `partial.rbxlx`, and helper diagnostics must include `UNKNOWN_PROPERTY_TYPE` and `DANGLING_REFERENT`. Add assertions for supported ObjectValue references, XML entities/CDATA, SharedStrings, ordered children, and synthetic-root counts.

  Bind `result` to the real helper response for `adversarial/partial.rbxlx`:
  ```ts
  it('retains_unknown_properties_and_dangling_refs', () => {
    expect(result.diagnostics.map(d => d.code)).toEqual(expect.arrayContaining(['UNKNOWN_PROPERTY_TYPE', 'DANGLING_REFERENT']));
    expect(result.inventory.items.length).toBeGreaterThan(0);
  });
  ```
- [ ] **Step 2:** Run `npm run test -- tests/native-import.test.ts`; expect a missing-helper failure before implementation.
- [ ] **Step 3:** Implement typed decoding using locked compatible `rbx_xml`/`rbx_dom_weak` releases and a separate raw XML inventory pass. Disable external entity/DTD processing; enforce limits. Turn reader warnings/skipped values into inventory-backed diagnostics. Spawn absolute executable paths with argument arrays, `shell: false`, and `windowsHide: true`; bound output and kill on timeout/cancel. Capture exact dependency pins/checksums in the lock manifest.
- [ ] **Step 4:** Run `cargo test --manifest-path native/rbx-import/Cargo.toml --locked`, `npm run build:native`, then the native-import test. Expect complete/partial classifications and preserved raw bytes; confirm the helper never executes scripts.
- [ ] **Step 5:** Commit `feat: decode saved places with audited raw inventory`.

## Task 3: Official Luau parser helper and exact source spans

**Files:** Create `native/luau-parser/CMakeLists.txt`, `native/luau-parser/main.cpp`, `native/luau-parser/features.json`; `scripts/fetch-native-sources.ps1`; `tests/native-parser.test.ts`; modify `scripts/build-native.ps1`, `tools/versions.lock.json`, `packages/adapters/src/native.ts`, `packages/contracts/src/protocol.ts`.

**Interfaces:** Parse operation consumes `{ protocolVersion: 1, requestId, sourceId, scriptId, text }`; returns an AST payload, parser diagnostics, and version/feature metadata. Export `parseSource(source: Source, signal?: AbortSignal): Promise<ParsedSource>` from `native.ts`; define `ParsedSource { sourceId, scriptId, ast, spans: { kind, span: Span }[], diagnostics, sha256, parserVersion, featureHash }` in `protocol.ts`. AST spans are collected from parser locations, not source-text matching.

- [ ] **Step 1:** Write `maps_unicode_and_crlf_spans`: for decoded source `-- café 🛒\r\nlocal price = Config.Prices.Sword\r\n`, the access slices UTF-8 bytes `[29,48)` to `Config.Prices.Sword` and begins at line 2/column 15. Add typed Luau, interpolation, generics, generalized iteration, broken syntax, multiple requests, and request-cancel cases.

  Bind `span` to that access's helper-reported range, without searching source text to manufacture the range:
  ```ts
  it('maps_unicode_and_crlf_spans', () => {
    expect([span.startByte, span.endByte, span.startLine, span.startColumn]).toEqual([29, 48, 2, 15]);
    expect(Buffer.from(text).subarray(span.startByte, span.endByte).toString()).toBe('Config.Prices.Sword');
  });
  ```
- [ ] **Step 2:** Run `npm run test -- tests/native-parser.test.ts`; expect the missing parser/helper behavior to fail.
- [ ] **Step 3:** Link the official parser from a checksum-verified, immutable source revision into the helper. Record exact feature flags; do not enable every flag by a name prefix. Capture comments, disable declaration-only syntax for place scripts, preserve input text, normalize diagnostic/span coordinates into the contract, and return errors without claiming a successful parse. Configure CMake with the verified VS2022 x64 generator and static MSVC runtime where supported.
- [ ] **Step 4:** Run `npm run build:native` and the parser test; expect all slices and diagnostics to match. Verify clean helper startup without Rust/C++ tools on PATH as an early distribution probe.
- [ ] **Step 5:** Commit `feat: parse Luau with pinned official syntax and source spans`.

## Task 4: Deterministic normalized place snapshots

**Files:** Create `packages/core/src/import.ts`, `packages/core/src/source-index.ts`, `packages/core/src/limits.ts`; `tests/import.test.ts`.

**Interfaces:** `importPlace(path: string, signal?: AbortSignal): Promise<Snapshot>` consumes Task 2. `indexSource(text: string): SourceIndex` exposes `span(startByte: number, endByte: number): Span` and `slice(span: Span): string`. `defaultLimits` exports the shared numeric defaults.

- [ ] **Step 1:** Write `normalizes_repeatably`: two imports of identical bytes have equal IDs/hashes, duplicate siblings remain distinct, and decoded source is unchanged. Write `does_not_hide_partial_inventory`: partial input has `coverage.partialImport === true` and both diagnostic codes. Add limit, malformed XML, missing source, and cancellation assertions.

  ```ts
  it('does_not_hide_partial_inventory', async () => {
    const snapshot = await importPlace(fixturePath('adversarial/partial.rbxlx'));
    expect(snapshot.coverage.partialImport).toBe(true);
    expect(snapshot.diagnostics.map(d => d.code)).toContain('DANGLING_REFERENT');
  });
  ```
- [ ] **Step 2:** Run `npm run test -- tests/import.test.ts`; expect the unimplemented import contract to fail.
- [ ] **Step 3:** Assign IDs using input hash and ordered traversal/sibling ordinals; rewrite all internal references to those IDs. Source IDs include the owning script identity; content hashes are separate so identical source text in two scripts does not merge ownership. Retain an immutable owned copy of input/decoded-source blobs with hashes and attach their references to the manifest. Compute coverage denominators from raw inventory, mark the root synthetic, and return typed incomplete results rather than silently filtering them.
- [ ] **Step 4:** Rerun the import tests and typecheck; expect deterministic snapshots and explicit errors/partial status. Confirm native randomized IDs do not appear in exported IDs.
- [ ] **Step 5:** Commit `feat: normalize immutable place snapshots`.

## Task 5: Optional captured Rojo project adapter and LSP evaluation

**Files:** Create `packages/adapters/src/capture.ts`, `packages/adapters/src/rojo.ts`, `packages/core/src/rojo-import.ts`; `tests/rojo.test.ts`, `tests/rojo.integration.test.ts`; `fixtures/rojo/default.project.json`, `fixtures/rojo/src/ShopClient.client.luau`, `fixtures/rojo/src/ShopServer.server.luau`, `fixtures/rojo/src/PurchaseService.luau`, `fixtures/rojo/src/ShopConfig.json`, `fixtures/rojo/nested/default.project.json`, `fixtures/rojo/nested/Shared.luau`; `docs/engineering/rojo-lsp-evaluation.md`; modify `tools/versions.lock.json`.

**Interfaces:** `captureProject(projectPath: string, signal?: AbortSignal): Promise<ProjectCapture>`, where `ProjectCapture { root, projectPath, manifestHash, files: { originalPath, capturedPath, sha256, byteLength }[], directories: string[] }` describes immutable copied bytes/directory membership. `runRojoBuild(capture: ProjectCapture, signal?: AbortSignal): Promise<RojoBuild>` returns `{ placePath, sourcemapPath, toolVersion, inputManifestHash, outputHashes }`. These adapter functions depend on contracts, not core. `buildRojoSnapshot(projectPath: string, signal?: AbortSignal): Promise<Snapshot>` lives in core/rojo-import.ts and composes the adapter with `importPlace`, preventing a core↔adapters package cycle. Original project files are read-only; retain required original/build blobs before cleaning the owned capture.

- [ ] **Step 1:** Write assertions for direct-import/build equivalence, CRLF→LF source mapping, generated JSON retaining separate originals, unchanged source-map structure despite source edits, duplicate mapping ambiguity, and stale/mixed build-map rejection. Reject `../`/absolute external mounts, reparse/symlink escapes, and non-DataModel roots with explicit diagnostic codes. Include nested projects, empty directories, missing optional paths becoming present, metadata Source overrides, and root properties that the .rbxlx build cannot serialize.

  ```ts
  it('labels_generated_config_separately', async () => {
    const snapshot = await buildRojoSnapshot(fixturePath('rojo/default.project.json'));
    expect(snapshot.input.kind).toBe('rojo');
    expect(snapshot.sources.some(s => s.origin.kind === 'generated')).toBe(true);
  });
  ```
- [ ] **Step 2:** Run `npm run test -- tests/rojo.test.ts`; expect capture/mapping failures. Integration tests require the separately verified pinned binary, never the mutable reference checkout.
- [ ] **Step 3:** Support initially one DataModel-root project with mounts/nested projects wholly inside the selected project directory. Freeze the full contained input tree within the declared resource limits; outputs live outside it. Run argument arrays `--color never build <captured-project> --output <outside>/place.rbxlx` and `--color never sourcemap <captured-project> --output <outside>/map.json --include-non-scripts --absolute`. Verify frozen input/output hashes, names/classes, and source before attachment. A map has names/classes/file paths/children, not referents or source hashes. Bridge its project root to the synthetic DataModel, explicitly diagnosing root properties omitted by place serialization. Attach only unique verified associations. Analyze built Source; attach original-file spans only after verified CRLF normalization mapping. Generated/transformed sources retain separate provenance.
- [ ] **Step 4:** Run both Rojo test files. Probe pinned luau-lsp definitions/references/call hierarchy against the fixture and record correctness, evidence, packaging costs, and the adopt/defer decision in the evaluation document. Adopt only proven useful results behind the Facts/Resolution contract; the custom graph passes remain authoritative for domain relationships. Missing optional tools must not break place import.
- [ ] **Step 5:** Commit `feat: import captured Rojo projects with verified file provenance`.

## Task 6: Lexical declarations and normalized script facts

**Files:** Create `packages/core/src/facts.ts`, `packages/core/src/ast-lowering.ts`; `tests/facts.test.ts`; modify `packages/contracts/src/model.ts` to define the normalized fact records listed above.

**Interfaces:** `extractFacts(snapshot: Snapshot, signal?: AbortSignal): Promise<Facts[]>` consumes `parseSource`; `lowerAst(parsed: ParsedSource): Facts` records scopes, bindings, declarations, exports, calls and property-access sites without deciding cross-script targets.

- [ ] **Step 1:** Assert the shop fixture declares `BuySword`, `onPurchase`, and `TryPurchase` under their actual scripts; an inner same-named function has a different lexical identity; inline callbacks receive stable source-based identities. A broken script stays present with diagnostics and contributes no falsely complete semantic facts.

  ```ts
  it('extracts_scoped_shop_functions', async () => {
    const facts = await extractFacts(await importPlace(fixturePath('shop/place.rbxlx')));
    expect(facts.flatMap(f => f.symbols.map(s => s.name))).toEqual(expect.arrayContaining(['BuySword', 'onPurchase', 'TryPurchase']));
  });
  ```
- [ ] **Step 2:** Run `npm run test -- tests/facts.test.ts`; expect missing extraction behavior.
- [ ] **Step 3:** Lower the pinned AST into explicit expression/binding records, preserving source IDs and spans. Keep top-level sites owned by their script. Collect unsupported syntax/site reasons rather than fabricating exports. Check cancellation between batches.
- [ ] **Step 4:** Rerun facts tests and typecheck; compare declarations and source slices with golden expectations.
- [ ] **Step 5:** Commit `feat: extract scoped Luau declarations and reference sites`.

## Task 7: Instance paths, requires, and execution assumptions

**Files:** Create `packages/core/src/resolve-instances.ts`, `packages/core/src/execution-context.ts`, `packages/core/src/compatibility.ts`; `tests/resolve-instances.test.ts`; `fixtures/compatibility/require-cases.json`.

**Interfaces:** `resolveInstances(snapshot: Snapshot, facts: Facts[]): Resolution`; `resolveContexts(snapshot: Snapshot, facts: Facts[], resolution: Resolution): Map<string, Context[]>`. Compatibility data is versioned alongside the parser/resolver.

- [ ] **Step 1:** Assert actual target IDs for `script.Parent`, GetService, literal child lookups, aliases, Instance requires and documented `./`, `../`, `@self/`, `@game/` strings. Numeric requires produce external nodes. Duplicate child names produce `candidate`, computed names produce `unresolved`, and a lexically shadowed `require`/`game` is not treated as the builtin. Cyclic requires terminate; shared modules preserve both caller contexts.

  With `resolution = resolveInstances(snapshot, facts)` from the duplicate-sibling case:
  ```ts
  it('does_not_choose_a_duplicate_child', () => {
    const site = resolution.sites.find(s => s.reason === 'DUPLICATE_CHILD_NAME')!;
    expect(site.status).toBe('candidate');
    expect(site.targetIds).toHaveLength(2);
  });
  ```
- [ ] **Step 2:** Run `npm run test -- tests/resolve-instances.test.ts`; expect target/context assertions to fail.
- [ ] **Step 3:** Implement bounded lexical alias/path resolution against imported Instance identity. Follow documented Roblox string-require semantics, not filesystem guesses. Invalidate reassigned aliases. Use fixed-point propagation with visited states and explicit cutoff diagnostics. Interpret Disabled/RunContext/location and Starter templates conservatively; uncalled modules remain unknown-context.
- [ ] **Step 4:** Rerun the test; every unsupported case must retain a site with a reason rather than disappearing or choosing a same-named target.
- [ ] **Step 5:** Commit `feat: resolve Roblox instance and module dependencies`.

## Task 8: Exported members and method-call resolution

**Files:** Create `packages/core/src/resolve-calls.ts`; `tests/resolve-calls.test.ts`.

**Interfaces:** `resolveCalls(snapshot: Snapshot, facts: Facts[], instances: Resolution): Resolution` adds function nodes and caller→callee relations; it does not overwrite prior site identities or diagnostics.

- [ ] **Step 1:** Assert `onPurchase CALLS PurchaseService.TryPurchase`; `local Alias = Service` preserves that target, while an inner shadowed Alias calls its own function. Dot/colon receiver rules must be explicit. Two calls to the same method create two distinct Evidence IDs. Metatable/dynamic exports and unsupported higher-order invocation remain diagnostic-bearing sites.

  With `calls = resolveCalls(snapshot, facts, instances)` and `methodId` the expected exported method ID:
  ```ts
  it('preserves_repeated_method_call_occurrences', () => {
    const relation = calls.relations.find(r => r.type === 'CALLS' && r.target === methodId)!;
    const occurrences = calls.evidence.filter(e => e.relationId === relation.id);
    expect(new Set(occurrences.map(e => e.id)).size).toBe(2);
  });
  ```
- [ ] **Step 2:** Run `npm run test -- tests/resolve-calls.test.ts`; expect missing or incorrectly bound targets.
- [ ] **Step 3:** Resolve supported returned-table/export bindings and lexical receiver identities. Use builtin context only when not shadowed; never use global name fallback. Preserve potential call assumptions and context on each occurrence.
- [ ] **Step 4:** Rerun the call tests and typecheck; inspect both repeated-call spans.
- [ ] **Step 5:** Commit `feat: connect exported Luau methods with occurrence evidence`.

## Task 9: Configuration fields, Attributes, Values, and properties

**Files:** Create `packages/core/src/resolve-config.ts`; `tests/resolve-config.test.ts`.

**Interfaces:** `resolveConfig(snapshot: Snapshot, facts: Facts[], instances: Resolution, calls: Resolution): Resolution` adds field nodes and READS/WRITES sites.

- [ ] **Step 1:** Assert `TryPurchase READS ShopConfig.Prices.Sword`, initializer `100`, and no leaf read of Shield/Enabled. Assert literal Attribute, ObjectValue/Value-object, property, and compound-assignment reads/writes. A dynamic `Config.Prices[itemId]` retains `DYNAMIC_CONFIG_KEY`; a table alias replacement must invalidate previous field binding.

  Bind `config` to resolveConfig for the dynamic-key fixture:
  ```ts
  it('retains_dynamic_configuration_boundaries', () => {
    const site = config.sites.find(s => s.reason === 'DYNAMIC_CONFIG_KEY')!;
    expect(site.status).toBe('unresolved');
    expect(site.targetIds).toEqual([]);
  });
  ```
- [ ] **Step 2:** Run `npm run test -- tests/resolve-config.test.ts`; expect per-field binding assertions to fail.
- [ ] **Step 3:** Address fields by owner/key path, follow supported config aliases, and emit leaf accesses with initial-value provenance. Represent compound assignment as separate READS and WRITES occurrences. Distinguish property-versus-child lookup using class/API compatibility data; report ambiguity when unsupported.
- [ ] **Step 4:** Rerun tests; confirm values are described as saved/initial rather than runtime-final values.
- [ ] **Step 5:** Commit `feat: explain configuration reads and writes at field level`.

## Task 10: Remote, bindable, and signal communication

**Files:** Create `packages/core/src/resolve-events.ts`; `tests/resolve-events.test.ts`; `fixtures/compatibility/event-cases.json`.

**Interfaces:** `resolveEvents(snapshot: Snapshot, facts: Facts[], instances: Resolution, calls: Resolution): Resolution`. `HANDLES` stores callback→channel; Evidence.mechanism distinguishes FireServer/OnServerEvent, FireClient/FireAllClients/OnClientEvent, InvokeServer/OnServerInvoke, InvokeClient/OnClientInvoke, bindable event/function, and supported signals.

- [ ] **Step 1:** Assert BuySword→the shop remote and onPurchase→the same remote, with client/server contexts and both source locators. Another remote named Purchase cannot join. Verify named/inline handlers, compatible send/receive directions, callback assignment/reassignment diagnostics, and the implicit server `player` argument. Shared modules alone never create communication.

  With `events = resolveEvents(snapshot, facts, instances, calls)` and the expected channel ID:
  ```ts
  it('joins_remote_sites_by_identity', () => {
    expect(events.relations.filter(r => ['SENDS_VIA', 'HANDLES'].includes(r.type) && r.target === channelId)).toHaveLength(2);
    expect(events.evidence.map(e => e.mechanism)).toEqual(expect.arrayContaining(['RemoteEvent.FireServer', 'RemoteEvent.OnServerEvent']));
  });
  ```
- [ ] **Step 2:** Run `npm run test -- tests/resolve-events.test.ts`; expect missing endpoints/mechanisms.
- [ ] **Step 3:** Match endpoints through resolved Instance IDs and versioned API mechanisms. Record registrations as potential handlers; conditional/runtime replacement is an assumption. Preserve unresolved remote/signal references and avoid claiming handler execution.
- [ ] **Step 4:** Rerun the event tests; all four remote directions and bindable/signal cases must pass.
- [ ] **Step 5:** Commit `feat: trace potential communication through Roblox channels`.

## Task 11: Assemble the graph and coverage report

**Files:** Create `packages/core/src/assemble.ts`; `tests/assemble.test.ts`, `tests/support/resolve.ts`.

**Interfaces:** `assembleGraph(snapshot: Snapshot, facts: Facts[], resolutions: Resolution[]): Graph`; `resolveFixture(name: string): Promise<Graph>` in test support composes Tasks 4 and 6–10 without persistence.

- [ ] **Step 1:** Assert every imported Instance remains represented; source declarations/property references have locators; repeated evidence survives relation aggregation; unresolved sites appear as addressable nodes. Coverage counts distinguish parsed scripts and resolved/candidate/unresolved sites, and never count percent resolved as runtime completeness.

  ```ts
  it('retains_unresolved_sites_as_graph_nodes', async () => {
    const graph = await resolveFixture('adversarial/dynamic.rbxlx');
    expect(graph.sites.some(s => s.status === 'unresolved')).toBe(true);
    expect(graph.nodes.some(n => n.kind === 'unresolved')).toBe(true);
    expect(() => validateGraph(graph)).not.toThrow();
  });
  ```
- [ ] **Step 2:** Run `npm run test -- tests/assemble.test.ts`; expect graph/coverage contract failures.
- [ ] **Step 3:** Merge typed passes deterministically; aggregate only relation identity, never its occurrence list. Add containment/declarations and external/unresolved nodes. Verify target/source referential integrity and source hashes. Expose per-script dependency summaries backed by underlying IDs; do not create opaque generic influence facts.
- [ ] **Step 4:** Rerun tests and `validateGraph`; compare the shop graph with authored expected facts. This is the second review checkpoint.
- [ ] **Step 5:** Commit `feat: assemble deterministic evidence-backed graph snapshots`.

## Task 12: SQLite persistence and atomic publication

**Files:** Create `packages/core/src/store.ts`, `packages/core/src/schema.sql`; `tests/store.test.ts`.

**Interfaces:** `openStore(path: string): Promise<GraphStore>`. Store methods: `save(graph: Graph, signal?: AbortSignal): Promise<void>`, `publish(analysisId: string): Promise<void>`, `current(): Promise<string | null>`, `listAnalyses(limit: number, cursor?: string): Promise<{ items: AnalysisSummary[]; nextCursor?: string }>`, `readGraph(analysisId: string): Promise<Graph>`, `select(selection: StoreSelection): Promise<QueryResult>`, `close(): Promise<void>`. AnalysisSummary has analysisId, snapshotId, input kind, completion state, and storage timestamp (timestamps do not participate in graph identity). StoreSelection has `analysisId`, `limit`, optional cursor, and a discriminated `op`: `nodes { ids }`, `adjacent { nodeIds, direction: 'in' | 'out', relationTypes }`, `search { text }`, `sites { ownerIds }`, `evidence { relationIds }`, `sources { ids }`, `children { parentId }`, `overview { groupBy }`, or `manifest {}`. Selection is one bounded indexed lookup, not a traversal. Task 13 composes these primitives; only explicit full export/validation uses readGraph.

- [ ] **Step 1:** Assert round-trip equality including repeated Evidence and unresolved sites, FTS results, and source blobs. After canceling a staged save, current must equal the previous complete analysis. A partial graph may be retained for inspection but cannot become current; stale analysis IDs never read current rows accidentally. Reopen/FTS/transaction tests are the SQLite binding gate.

  Bind `store` to an owned temporary database, save/publish a complete graph as `previousId`, then save a graph whose coverage is partial as `partial`:
  ```ts
  it('does_not_publish_partial_over_complete', async () => {
    await expect(store.publish(partial.analysisId)).rejects.toMatchObject({ code: 'PARTIAL_ANALYSIS' });
    expect(await store.current()).toBe(previousId);
  });
  ```
- [ ] **Step 2:** Run `npm run test -- tests/store.test.ts`; expect persistence/publication behavior to fail.
- [ ] **Step 3:** Create analysis-keyed tables for manifests, nodes, relations, evidence, sites, sources/raw blobs, diagnostics, groups, and search. Index both relation directions and source/site ownership. Stage records with incomplete status, then atomically mark complete/publish; cleanup canceled drafts. Store owned immutable blobs under the selected local workspace, independent of original file availability. Keep DB operations behind this interface.
- [ ] **Step 4:** Rerun store tests on Node 24.19.0, close/reopen, and inspect the query plans for adjacency/FTS. If binding gates fail, replace only this adapter and document the tested binding/pins before continuing.
- [ ] **Step 5:** Commit `feat: persist graph evidence with atomic snapshot publication`.

## Task 13: Bounded graph queries and explanatory paths

**Files:** Create `packages/core/src/query.ts`, `packages/core/src/traversal.ts`, `packages/core/src/grouping.ts`; `tests/query.test.ts`.

**Interfaces:** `createQueryEngine(store: GraphStore): QueryEngine`; `QueryEngine.run(query: Query, signal?: AbortSignal): Promise<QueryResult>`. All clients call this function, never separate traversal implementations.

- [ ] **Step 1:** Assert method callers, config readers, incoming/outgoing dependencies, tree/search/filter pagination, service/folder overview, and the shop's five-node potential trace. Impact of Prices.Sword must include TryPurchase/onPurchase and separately labeled potential channel effect on BuySword. Structural containment cannot pull in unrelated scripts. Cycle/hub fixtures must respect depth/node/occurrence/path limits and disclose truncation; cursors are bound to analysis and filters.

  Bind `engine`, `analysisId`, `buySwordId`, and `priceId` from a persisted real shop graph:
  ```ts
  it('traces_potential_remote_communication', async () => {
    const result = await engine.run({ op: 'trace', analysisId, fromId: buySwordId, toId: priceId, depth: 6 });
    expect(result.paths[0]).toHaveLength(4);
    expect(result.paths[0].some(h => h.transition === 'potential-communication')).toBe(true);
  });
  ```
- [ ] **Step 2:** Run `npm run test -- tests/query.test.ts`; expect absent traversal semantics.
- [ ] **Step 3:** Implement indexed bounded traversal. Dependency paths follow CALLS/REQUIRES/READS/REFERENCES forward; impact follows the corresponding reverse uses. Communication tracing pairs compatible mechanisms via SENDS_VIA forward and HANDLES reverse, explicitly annotating that hop. Potential communication effects stay distinct from direct dependents. Exclude CONTAINS/DECLARES/MEMBER_OF from dependency traversal by default. Suppress uncontrolled hub expansion and return zero-result coverage limitations.
- [ ] **Step 4:** Rerun query tests and inspect each path's evidence. Grouping is deterministic services/folders; derived community grouping is optional and must not create dependency facts.
- [ ] **Step 5:** Commit `feat: query dependencies impact and potential communication paths`.

## Task 14: Analysis orchestration, parse cache, and cancellation

**Files:** Create `packages/core/src/pipeline.ts`, `packages/core/src/cache.ts`; `apps/local/src/worker.ts`; `tests/pipeline.test.ts`, `tests/support/analyze.ts`.

**Interfaces:** `analyze(input: Input, store: GraphStore, signal?: AbortSignal): Promise<Graph>`; `analyzeFixture(name: string, workspacePath?: string): Promise<Graph>` for integration tests; `parseCached(source: Source, signal?: AbortSignal): Promise<ParsedSource>`. Worker requests/responses use protocol IDs and report progress stage/completed/total.

- [ ] **Step 1:** Assert cold/full and cache-reused graphs match; parser-version/flags/source changes invalidate; hierarchy/export edits rerun project resolution; removing a source removes its edges. Observe helper requests to prove a warm run parses zero unchanged sources. Identical text in two scripts must reuse syntax while retaining separate script/source/symbol ownership. Cancel or fail each stage and assert the previous complete analysis/source evidence remains current. Abort must terminate owned helpers/workers without orphan processes.

  ```ts
  it('reuses_parse_facts_without_changing_graph_identity', async () => {
    await withWorkspace(async workspacePath => {
      const first = await analyzeFixture('shop/place.rbxlx', workspacePath);
      const second = await analyzeFixture('shop/place.rbxlx', workspacePath);
      expect(second.analysisId).toBe(first.analysisId);
      expect(second.evidence.map(e => e.id)).toEqual(first.evidence.map(e => e.id));
    });
  });
  ```
- [ ] **Step 2:** Run `npm run test -- tests/pipeline.test.ts`; expect orchestration/cache failures.
- [ ] **Step 3:** Compose the existing passes; content-address cache source-independent AST/spans/diagnostics by source hash/parser/flags/schema, rebinding script/source ownership on reuse before lowering/resolution. Never key only by mtime/size or cache old owner IDs. Resolve the complete project after changed hierarchy/exports, persist and publish only on success, and retain explicit partial results separately. Keep orchestration/native child-process calls in the main host; dispatch serialized CPU/SQLite tasks through worker RPC rather than transferring functions or live DB handles. Bound queues and checkpoints; main process owns timeout/cancel cleanup of helper and worker handles.
- [ ] **Step 4:** Rerun pipeline tests and the shop integration fixture from raw XML to persisted queries; this is the first full engine slice.
- [ ] **Step 5:** Commit `feat: orchestrate cancellable incremental analysis`.

## Task 15: Evidence-bearing context packs and CLI

**Files:** Create `packages/core/src/context.ts`; `apps/local/src/cli.ts`; `tests/context.test.ts`, `tests/cli.test.ts`.

**Interfaces:** `createContext(result: QueryResult, options?: { estimatedTokenBudget?: number; maxBytes?: number }): ContextPack`; `ContextPack { json: QueryResult, markdown: string, estimatedTokens: number, estimateMethod: 'characters/4', utf8Bytes: number, truncated: boolean }`. Locators/omissions live in the retained QueryResult envelope. CLI: `rograph analyze --input <place> --workspace <dir>`, `analyze --rojo <project> --workspace <dir>`, `query --workspace <dir> --analysis <id> --request <json-file>`, `export --workspace <dir> --analysis <id> --format graph|json|markdown --output <path>`. A bounded export also accepts `--request <json-file>`; without one, it starts from the default overview and includes global coverage.

- [ ] **Step 1:** Assert a scoped pack includes nearby unresolved sites even when they have no resolved neighbors; all facts cite source revision/span/property. Assert a 2,000-estimated-token request and 32,000-byte hard cap remain valid JSON/UTF-8 without severing fact records; oversized source excerpts receive omissions/locators. CLI import/query/export/reopen must preserve analysis IDs and return nonzero typed errors for invalid input.

  With `queryResult` from the dynamic-site inspection query:
  ```ts
  it('keeps_unknowns_in_a_bounded_context_pack', () => {
    const pack = createContext(queryResult, { estimatedTokenBudget: 2000, maxBytes: 32000 });
    expect(pack.json.sites.some(s => s.status === 'unresolved')).toBe(true);
    expect(pack.utf8Bytes).toBeLessThanOrEqual(32000);
    expect(pack.estimateMethod).toBe('characters/4');
  });
  ```
- [ ] **Step 2:** Run `npm run test -- tests/context.test.ts tests/cli.test.ts`; expect missing formatter/command behavior.
- [ ] **Step 3:** Rank deterministic task-sized evidence; estimate with characters/4 and enforce UTF-8 bytes separately. Keep data and instructions distinct, include snapshot limitations, and stream full graph export separately from bounded packs. CLI stdout is machine-readable when requested; progress goes to stderr. Reuse analyze/query functions.
- [ ] **Step 4:** Rerun tests and execute the documented CLI shop workflow in a temporary owned workspace. Original files must be byte-identical afterward.
- [ ] **Step 5:** Commit `feat: export bounded agent context and command-line workflows`.

## Task 16: Read-only local MCP server

**Files:** Create `apps/local/src/mcp.ts`; `tests/mcp.test.ts`; `docs/agent-setup.md`.

**Interfaces:** CLI subcommand `rograph mcp --workspace <dir>`; a read-only `workspace` discovery tool uses current/listAnalyses to return available analysis IDs, current complete ID, and optional capabilities, with a maximum page size of 100. Tools `search`, `inspect`, `source`, `dependencies`, `impact`, `trace`, `context`, `coverage` then accept explicit analysis IDs and validated parameters mapped to QueryEngine. `source` accepts only an indexed source ID/range, never a filesystem path. `context` combines a query with context-budget options.

- [ ] **Step 1:** Use the locked SDK's client to negotiate stdio, list tools, inspect the shop method, retrieve config impact/context, and verify structured errors/truncation. Assert no source-edit, arbitrary SQL, shell, filesystem traversal, or imported-project instructions can become server actions; protocol stdout must contain no logging.

  Bind `client` to the actual spawned stdio server using the locked SDK:
  ```ts
  it('exposes_read_only_indexed_graph_tools', async () => {
    const result = await client.listTools();
    expect(result.tools.map(t => t.name)).toEqual(expect.arrayContaining(['workspace', 'inspect', 'source', 'context', 'coverage']));
    expect(result.tools.some(t => ['exec', 'write_file', 'sql'].includes(t.name))).toBe(false);
  });
  ```
- [ ] **Step 2:** Run `npm run test -- tests/mcp.test.ts`; expect absent server/protocol handling.
- [ ] **Step 3:** Register read-only schema-validated tools using the pinned official SDK. Share QueryEngine and createContext; pin each request to an explicit analysis. Add shutdown handling and documented client configuration without secrets/model-provider requirements.
- [ ] **Step 4:** Rerun MCP/CLI tests; demonstrate method callers, config readers, and remote flow through the actual protocol. This is the third review checkpoint.
- [ ] **Step 5:** Commit `feat: expose evidence-backed graph queries over MCP`.

## Task 17: Local HTTP API and analysis jobs

**Files:** Create `apps/local/src/server.ts`, `apps/local/src/jobs.ts`; `tests/server.test.ts`; modify `apps/local/src/cli.ts`, `apps/local/src/worker.ts`.

**Interfaces:** `startServer(workspacePath: string): Promise<{ url: string; sessionToken: string; close(): Promise<void> }>`; routes `POST /api/imports` (uploaded .rbxlx), `POST /api/rojo-imports` (explicit project selection), `GET /api/jobs/:id`, `DELETE /api/jobs/:id`, `POST /api/query`, `POST /api/context`, `POST /api/shutdown`. CLI adds `rograph open --workspace <dir>`. `url` is the plain base URL; the CLI opens it with a session-token fragment. The browser retains the token per tab, removes the fragment from history, and sends `X-RoGraph-Session` on data/mutation requests. Tokens are not put in query strings or logs. Static assets contain no imported data.

- [ ] **Step 1:** Assert import→progress→query→cancel, large-input rejection, partial analysis labeling, stale-ID errors, and shutdown cleanup. Requests from an unrelated Origin or without the local session credential must fail; localhost/127.0.0.1 origin matching includes actual port. Rojo project selection cannot expose a general file-read endpoint.

  With `url` from startServer in an owned temporary workspace:
  ```ts
  it('rejects_cross_origin_graph_access', async () => {
    const response = await fetch(`${url}/api/query`, { method: 'POST', headers: { Origin: 'https://unrelated.example' }, body: '{}' });
    expect(response.status).toBe(403);
  });
  ```
- [ ] **Step 2:** Run `npm run test -- tests/server.test.ts`; expect API/job behavior to fail.
- [ ] **Step 3:** Bind to `127.0.0.1` on an available port, generate a local session credential, serve same-origin assets, enforce body/path limits, and run bounded jobs in workers. Reuse engine/formatter; poll compact progress rather than dumping internal commands into the user interface. Allow explicit .rbxlx file upload and optional Rojo selection only. Authenticated shutdown responds before closing the service and owned workers; closing a browser tab alone does not abandon running helpers.
- [ ] **Step 4:** Rerun server tests and verify cancel leaves the last complete analysis available while the service stays responsive.
- [ ] **Step 5:** Commit `feat: serve local analysis jobs and shared query API`.

## Task 18: Import, coverage, hierarchy, and bounded graph explorer

**Files:** Create `apps/web/index.html`, `apps/web/vite.config.ts`, `apps/web/src/main.tsx`, `apps/web/src/App.tsx`, `apps/web/src/api.ts`, `apps/web/src/ImportView.tsx`, `apps/web/src/CoverageView.tsx`, `apps/web/src/Hierarchy.tsx`, `apps/web/src/GraphView.tsx`, `apps/web/src/layout.worker.ts`, `apps/web/src/styles.css`; `tests/ui/explorer.test.tsx`, `tests/e2e/explorer.spec.ts`, `playwright.config.ts`.

**Interfaces:** `api.run(query: Query): Promise<QueryResult>` and import/job/context methods mirror Task 17. Components consume contracted results; layout worker consumes node/edge IDs and returns coordinates only.

- [ ] **Step 1:** Write user assertions: upload the fixture, see coverage and a visible unresolved count, find PurchaseService, expand functions/configuration, filter by context/type/status, and find an otherwise collapsed geometry object through hierarchy/search. Initial graph request must use the 300-node overview limit, with progressive expansion rather than a full-graph download.

  In the real-service Playwright test, bind `page` to the opened app and import the fixture:
  ```ts
  test('imports_and_exposes_coverage', async ({ page }) => {
    await page.getByLabel('Place file').setInputFiles(fixturePath('shop/place.rbxlx'));
    await page.getByRole('button', { name: 'Analyze' }).click();
    await expect(page.getByRole('heading', { name: 'Coverage' })).toBeVisible();
  });
  ```
- [ ] **Step 2:** Run `npm run test -- tests/ui/explorer.test.tsx`; expect missing accessible controls/results. Add the corresponding Playwright workflow before connecting components.
- [ ] **Step 3:** Build a three-area explorer: hierarchy/search, graph, selected detail. Render via Sigma/Graphology, compute layout in a worker, display selected snapshot/context filters and partial/truncation state. All objects remain searchable; default overview emphasizes code/config/channels and collapses unreferenced geometry. Add service/folder grouping, explicit all-object expansion, import/cancel controls, and a Stop app action calling authenticated shutdown. Bootstrap the local session as specified in Task 17 without exposing setup credentials in product screens.
- [ ] **Step 4:** Run the UI test and `npm run test:e2e -- tests/e2e/explorer.spec.ts`; expect the real service-backed import/explore workflow to pass. Check keyboard navigation, empty imports, errors, and small windows.
- [ ] **Step 5:** Commit `feat: explore imported games through bounded graph views`.

## Task 19: Relationship evidence, source inspection, and agent export UI

**Files:** Create `apps/web/src/Inspector.tsx`, `apps/web/src/SourceView.tsx`, `apps/web/src/TraceView.tsx`, `apps/web/src/ContextExport.tsx`; `tests/ui/inspector.test.tsx`, `tests/e2e/evidence.spec.ts`; modify `apps/web/src/App.tsx`, `apps/web/src/GraphView.tsx`.

**Interfaces:** Inspector consumes QueryResult.evidence/sites/sources; TraceView consumes annotated path hops; ContextExport consumes the exact ContextPack contract and downloaded bytes.

- [ ] **Step 1:** Assert selecting the shop method/config edge shows its mechanism, exact source slice, initializer label, assumptions, and every occurrence. Trace must show both remote endpoints and “potential communication.” Dynamic references remain visible with reasons. JSON-generated Rojo config must not display generated Luau coordinates as original JSON lines. Exported context must match CLI/MCP evidence for the same analysis.

  After the UI test selects the real shop trace:
  ```ts
  test('shows_trace_uncertainty_and_source', async ({ page }) => {
    await expect(page.getByText('Potential communication', { exact: true })).toBeVisible();
    await expect(page.getByText('Config.Prices.Sword', { exact: true })).toBeVisible();
  });
  ```
- [ ] **Step 2:** Run `npm run test -- tests/ui/inspector.test.tsx`; expect absent evidence controls/rendering.
- [ ] **Step 3:** Implement deterministic explanations over existing evidence, decoded-source highlighting, original/generated toggles, incoming/outgoing dependencies, potential-impact and trace actions, and JSON/Markdown downloads. Render imported comments/text safely as data; no HTML execution or generated authoritative prose.
- [ ] **Step 4:** Run UI tests and `npm run test:e2e -- tests/e2e/evidence.spec.ts`; manually follow BuySword→remote→onPurchase→TryPurchase→Prices.Sword with evidence at every step.
- [ ] **Step 5:** Commit `feat: inspect exact relationship evidence and export agent context`.

## Task 20: Snapshot differences and optional Rojo watching

**Files:** Create `packages/core/src/diff.ts`, `packages/core/src/watch.ts`; `tests/updates.test.ts`; modify `packages/core/src/pipeline.ts`, `apps/local/src/server.ts`, `apps/local/src/jobs.ts`, `apps/web/src/CoverageView.tsx`.

**Interfaces:** `diffGraphs(before: Graph, after: Graph): GraphDiff`; `watchProject(projectPath: string, onChange: (input: Input) => Promise<void>, signal: AbortSignal): Promise<void>`. `GraphDiff { addedRelationIds: string[], removedRelationIds: string[], changedRelations: { beforeId, afterId, reason }[], ambiguousMatches: { beforeIds: string[], afterIds: string[], reason }[] }`. Match logical identities before comparing relations because snapshot-scoped IDs change with input hashes. Expose differences through `POST /api/diff` with explicit before/after analysis IDs and the coverage view.

- [ ] **Step 1:** Assert source-only edits with identical sourcemap structure trigger reanalysis; add/remove/rename/config/directory membership changes invalidate. Incremental output must equal a fresh build after normalization. Ambiguous rename matches stay ambiguous. A watch change during capture must restart capture or fail explicitly, never mix output revisions; stopped watchers release handles.

  Bind `before` and `after` to actual analyses before/after adding a new module require in an owned fixture copy:
  ```ts
  it('reports_new_dependencies_after_reimport', () => {
    const difference = diffGraphs(before, after);
    expect(difference.addedRelationIds.length).toBeGreaterThan(0);
    expect(difference.ambiguousMatches).toEqual([]);
  });
  ```
- [ ] **Step 2:** Run `npm run test -- tests/updates.test.ts`; expect update/difference behavior to fail.
- [ ] **Step 3:** Compare saved identities or unique hierarchy/class/content signatures; never identify objects by name alone. Watch all included source/config/directory changes with a 500 ms debounce, rebuilding a new immutable capture before analysis. Keep only one running and one coalesced pending job per watched project. Publication changes the selected complete analysis atomically; viewers are offered the new analysis ID, not silently mixed evidence.
- [ ] **Step 4:** Rerun update and pipeline tests; compare canonical full/incremental graph JSON and confirm stale removed edges disappear.
- [ ] **Step 5:** Commit `feat: compare snapshots and refresh watched Rojo projects safely`.

## Task 21: Scale, traversal budgets, and measured performance

**Files:** Create `scripts/benchmark.ts`, `tests/limits.test.ts`, `docs/performance.md`; modify `packages/core/src/store.ts`, `packages/core/src/query.ts`, `apps/web/src/layout.worker.ts` only where measurements justify it.

**Interfaces:** `npm run bench -- --profile release --output <report.json>` generates synthetic inputs with documented counts and produces machine-readable hardware/input/timing/memory measurements. Synthetic source never executes.

- [ ] **Step 1:** Assert exact depth/node/occurrence/path/export/import defaults from this plan; cycles terminate, hub truncation is explicit, and Unicode budget cuts remain valid. Add a browser assertion that expanding one neighborhood does not request all nodes.

  With `result` a real query over a synthetic hub exceeding the default limits:
  ```ts
  it('bounds_hub_traversal_without_hiding_the_cutoff', () => {
    expect(result.nodes.length).toBeLessThanOrEqual(1000);
    expect(result.meta.truncated).toBe(true);
    expect(Object.values(result.meta.omittedCounts).some(n => n > 0)).toBe(true);
  });
  ```
- [ ] **Step 2:** Run `npm run test -- tests/limits.test.ts`; expect missing limit/report behaviors to fail rather than suppressing inconvenient inputs.
- [ ] **Step 3:** Build benchmark sets through 50,000 Instances/1,000 scripts/100,000 source lines/100,000 relationship occurrences. Measure cold analysis, warm bounded queries, first overview, and aggregate peak memory across service/workers/helpers/browser. Record medians and slow cases plus exact input bytes/hardware. Optimize only measured bottlenecks using existing interfaces; document an explicit supported-scale limitation or reopen the architecture if targets cannot be met.
- [ ] **Step 4:** Run limits tests, the release benchmark, and the large-graph browser workflow. Report measured results against <60 s, <500 ms, <3 s, and <2 GB; these numbers are targets until demonstrated.
- [ ] **Step 5:** Commit `perf: validate graph scale and explicit resource budgets`.

## Task 22: Portable Windows package and release acceptance

**Files:** Create `scripts/package-windows.ps1`, `scripts/release-smoke.ps1`, `native/launcher/Cargo.toml`, `native/launcher/Cargo.lock`, `native/launcher/src/main.rs`, `README.md`, `docs/user-guide.md`, `docs/troubleshooting.md`, `docs/release-validation.md`, `THIRD_PARTY_NOTICES.md`; modify build scripts/lock manifest as required.

**Interfaces:** `npm run package:windows` produces an owned `dist/windows-x64/` directory containing `RoGraph.exe`, pinned Node runtime, compiled app/CLI/MCP, static assets, native helpers, notices/checksums, and optional separately pinned Rojo assets if bundling passed its evaluation. No Electron/Tauri or experimental single-executable packaging is required.

- [ ] **Step 1:** Write package smoke assertions: all manifest hashes match, helpers start, a space/Unicode installation path works, launcher opens the local UI without extra console windows, CLI/MCP subcommands work, and shutdown kills only owned workers. On an offline machine without development tools, import→inspect→trace→export→reopen must reproduce evidence.

  The smoke script accepts an explicit PackagePath and emits typed failures, including:
  ```powershell
  if (-not (Test-Path -LiteralPath (Join-Path $PackagePath 'RoGraph.exe'))) {
      throw 'MISSING_LAUNCHER'
  }
  ```
- [ ] **Step 2:** Run `powershell -NoProfile -File scripts/release-smoke.ps1 -PackagePath dist/windows-x64`; expect missing-package failure until packaging exists.
- [ ] **Step 3:** Build a hidden Windows launcher that forwards explicit argv to the bundled runtime with safe quoting and preserves stdio for CLI/MCP modes. Package runtime dependencies or link helpers appropriately; emit checksums/notices and publishable docs. Optional tool absence receives a clear capability message; direct .rbxlx still works. Do not modify machine-wide PATH or install services.
- [ ] **Step 4:** Run `npm run typecheck`, `npm test`, `npm run build`, locked native tests/builds, `npm run test:e2e`, `npm run bench -- --profile release --output build/release-benchmark.json`, package, and the smoke script. Record clean-machine/offline evidence and a representative real-place validation; if the latter is unavailable, explicitly retain fixture-validated status. Confirm original/reference files are unchanged and the product diff contains only intended files. This is the final whole-product review checkpoint.
- [ ] **Step 5:** Commit `release: package and validate the local Roblox knowledge graph app`. Do not publish externally or claim supported scale/real-project compatibility beyond recorded evidence.

## Completion and execution handoff

The user-facing release must answer all six questions from the accepted design through both the viewer and agent interfaces. The reference trace must preserve source evidence at each hop. An importer alone, a graph rendering alone, or an agent export alone is an intermediate milestone.

This plan adds no cloud account, model calls, Studio runtime capture, source editing, or syncback migration to v1. A failed optional-tool evaluation is recorded and does not block direct place analysis; an importer/parser fidelity failure is a foundational blocker to resolve before downstream implementation.

Self-review mapping: design structure/identity/evidence → Tasks 1–4 and 11–12; Luau/modules/calls/config/context → Tasks 6–10; Rojo/LSP → Tasks 5 and 20; human workflow → Tasks 17–19; agent operations → Tasks 13, 15–16; snapshot correctness → Tasks 12, 14, 20; scale and release → Tasks 21–22. All five Review Focus conditions have owning test tasks. Shared names/signatures and relation directions were checked across task boundaries.

Recommended execution method: **Native**, implementing tasks in this session with focused intermediate checks and an independent final review. Most tasks share tightly coupled contracts; the sequential plan carries the design and avoids reloading full context for every task. Subagent-driven execution remains an option for a fresh implementer/reviewer pair per task, with greater review overhead.

Before implementation, ask the user to review this plan and select Native or Subagent-driven execution as required by the writing-plans workflow. Preserve that choice thereafter; do not re-request routine implementation approval.
