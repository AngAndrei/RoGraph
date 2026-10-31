# Linked Gameplay and Code Views Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Explain game structure and gameplay with evidence-backed connections between real project objects/files, while retaining Code inspection and improving common reference resolution.

**Architecture:** One canonical graph, two shared-core projections. A bounded shared value engine supplies platform recognition, configuration alternatives, callback/object flow and allocation provenance. Gameplay records summarize effects on concrete anchors; actions and symbolic allocation identities are not invented canvas objects.

**Tech Stack:** Existing Node 24.19+, TypeScript, Luau AST helper, SQLite, React/Sigma, Vitest/Playwright. No new runtime dependency or model weights.

**Spec:** [Accepted architecture and concrete-node amendment](../specs/2026-10-31-gameplay-semantic-architecture-design.md).

## Global Constraints

- Preserve saved `.rbxl` / `.rbxlx` and optional Rojo imports, exact source bytes/spans/hashes, immutable analyses and partial-import reporting.
- Visible gameplay nodes refer to actual files/objects or actual named creation sites; cloned objects use their original template's project name and expose creation details on the connection.
- No imported code execution. No weights, model downloads, hosted inference or Studio capture in this implementation; retain these as future extension points.
- Keep finite alternatives bounded at 32, call-summary contexts at 4, and depth at 8; explicit unknown remainder on exhaustion. Never promote a candidate into a guaranteed runtime fact.
- Existing API calls default to Code when `view` is omitted; web UI explicitly defaults to Gameplay. Preserve query depth 6, nodes 1,000, evidence 5,000 and context 32,000 bytes.
- Native execution was selected previously and implementation is explicitly authorized. Work on a dedicated feature branch; commit/push updates without merging main.

## Review Focus

- Shadowed/reassigned engine libraries must not be recognized as built-ins; test in Task 1.
- Dynamic config variants must keep fallback/unknown alternatives and preserve selected-row provenance; test in Task 2.
- Clone effects must affect the allocation while showing the real template name, never the original saved object as an actual mutated instance; test in Tasks 2–3.
- Shared names/config/helpers must not create false gameplay causal paths; test in Tasks 3–4.
- Old analyses, truncated proof and missing source must disclose unavailable gameplay/omitted support; test in Tasks 3–5.

## Task 1: Preserve expressions and recognize platform operations

**Files:** Modify `packages/core/src/ast-lowering.ts`, `resolver.ts`, `resolve-calls.ts`, `resolution.ts`; create `semantics/luau.ts`; test `tests/gameplay/platform.test.ts` and existing resolver/facts tests.

**Interfaces:** `Resolver.get(e: Expr | undefined, facts: Facts, seen?: Set<string>): Value` remains compatible. Lowered expressions retain operators; sites retain guards/scheduling metadata through the existing expression record. Recognized native/intrinsic results distinguish project dependencies from platform operations.

- [x] Write tests for math/task/CFrame, workspace identity, literal truthiness/fallback and shadowed libraries; assert no missing-package relationships for intrinsic calls.
- [x] Run `npm test -- tests/gameplay/platform.test.ts`; observe the new assertions fail.
- [x] Preserve unary/binary/conditional expressions, function return/parameter metadata, control guards and callback sites; add a versioned semantics catalogue and concrete Workspace binding.
- [x] Run the focused tests plus `tests/facts.test.ts`, `resolve-calls.test.ts`, `review-resolution.test.ts`; expect all passing.
- [x] Commit `feat: preserve Luau flow and recognize platform operations`.

## Task 2: Shared bounded configuration and object flow

**Files:** Create `packages/core/src/analysis-values.ts`, `flow-resolver.ts`; modify `module-values.ts`, resolver consumers and event resolver inheritance; test `tests/gameplay/flow.test.ts`.

**Interfaces:** `FlowResolver extends ModuleResolver` provides `get`, `member`, `alternatives(value: Value): Value[]`, and `anchorIds(value: Value): string[]`. Values carry template/allocation/source/config provenance and unknown remainders; existing passes consume the same semantics rather than a second gameplay-only parser.

- [x] Write a newly authored snapshot/script fixture for the egg loop, variants, callbacks, named constructors and clone/part branches. Assert template anchors/config source and separate allocation identity; missing/unknown attributes cannot silently select Standard.
- [x] Run `npm test -- tests/gameplay/flow.test.ts`; confirm failures for the missing chain.
- [x] Implement bounded alternatives, short-circuit/config key propagation, callback argument/capture summaries, class/property/clone/constructor results and mutation invalidation. Preserve conservative unknowns for unsupported dispatch and exhausted bounds.
- [x] Verify focused flow tests and existing config/instance/event/adversarial tests; expect all passing.
- [x] Commit `feat: resolve configuration-driven object and callback flow`.

## Task 3: Gameplay relations, proof, concrete anchors and persistence

