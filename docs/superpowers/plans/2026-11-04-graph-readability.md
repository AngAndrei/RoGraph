# Graph Readability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve structural graph readability with measured candidate selection, stable exploration and robust background layout.

**Architecture:** Keep projection/evidence independent of geometry. Add reusable geometry metrics and a reproducible comparison runner; select network placements using structural quality. Keep the existing topology pipeline for trees/cycles, compare a deterministic incremental fCoSE alternative, and support focused ELK placement through a typed worker boundary. Restore exact cached views immediately; topology changes compute fresh geometry.

**Tech Stack:** TypeScript, Graphology, Sigma, React, fCoSE/Cytoscape, elkjs, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-04-graph-readability-design.md`

## Global Constraints

- Prioritize structure, crossings, edge clearance and stability; labels are secondary.
- Permit several seconds of initial computation; reuse unchanged arrangements.
- Preserve canonical node/action IDs, direction, evidence and original input files.
- Keep private production data and rendered research outputs in ignored `build/`.
- Continue the existing `codex/topology-layout` checkout and push the verified commits.

## Review Focus

- Equal-label entities and overlapping groups must retain separate IDs and memberships.
- Filter changes on one analysis must not mix obsolete positions with a fresh layout.
- A delayed/failed/malformed worker must not overwrite user interaction or leave the graph unusable.
- Reverse relationship bundles must retain all action IDs and arrow directions in focused views.
- Empty, isolated, dense, narrow-screen and reopened graphs must remain navigable.

### Task 1: Reproducible comparison and candidate layout

**Files:** `apps/web/src/layout.ts`, new `layout-quality.ts`, `network-layout.ts`, `scripts/compare-layouts.ts`, `tests/layout-quality.test.ts`, `tests/layout.test.ts`, package manifests.

**Interfaces:** `measureLayout(points, edges)` returns crossings, obstructions, separation and edge lengths. `optimizeGraph(nodes, edges, options)` asynchronously returns validated positions and diagnostic metrics. Options include network/directional intent and viewport aspect ratio.

- [ ] Write meaningful failing tests for canonical-order stability, geometry metrics and crossing reduction on a deterministic dense fixture.
- [ ] Run the targeted Vitest files and observe the expected failures.
- [ ] Implement pure metrics, canonical topology inputs, viewport packing, deterministic fCoSE/ELK adapters and structural candidate selection. Bound optimization by work, with a generous failure timeout.
- [ ] Freeze research JSON hashes and compare unchanged baseline, improved baseline and fCoSE on the seven saved states; retain a source snapshot in ignored build output.
- [ ] Verify targeted tests, inspect per-view results and commit this task.

### Task 2: Stable and robust graph exploration

**Files:** `apps/web/src/GraphView.tsx`, `layout.worker.ts`, new `graph-exploration.ts`, `layout-protocol.ts`, `App.tsx`, `styles.css`; tests for exploration/protocol/browser behavior.

**Interfaces:** explicit `selectedId` drives styling without restarting layout. Worker requests/responses carry IDs, intent, positions or errors. Cache identity includes topology, labels, mode and focus. Exact cache hits avoid workers.

- [ ] Write failing tests for neighborhood boundary counts, directed bundle expansion, duplicate-name context, cache identity, validated worker output and selection/focus restoration.
- [ ] Run the targeted tests to confirm the missing behaviors.
- [ ] Implement reversible neighborhood focus and directional placement, hidden counts, contextual labels, selection synchronization and complete role key.
- [ ] Implement robust worker completion/error handling, stale-request disposal, pending-interaction protection, cached restoration and visible loading/fallback status.
- [ ] Extend real-Sigma browser tests for focus, mode changes, errors, cache reuse, hover/selection, dragging and narrow viewport controls.
- [ ] Verify targeted unit/browser tests and commit this task.

### Task 3: Comparison evidence, whole-branch review and delivery

**Files:** comparison runner/browser fixtures, `docs/validation/graph-readability.md`, README as appropriate.

- [ ] Run the frozen real-data comparison with repeated timings and actual rendered pixel metrics/screenshots; include a connected BrokenPVP sample and synthetic stress fixtures.
- [ ] Inspect representative Code/Gameplay/focus renders and adjust only for demonstrated defects.
- [ ] Run full unit tests, typecheck, build and browser tests.
- [ ] Request one fresh whole-branch review. Fix important findings with failing regression tests first; rerun affected checks and full required checks.
- [ ] Record measured results, tradeoffs and limitations in shareable documentation without private names/paths/data.
- [ ] Commit final verified changes, push the existing branch, and verify the remote commit with the GitHub plugin.
