# RoGraph: proposed design and delivery roadmap

Date: 2026-10-30  
Status: accepted by the user on 2026-10-30; product implementation has not started.  
Product name: RoGraph.

## 1. Purpose and decisions

Build a tool that turns a saved Roblox place into an explorable, evidence-backed knowledge graph. Humans should understand how their game fits together. AI agents should retrieve the precise code, objects, settings, and dependencies relevant to a task without reading the entire place.

The user confirmed **saved-file analysis first, with Studio capture later**. They delegated platform and input-format selection. My proposal is a **local application with a browser interface**, initially importing **`.rbxlx`**. Roblox's binary place extension is `.rbxl`; XML is easier to inspect while validating the importer, rather than intrinsically more complete. Both are supported Roblox export formats. [Roblox place files](https://create.roblox.com/docs/projects/place-files).

The user also authorized using **Rojo where it helps the app or fills gaps**. Include an early Rojo integration evaluation and an optional project adapter where validated. Direct saved-place import must remain usable without Rojo. The user does not need to clone Rojo's repository; development can use a pinned release and consult or obtain upstream source when necessary.

The unit of import is one saved place, not an entire multi-place experience. The app must show that boundary explicitly. No actual game file was supplied in the current workspace, so compatibility and performance targets below are proposed targets, not measured results.

### What success looks like

An imported place answers these questions with navigable evidence:

1. What does this script or module depend on, and what depends on it?
2. Which specific functions call a module's exported method?
3. Which functions read or modify a configuration field, Attribute, or Value object?
4. How does a client action connect through a particular remote to server code?
5. What known dependencies might be affected by changing a function or setting?
6. Which relevant relationships remain unresolved, and why?

The first release needs both a useful viewer and a machine-readable context interface. Neither can be a decorative add-on.

## 2. Approaches considered

| Approach | Benefits | Cost or limitation | Decision |
| --- | --- | --- | --- |
| Local application with browser UI and local analysis service | Keeps place contents on the machine; supports native parsers, persisted indexes, a CLI, and agent access through one engine | Requires packaging and starting a local service | Proposed platform; chosen by me under the user's delegated platform decision |
| Browser-only application | Simple distribution; processing could stay in-browser | Native parser integration, persistent indexing, and local agent access become harder | Do not use for the first release |
| Studio companion as the initial product | Can later contribute runtime observations and current Studio state | Adds plugin installation and instrumentation scope; a recorded session still cannot establish all possible runtime behavior | Deferred by the user's explicit choice |

A hosted service is unnecessary for the current single-machine workflow. Accounts, uploads, collaboration, and hosted model calls are outside the first release.

This is a substantial new project. The hard part is reliable Roblox relationship resolution, rather than drawing the graph.

## 3. What the graph represents

### Layers

Import every serialized Instance into the underlying model. A Roblox place contains an object hierarchy with embedded script source, rather than a conventional directory of source files.

The graph has three connected layers:

- **Place structure:** services, folders, scripts, models, UI, remotes, bindables, Value objects, saved Attributes/tags, relevant properties, and serialized object references.
- **Code and configuration:** functions, methods, local/module bindings, exported table members, configuration fields, and supported reads/writes.
- **Derived views:** script-to-script dependency summaries, potential communication paths, impact results, and suggested system groups.

Scripts are Instance nodes with script metadata. Function and configuration nodes belong to those scripts or objects. A summarized edge between two scripts retains links to all underlying occurrences, such as three method calls and two setting reads.

### Identity

Names and dotted paths are display labels, never unique identifiers. Siblings may share names. Resolve serialized references using the file's referents, then assign deterministic snapshot IDs from canonical hierarchy traversal, including sibling ordinals. Do not expose a reader library's generated in-memory IDs as persistent graph IDs. Retain original referents as provenance where present. A synthetic DataModel root is marked synthetic and excluded from imported-Instance counts. Each analysis also records the input hash and importer, parser, resolver, and schema versions.

Code nodes carry the owning script identity and lexical identity/source span. Every evidence record identifies the exact source revision. The same input analyzed with the same versions must produce deterministic IDs and ordering.