**Files:** Create `packages/contracts/src/gameplay.ts`, `packages/core/src/gameplay.ts`, `migrations.ts`; modify contracts `model.ts`, `assemble.ts`, `store.ts`, `schema.sql`, local `worker.ts`; test `tests/gameplay/semantics.test.ts`, `persistence.test.ts`.

**Interfaces:** `resolveGameplay(snapshot: Snapshot, facts: Facts[], resolutions: Resolution[]): Resolution` adds typed object/file relations and revision-pinned proof. `GameplayAction` records carry trigger/handler/subject/config/effect IDs, guards and witness IDs. Relation metadata carries derivation support; `validateGraph` validates support in the same analysis.

- [x] Write expected/forbidden link tests for egg laying, chicken/egg pickup, GUI-to-remote-to-effect, shared config and same-named objects. Assert every visible anchor has concrete object/source provenance and real project naming.
- [x] Run the new semantics/persistence tests; confirm failing expectations.
- [x] Generate semantic effects/configuration/trigger relations using shared flow values; preserve candidates/guards and direct proof locators. Integrate the worker and assembler; persist versioned semantic records transactionally and preserve old Code analyses.
- [x] Verify source/derivation IDs, save/reopen parity, old-analysis capability reporting and scoped unknown diagnostics; run contracts/store/pipeline suites.
- [x] Commit `feat: persist gameplay relationships between concrete project objects`.

## Task 4: Shared projections, flow queries and agent context

**Files:** Create `packages/core/src/projection.ts`; modify contracts `query.ts`, core `query.ts`, `traversal.ts`, `context.ts`, `grouping.ts`, local `mcp.ts`, `cli.ts`; test `tests/gameplay/query.test.ts`, `context.test.ts`.

**Interfaces:** `Query.view?: 'code' | 'gameplay'`, `expandedIds?: string[]`, `includeIntrinsics?: boolean`; `projectResult(result: QueryResult, view: 'code' | 'gameplay'): QueryResult` retains backing proof and actual anchors. QueryResult includes capability/view/action/proof metadata. Existing operations stay supported; explain/implementation use the same query schema.

- [x] Write tests for object/config flows, utility-hub exclusion, cross-view anchor parity, old-snapshot availability and truncation retaining critical unknowns.
- [x] Run the new query/context tests; confirm failures.
- [x] Add indexed semantic overview/adjacency, policy-based traversal and code/gameplay filters; keep model grouping separate from canonical identity. Supply action/witness bundles through HTTP/CLI/MCP and context exports.
- [x] Verify query/filter/trace/evidence-budget/context/MCP regressions and new tests; expect all passing.
- [x] Commit `feat: expose linked gameplay and code queries to humans and agents`.

## Task 5: Concrete-node viewer and precise diagnostics

**Files:** Modify `apps/web/src/App.tsx`, `GraphView.tsx`, `Inspector.tsx`, `SourceView.tsx`, `DiagnosticView.tsx`, `TraceView.tsx`, `ContextExport.tsx`, `styles.css`; test `tests/ui/gameplay.test.tsx`, `tests/e2e/gameplay.spec.ts`.

**Interfaces:** UI sends explicit `view`, preserves canonical selection across switches, and uses shared projection output. Edge inspector shows action/effect/config/guard evidence; no abstract action or allocation becomes a visible node.

- [x] Write component/browser tests for default Gameplay, Code switch, actual template labels, implementation drilldown, scoped unknowns and narrow unresolved source highlighting.
- [x] Run focused tests; confirm failures.
- [x] Replace details-only navigation with linked views and selection-local expansion; retain Code details, hierarchy/search and shared filters. Label source text separately from relationship resolution.
- [x] Verify focused and existing UI/browser tests, typecheck and build.
- [x] Commit `feat: add concrete-object gameplay exploration and evidence drilldown`.

## Task 6: Private-game validation, documentation, packaging and final review

**Files:** Update `scripts/validate-games.ts`, authored fixtures/tests as needed, user/agent/release docs and package version. Keep private reports under ignored build/private-inputs directories.

**Interfaces:** Existing saved-file validation with additional semantic link/proof/naming checks; same-input before/after reason counts distinguish classification from actual resolution.

- [x] Analyze all three supplied games, verify expected Grow a Chicken flows and inspect proof chains; report remaining gaps and preserve input hashes. Add focused regressions for discovered implementation defects before fixes.
- [x] Run full tests, typecheck/build, browser and portable package checks; sample performance against the recorded baseline without claiming unmeasured guarantees.
- [x] Commit/push implementation and validation updates to the feature branch.
- [x] Dispatch one independent whole-branch reviewer per Native execution; fix important findings in one tested pass and record all rulings/deferred minors.
- [x] Build the updated Windows package, push final changes, provide the testing path and GitHub review link. Do not merge or upload private game files.

## Future extensions

Keep the provider-neutral local-assistant/proposal overlay and Studio observation boundaries described in the accepted architecture. They are future updates, not dependencies of these six tasks.
