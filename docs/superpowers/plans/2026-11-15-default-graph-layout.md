# Default graph layout inspection and implementation plan

> **For agentic workers:** Execute inline with superpowers:executing-plans. Complete the visual comparisons before selecting an implementation.

**Goal:** Make the first imported gameplay graph reveal connected structures, central hubs and peripheral branches with fewer crossings.

**Architecture:** Keep Sigma as the renderer and preserve the graph projection. Compare the current service-group layout against topology-first radial/core placement and ELK stress/radial alternatives. Pack disconnected components after internal placement. Select using both screenshots and geometry, then retain existing saved placements and pins.

**Tech stack:** TypeScript, React, Sigma, graphology, existing fCoSE and ELK providers, Playwright/Edge.

**Spec:** User request in this chat: inspect fresh imports of SaveHer, Grow a Chicken and Bangla Battlegrounds; experiment; publish a branch from main locally for approval, without merging main or chat_bot_RAG.

## Constraints and review focus

- Preserve all visible nodes, edges, directions, query limits and evidence. No graph simplification disguised as layout improvement.
- Change the initial network placement only; preserve explicit grouping, directional layouts, drag, pins and saved arrangements.
- Raw games, query data and screenshots remain in ignored build outputs.
- Test narrow and wide graph viewports, disconnected components, trees, cyclic graphs, input permutation determinism and saved positions.
- Watch component overlap, edge crossings, edges through unrelated nodes, label visibility, excessive graph extent and cold worker time.

## Tasks

- [x] Capture fresh first-import screenshots, actual worker requests and responses for the three games on main.
- [x] Research topology-appropriate algorithms from primary sources; compare baseline, topology-first, stress and radial placements on identical projected data and viewport.
- [x] Inspect actual Sigma screenshots and measure crossings, node obstruction, overlap, label count and layout time. Record rejected approaches and choose the strongest default.
- [x] Add meaningful regression tests for the winning behavior; demonstrate failures, implement, then verify tests pass.
- [x] Capture fresh imports with the selected approach; verify interaction, saved placements, component isolation and a narrow viewport.
- [x] Record evidence and limitations in a QA report. Run typecheck, unit and relevant browser tests, then review the final change.
- [ ] Commit and push only the experimental branch; rebuild and smoke-test the local Windows app for user review. Leave main and chat_bot_RAG unchanged.

## Execution ledger

- Ruling: work on a new branch in the existing checkout — the user explicitly requested this local version for inspection — main and chat_bot_RAG refs remain untouched.
- Ruling: apply the new path to the default all-groups Gameplay service overview; keep Code, explicit folder grouping and focused views on the old optimizer — confines the change to the requested default arrangement.
- Experiments: baseline, topology without service bins, full stress, radial, layered, stress refinement, stress core, principal-axis orientation and component packing. Evidence: ignored `build/default-layout-review/` and `docs/default-layout-qa-2026-11-15.md`.
- Selected: per-component baseline versus stress-core candidate, radial branches, viewport orientation and packed component gutters. Extra polish was rejected as an unconditional baseline replacement because it raised Chicken's crossings from 5 to 6 and added an obstruction.
- RED: new initial-layout suite failed because the new module was absent. GREEN: new layout, fallback, determinism, component gutter, viewport orientation and pin tests pass.
- Full unit run: 228 passed; the unrelated dependency-notice inventory check hit its 30-second timeout. Its isolated rerun passed in 19.9 seconds with a 90-second allowance. No production inventory code or test timeout was changed.
- Typecheck and diff whitespace checks pass. Build passes. Three fresh wide imports and three fresh narrow imports completed with no browser errors and complete graph geometry.
- Browser checks: thirteen checks pass: ten graph exploration/recovery/cache tests, real layout/zoom/separation, boundary drag/pan/wheel, and real-app snapshot pinning. The zoom test now starts zoomed out, since the improved initial geometry already permits maximum node radius.
- Fresh read-only code review found no production blocker. Its capture identity, fresh narrow import and preview-label measurement findings were addressed. Reviewer independently verified the recorded query node sets and reversed-input determinism on all three real game graphs.
- Renderer replay: zero selected node overlaps or edge/node intersections; labels/remaining overlaps documented without claiming perfect text readability.
- Local Windows package and ZIP rebuilt successfully. Packaged and development web entry hashes match; all 21 release smoke checks pass, including manifest hashes, imports, local UI assets, evidence trace, reopen and launcher cleanup. This verifies the package on this development device, not a separate clean PC.