Referents need not remain stable across saves. Cross-snapshot matching uses a verified saved identity when available, otherwise a unique combination of hierarchy, class, and content signatures. Ambiguous matches are reported; the app must not silently treat a guessed rename as certain. Correct rebuilding takes priority over clever incremental matching.

### Relationship contract

Store a directed multigraph. Different relation types and repeated occurrences must survive persistence and export.

| Relationship | Meaning |
| --- | --- |
| `CONTAINS`, `DECLARES` | Structural ownership |
| `REQUIRES` | A script requires an identified module or external dependency |
| `CALLS` | A source call resolves to a specific function or method under recorded assumptions |
| `READS`, `WRITES` | Code accesses an identified configuration field, Attribute, Value, or supported property |
| `REFERENCES` | A serialized property or code expression refers to an Instance |
| `SENDS_VIA`, `HANDLES` | A send site and a callback registration use an identified remote or bindable |
| `CONNECTS_SIGNAL` | Code registers a callback on a supported Instance signal |
| `MEMBER_OF` | A derived grouping, with its derivation recorded |

Direction is relation-specific and documented. For `CALLS`, `REQUIRES`, and `READS`, A → B means A uses B. Impact analysis follows reverse dependency relations, with explicit transitions for writes and communication. Containment and grouping are excluded from dependency impact by default.

There is no unexplained generic “influences” fact. A broad influence result is an explanatory path through the typed relationships.

## 4. Evidence and uncertainty

Every relationship occurrence stores:

- Source and target IDs, relation type, and analysis/snapshot identity.
- Owning script and exact source span, or owning Instance and serialized property.
- Original source revision/hash and enough provenance to reopen the evidence.
- Resolution rule and assumptions, such as a literal child lookup or module export binding.
- Resolution status, candidate targets where applicable, and diagnostic reason.
- Execution context where known or inferred: client, server, shared template, or unknown.

Use four initial statuses:

| Status | User-facing interpretation |
| --- | --- |
| Saved fact | Directly present in the imported hierarchy/property/source declaration |
| Statically resolved | An analysis rule resolved this reference under stated assumptions |
| Candidate | Multiple targets or conditional assumptions prevent a unique conclusion |
| Unresolved | The reference was found, but the target could not be established |

An unresolved site is still represented as a reference record/node; it is not an invented edge to a convenient same-named target. Numeric confidence percentages are unnecessary unless later calibrated against ground truth.

“Statically resolved” does not prove execution. A branch can be unreachable, objects can be changed at runtime, and a handler may never run. A zero-result impact query means “no modeled dependents found,” with coverage information; it never means “proven safe.”

Show parse failures, unsupported syntax, unresolved references, external modules, and incomplete imports in a coverage report. Keep counts by category with explicit denominators; a reference-resolution ratio is not a measure of total runtime completeness.

## 5. Analysis scope for the first release

### Import

Preserve hierarchy, classes, names, serialized values/references, script source, Attributes/tags where represented, and relevant script metadata. Retain original input bytes and report unsupported property types. Script spans index the decoded source without additional newline/formatting normalization; raw XML remains available separately. An import with lost information must be marked partial or rejected, never silently marked complete.

Build a lightweight raw XML inventory of Items, original referents, property names/types, and reference targets alongside typed decoding. Compare this inventory with the normalized result. Configure the reader to retain unknown properties where possible, and record any unsupported types or dangling references that it cannot preserve. This is necessary because `rbx_xml` defaults to ignoring unknown properties and rewrites referents to its own internal IDs. [Reader implementation](https://github.com/rojo-rbx/rbx-dom/blob/master/rbx_xml/src/deserializer.rs).

Disabled scripts remain inspectable. Execution context uses script class, saved location, and RunContext rather than assuming every Script runs on the server. ModuleScripts are interpreted in caller context. Starter templates are saved objects; inferred client copies are not fabricated saved Instances. [Script locations](https://create.roblox.com/docs/scripting/locations), [ModuleScript behavior](https://create.roblox.com/docs/reference/engine/classes/ModuleScript).

### Luau and reference resolution

Use an AST, lexical scopes, and bounded dataflow instead of regular-expression dependency detection. Initial supported patterns include:

- `script`, `Parent`, direct child expressions, `game:GetService`, literal `WaitForChild`/`FindFirstChild`, and local aliases.
- Requires through resolved ModuleScript Instances and literal string paths. Current Roblox documentation includes `./`, `../`, `@self/`, and `@game/` paths; implement their documented resolution semantics and test them rather than assuming filesystem paths.
- Numeric asset requires as external dependencies whose source is unavailable unless separately provided.
- Local functions, table methods, dot/colon calls, simple returned-module tables, supported aliases, and explicit exported members.
- Literal configuration-table fields; literal `GetAttribute`/`SetAttribute`; Value-object `.Value` accesses; and direct supported property accesses.
- Callback registration on remotes, bindables, and common signals, including named and inline callback functions.

Require-by-string and asset-ID behavior must follow the pinned compatibility rules. [Roblox require reference](https://create.roblox.com/docs/reference/engine/globals/LuaGlobals).

Bound the analysis of reassignment, returned tables, cycles, and aliases. Never join unrelated methods merely because they have the same name. Metatable dispatch, dynamically assembled paths/keys, framework service registries, higher-order calls, and arbitrary runtime object changes can remain unresolved with precise reasons in v1.

Config values are shown as saved values or literal initializers. The tool does not claim an initializer is the runtime value after arbitrary mutation.

### Communication

Join remote/bindable endpoints by resolved Instance identity. Record send sites, handler-registration sites, mechanisms, and direction. A send → remote → handler path means potential communication through that object, not proof that a particular invocation executes that handler. Preserve client/server boundaries and implicit API arguments in the explanation. [Roblox remote documentation](https://create.roblox.com/docs/scripting/events/remote).

### Optional Rojo integration

For an existing Rojo project, evaluate a pinned Rojo CLI as a project-building and source-mapping adapter. Build a temporary `.rbxlx` from the selected project, feed it through the same importer, and attach the matching Rojo sourcemap. This delegates Rojo's project configuration, filesystem-to-Instance rules, and generated modules to Rojo. Include non-script objects in the map where supported. [Project format](https://rojo.space/docs/v7/project-format/), [build implementation](https://github.com/rojo-rbx/rojo/blob/v7.7.1/src/cli/build.rs), [sourcemap implementation](https://github.com/rojo-rbx/rojo/blob/v7.7.1/src/cli/sourcemap.rs).

The sourcemap supplies Instance-to-file provenance, not statement-level source mappings or dependency relationships. Code spans still come from analysis of the exact script source. For generated JSON/TOML modules, retain both original input and generated source; do not claim generated Luau line numbers are original configuration-file line numbers. Validate any field-level mapping separately. [Rojo data-module behavior](https://rojo.space/docs/v7/sync-details/).

Build output, sourcemap, and indexed source must describe the same captured project revision. Record the selected project path, Rojo version, input hashes, generated-content status, and mapping diagnostics. Ambiguous or stale associations stay unresolved. A Rojo-built snapshot covers the configured project; objects that exist only in Studio are outside that input's coverage. Do not automatically merge separately captured Studio/place and filesystem states.

When project watch mode is useful, watch script/config content as well as sourcemap structure. Sourcemap changes alone do not detect every source edit. Reuse the existing invalidation and atomic-publication rules. The first integration can use explicit rebuild/reimport; continuous watching follows after correctness is established.

Evaluate `luau-lsp` on the reference fixtures to see whether its Rojo-aware definitions, references, and call hierarchy can reduce custom resolution work. Keep it only where results preserve the required provenance and uncertainty contract; it does not supply the complete configuration/remote graph. [Luau Language Server](https://github.com/JohnnyMorganz/luau-lsp#for-rojo-users-requires-v730).

Rojo 7.7's `syncback` can later support an explicit place-to-project export workflow. It writes a configured project tree and is not part of read-only graph import. [Rojo 7.7 release](https://github.com/rojo-rbx/rojo/releases/tag/v7.7.0).

### Explicit limits

The snapshot cannot establish all runtime-generated/cloned/reparented objects, computed dispatch, downloaded code, live service state, unimported places, or the current contents of external assets. Imported package children are the saved copy. Mesh/audio/image references need not contain the underlying media. These limits must accompany affected query results, rather than exist only in documentation. [Roblox projects](https://create.roblox.com/docs/projects), [Packages](https://create.roblox.com/docs/projects/assets/packages).

## 6. Proposed architecture

The data flow is:

Saved place → normalized Instance model → per-script AST facts → project-wide Roblox resolver → graph/evidence store → shared query engine → viewer, CLI, exports, and agent tools.

Optional Rojo project → pinned build and matching sourcemap → the same saved-place import path, with filesystem provenance attached.

Proposed components, selected by me:

- **TypeScript local service and analysis/query core.** One set of semantics serves all interfaces. Run analysis in workers so import progress and cancellation remain responsive.
- **Rust import helper using `rbx-dom`'s `rbx_xml`.** A typed Roblox reader reduces the cost of implementing the serialized property system. Its shared DOM also gives a path to `rbx_binary`. These are third-party libraries. [rbx-dom project](https://github.com/rojo-rbx/rbx-dom).
- **Optional pinned Rojo CLI adapter.** Use a tested release rather than requiring an upstream checkout. Evaluate project build/sourcemap integration and Rojo-aware `luau-lsp` resolution during the initial spike. Keep direct `.rbxlx` import independent of both tools; decide whether to bundle or discover the optional CLI during packaging.
- **Pinned official Luau parser through a small local helper.** Upstream supplies AST JSON machinery. Wrap or configure it deliberately: the current CLI enables Luau-prefixed flags, so a stock executable must not be assumed to match Studio's exact feature set. [Official AST CLI](https://github.com/luau-lang/luau/blob/master/CLI/src/Ast.cpp), [Parser API](https://github.com/luau-lang/luau/blob/master/Ast/include/Luau/Parser.h).
- **SQLite with indexed node, relation, occurrence/evidence, source, diagnostic, and snapshot tables; FTS for source/symbol search.** Use indexed adjacency and bounded traversals. A separate graph-database server is unnecessary for the first release.
- **React browser interface, with Sigma.js/Graphology as the proposed graph renderer.** Validate renderer behavior against the benchmark before committing to layout details. Keep layout in a worker and request bounded subgraphs from the service. [Sigma project](https://www.sigmajs.org/).
- **JSON and Markdown context export plus read-only MCP tools.** No model provider, API key, embedding service, or generated interpretation is required for deterministic graph extraction. [MCP architecture](https://modelcontextprotocol.io/docs/learn/architecture).

The native-helper boundary is a real packaging cost. Phase 1 validates exact source spans, JSON contracts, batching, cancellation, Windows builds, and distribution before large resolver work. Ship tested helpers/runtime in the Windows package so end users do not need Rust, C++, or Node installed. If that packaging fails the spike, revise this boundary before implementation expands.

Persist imported source as immutable snapshot content. Publish an analysis atomically only after its internal checks pass. Queries pin one analysis ID; a refresh never combines an old graph with new evidence.

## 7. Human workflow

1. Open the local app and import a saved place.
2. See import coverage, script/object counts, execution-context summaries, and diagnostics.
3. Explore an overview grouped by service, folder, or suggested system.
4. Expand a script's neighborhood, then its functions, methods, and configuration fields.
5. Select a connection to read what uses what, the mechanism, exact supporting source/property, assumptions, and unresolved alternatives.
6. Run dependency, potential-impact, or connection-path exploration, then export the selected context for an agent.

All imported objects remain accessible in a tree/search view. The default canvas emphasizes scripts, configuration, remotes, and referenced objects; unreferenced geometry is collapsed. Offer an explicit all-objects view with progressive expansion. Large imports must remain useful without downloading or laying out the entire graph.

Filters cover relationship type, depth, evidence status, client/server context, object class, and system. Structural edges and speculative candidates can be toggled separately. Search ranking and automatic grouping never manufacture dependency facts.

Explanations initially use deterministic templates over evidence. Example: “PurchaseService.TryPurchase reads ShopConfig.Prices at this source location.” A remote path shows both endpoint sites and calls itself a potential communication path. Optional model-written summaries, if ever added, remain a separate later feature.

## 8. AI-agent interface

Expose focused, read-only operations over the same query engine:

| Operation | Returns |
| --- | --- |
| Search | Ranked matching Instances, symbols, and settings, with unambiguous IDs |
| Inspect | Definition/source, incoming/outgoing relations, and evidence |
| Dependencies | Bounded outgoing dependencies filtered by relation/context |
| Impact | Bounded reverse dependencies and potential communication effects, with coverage limitations |
| Trace | Direction-aware connection paths with evidence at every hop |
| Context pack | Task-sized JSON/Markdown containing selected source, graph facts, and unresolved boundaries |
| Coverage | Import/parse/resolution diagnostics and analysis versions |

Results include analysis ID, source hashes/locators, scope and truncation metadata, pagination/continuation where needed, and deterministic ordering. Specify that context budgets are approximate token estimates unless an actual tokenizer is used; return the estimation method and a hard byte/character cap.

Context packs include unresolved sites in the selected scope even when those sites have no resolved graph neighbors. Otherwise, an agent would see a misleadingly complete neighborhood. Project-wide unresolved counts are available separately.

MCP runs locally over stdio; the browser uses a loopback API. Do not expose arbitrary query execution or file access. Treat imported scripts/comments as project data, not instructions to the agent or app. No imported Luau is executed during analysis.

## 9. Detailed delivery sequence

Each stage produces a reviewable result and has an exit condition. The exact task/file breakdown and estimates can be settled after design review.

### Stage 1 — Prove fidelity and define contracts

Create a small, inspectable fixture place and expected facts: modules, duplicate names, config reads/writes, remotes, disabled scripts, Attributes, and an external require. Add realistic Luau syntax and broken-script cases. Validate the importer/parser helper approach and define versioned intermediate schemas, edge direction, evidence spans, and diagnostics.

Create a minimal equivalent Rojo fixture. Compare its built hierarchy and script source with direct import, validate sourcemap associations, and probe `luau-lsp` on the supported resolution cases. Record which gaps Rojo or the language server actually removes, along with packaging and fidelity costs, before adopting additional integration. Include generated configuration and a deliberately stale sourcemap as negative cases.

**Exit:** exact script text, unique object identity, serialized references, correct spans including Unicode/CRLF, parse errors, and a reproducible Windows helper build are demonstrated. No graph UI work should precede this evidence.

### Stage 2 — Import the complete saved hierarchy

Read `.rbxlx`, preserve source and relevant properties, resolve serialized referents, extract metadata, and produce an import manifest. Provide progress/cancel, resource limits, unknown-property diagnostics, and explicit partial-import handling.

Where Stage 1 validates the benefit, add the optional Rojo project adapter using a pinned build plus matching sourcemap. Surface project scope, external file provenance, generated source, and unresolved mappings through the same manifest.

**Exit:** fixture inventory matches its known contents; duplicate sibling names remain distinct; malformed input cannot replace a previous successful analysis.

### Stage 3 — Extract script facts

Parse every script; build lexical scopes, functions/methods, bindings, returned tables, call sites, config-field sites, and source indexes. Preserve unsupported or invalid scripts as visible diagnostic-bearing nodes. Keep parse facts independent of project-wide resolution.

**Exit:** golden fixtures establish correct declarations and spans without merging same-named symbols or silently dropping failed scripts.

### Stage 4 — Resolve Roblox module and object dependencies

Implement the declared Instance-path, alias, literal lookup, require, and exported-member rules. Represent missing targets, dynamic references, external assets, and require cycles explicitly. Track RunContext/location/caller assumptions.

**Exit:** module dependencies resolve to the intended Instance, including string requires; ambiguous lookups and runtime-only targets remain unresolved/candidates rather than guessed links.

### Stage 5 — Add method and configuration relationships

Resolve supported cross-module calls and dot/colon receivers. Add per-field table configuration, Attribute, Value-object, and direct property reads/writes. Attach every occurrence to its enclosing function or top-level script.

**Exit:** a config-field query lists exact known readers/writers and all source sites. Repeated calls survive storage. Mutation/dynamic-key limitations are visible.

### Stage 6 — Connect communication and execution context

Extract remote/bindable send sites and handler registrations, plus supported signal callbacks. Match by object identity and annotate potential communication paths and execution boundaries.

**Exit:** the reference gameplay action traces client function → remote → server callback → service method → config read; another remote with the same name is excluded.

### Stage 7 — Persist and query trustworthy graph snapshots

Implement SQLite storage and source/evidence retention, deterministic analysis manifests, atomic publication, search, inspect, dependency traversal, impact, and path queries. Define relation-specific impact transitions. Include unresolved sites and traversal limits in results.

**Exit:** close/reopen reproduces the same graph and evidence; stale IDs are identified; canceled/failed analyses leave the last successful snapshot intact; zero-result impact responses retain limitations.

### Stage 8 — Build the human explorer

Implement import/coverage views, hierarchy/search, aggregated overview, neighborhood expansion, function/config drill-down, relationship inspection with source, and dependency/impact/path controls. Grouping starts with deterministic services/folders; optional community grouping follows a useful weighted dependency projection.

**Exit:** the acceptance examples can be completed from the interface with no manual source hunting. A large import works through summaries and bounded neighborhoods, without loading all nodes into the canvas.

### Stage 9 — Deliver agent context

Add versioned graph JSON, task-sized Markdown/JSON context packs, CLI access, and read-only MCP tools. Reuse the query engine; validate all result contracts and budget/truncation behavior. Provide setup and example workflows for an agent consumer.

**Exit:** an agent can identify callers of a method, readers of a setting, and a potential remote flow using source-bearing results; unavailable targets and truncated context remain explicit.

### Stage 10 — Reimport, performance, and correctness hardening

Cache per-script parse facts by source hash plus parser/options/schema version. Reuse unchanged parse facts; rerun project-wide resolution when the hierarchy or exports change. Invalidate removed objects/edges correctly. Compare incremental output with a fresh full analysis. Snapshot differences classify added/removed/changed relationships; ambiguous identity matching stays visible.

For adopted Rojo integration, include project/config changes, source-content edits that leave the sourcemap unchanged, generated modules, removed files, and stale build/map combinations in invalidation tests. Add optional project watch mode only after explicit rebuild/reimport produces correct snapshots.

Proposed benchmark: a Windows machine with 16 GB RAM; fixture sets up to 50,000 Instances, 1,000 scripts totaling 100,000 source lines, and 100,000 relationship occurrences. Record input bytes as well as source/object counts. Target cold analysis under 60 seconds, bounded warm queries under 500 ms, first overview under 3 seconds after analysis, and peak total memory below 2 GB. Record exact hardware/input and report measured medians and slow cases. These are initial acceptance targets to validate, not performance claims; adjust documented limits or architecture explicitly if evidence requires it.

**Exit:** reimport/full-rebuild equivalence passes, removed edges disappear, unrelated layout expansion stays responsive, and the published benchmark identifies supported scale and remaining bottlenecks.

### Stage 11 — Package and validate the first release

Ship a Windows-first launcher, local UI/service/runtime, importer/parser helpers, CLI/MCP entry points, dependency notices, and usage/troubleshooting docs. Bind the UI service to loopback, validate request origins and session access, and shut workers down cleanly. Run an offline import → inspect → trace → export → reopen check on a machine without development tools.

The release review uses the synthetic fixtures plus at least one representative real `.rbxlx` place supplied during implementation. If no representative place is available, describe the result as fixture-validated rather than claiming broad real-project compatibility.

**Exit:** all first-release acceptance examples pass through both UI and agent-facing interfaces, with no source modification, network requirement, or hidden partial analysis.

## 10. Test and review strategy

Prioritize tests for meaningful correctness risks: object identity, source fidelity, lexical scoping, require/module exports, call receivers, config mutation, remote identity, evidence persistence, partial imports, stale snapshots, and incremental invalidation. Add negative fixtures specifically designed to catch plausible false edges.

Use one shared reference gameplay fixture with expected graph facts. Test real UI workflows and machine-readable contracts against those same facts. Separate supported-pattern precision from unresolved coverage; do not improve a headline resolution rate by guessing targets.

Review importer/parser contracts before the resolver grows, then review evidence/query semantics before UI and MCP consume them. Product completion requires full-path checks, not just successful unit tests or a visually attractive graph.

## 11. Later extensions

After the static first release: `.rbxl` through the same normalized importer; multi-place workspace manifests; deeper Rojo workflows such as explicit syncback export; stronger framework adapters; Studio snapshot synchronization and explicitly instrumented runtime observations; more advanced interprocedural/type-assisted analysis.

Runtime evidence will have a separate status with session, context, timestamp, and instrumentation coverage. Absence from a recorded session never proves a connection cannot occur. A Studio companion should not promise to intercept every call or remote automatically.

## 12. Lessons verified in the supplied references

### Graphify

Adopt its staged extraction/resolution/build pipeline, evidence categories, bounded graph retrieval, and source-bearing agent context. Preserve richer occurrence evidence than its source/target/relation deduplication. Its supplied Go checkout handles Lua patterns but lacks a Roblox importer and complete Luau/object-path semantics. Its current product scope excludes a human viewer, so older HTML artifacts and viewer plans are not a ready UI implementation.

Sources: [pipeline](https://github.com/dobbo-ca/graphify-go/blob/7213789dc9ce9eeb768fe0209f792f7553b21d5b/cmd/graphify/main.go), [Lua extraction](https://github.com/dobbo-ca/graphify-go/blob/7213789dc9ce9eeb768fe0209f792f7553b21d5b/internal/extract/lua.go), [graph model](https://github.com/dobbo-ca/graphify-go/blob/7213789dc9ce9eeb768fe0209f792f7553b21d5b/internal/model/model.go), [query context](https://github.com/dobbo-ca/graphify-go/blob/7213789dc9ce9eeb768fe0209f792f7553b21d5b/internal/query/ask.go), [current scope](https://github.com/dobbo-ca/graphify-go/blob/7213789dc9ce9eeb768fe0209f792f7553b21d5b/README.md).

### GitNexus

Adopt layered structural/symbol/derived models, separate parsing and cross-file resolution, addressable config fields, explicit communication intermediary nodes, coverage-aware queries, and bounded graph exploration. The supplied checkout does not list Lua/Luau among supported languages. Its persisted relation schema does not retain all structured evidence advertised by its shared types, so this app must define provenance storage explicitly.

Sources: [graph types](https://github.com/abhigyanpatwari/gitnexus/blob/cfe418cca095cec471c144e837c45bef41d05a1b/gitnexus-shared/src/graph/types.ts), [language list](https://github.com/abhigyanpatwari/gitnexus/blob/cfe418cca095cec471c144e837c45bef41d05a1b/gitnexus-shared/src/languages.ts), [resolver contract](https://github.com/abhigyanpatwari/gitnexus/blob/cfe418cca095cec471c144e837c45bef41d05a1b/gitnexus/src/core/ingestion/scope-resolution/contract/scope-resolver.ts), [persistent schema](https://github.com/abhigyanpatwari/gitnexus/blob/cfe418cca095cec471c144e837c45bef41d05a1b/gitnexus/src/core/lbug/schema.ts), [large-graph handling](https://github.com/abhigyanpatwari/gitnexus/blob/cfe418cca095cec471c144e837c45bef41d05a1b/gitnexus-web/src/lib/graph-load-decision.ts).

The supplied Graphify checkout is MIT-licensed; GitNexus carries PolyForm Noncommercial 1.0.0. The implementation default is independently written code using these architectural lessons. Retain applicable notices for any permissive dependencies or copied portions; do not assume GitNexus code can be incorporated into a commercially distributed app. [Graphify license](https://github.com/dobbo-ca/graphify-go/blob/7213789dc9ce9eeb768fe0209f792f7553b21d5b/LICENSE), [GitNexus license](https://github.com/abhigyanpatwari/gitnexus/blob/cfe418cca095cec471c144e837c45bef41d05a1b/LICENSE).

## 13. Remaining builder decisions

The builder may choose exact dependency versions, module/file layout, UI styling, worker pool sizes, SQLite indexes, and individual algorithm optimizations within this design. Pin and record parser/API compatibility rather than choosing unversioned latest dependencies.

Decisions that would change the product require revisiting this design: adding cloud uploads or model calls, requiring Studio for v1, dropping method/configuration explanations, excluding machine-readable agent access, replacing unresolved references with guesses, or claiming runtime-complete analysis.

After this design is reviewed, the implementation plan should turn each stage into bounded tasks with concrete files, fixtures, commands, and acceptance evidence. No source code has been scaffolded, dependencies installed, or reference repositories modified as part of this proposal.
