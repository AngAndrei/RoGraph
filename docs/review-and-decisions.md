# Final review and execution decisions

## Gameplay update (0.2.0)

The Native implementation received one independent whole-branch review at `bb1696f`. It reported seven Important findings and one Minor. The cross-view inspection issue was regraded Important because it blocked the promised implementation drilldown. All eight were addressed in one regression-driven fix pass; no second review was dispatched.

- Copies retain allocation identity through child lookups, enumeration and alternative-selected writes; graph labels still name the actual template/child.
- Forward traces and reverse impact follow the selected handler, explicit calls and scheduled continuations. Unrelated callbacks and unused functions in the same file do not create causal paths. Handler reachability is capped at 256 owners with omission disclosure.
- Recognized but unsupported engine behavior has an explicit diagnostic and noncausal object-use relationship; API recognition alone is not complete effect modeling.
- Query retrieval follows support-site IDs rather than only displayed owners. Config fields retain row-specific paths, defining source and exact spans. Context budgets disclose missing support and definition excerpts.
- A saved non-Archivable template does not receive a claimed clone-spawn relationship.
- Named `Instance.new` objects retain their source creation and supplied parent, and appear under their actual names.
- Remote/bindable handlers receive bounded known payloads with channel, direction, context and player/recipient offsets preserved; unknown runtime values remain open alternatives.
- Switching to Code clears stale Gameplay edge focus. The inspector exposes handler names and direct config-definition source buttons.

Regression evidence is in `tests/gameplay/final-review.test.ts`, `tests/ui/gameplay.test.tsx` and the Gameplay browser workflow. The full release results are in [release-validation.md](release-validation.md).

Rulings made for this implementation, in order:

1. Honor the user's concrete-node amendment: keep actions and copies in connection metadata, using real object/file names as visible endpoints. Cost if wrong: detailed edges are less compact than abstract action nodes.
2. Use the existing dedicated feature checkout rather than another filesystem worktree, retaining installed tools and private testing paths. Cost if wrong: isolation is by branch rather than a second directory.
3. Regrade and fix the stale edge filter as Important. Cost if wrong: switching views loses an edge focus that cannot apply in the destination view.
4. Keep local weights and Studio capture as future extensions, and avoid runtime certainty for randomness, counts and arbitrary execution. Cost: those dynamic cases still need observation or later assistance; saved-file analysis remains incomplete.

No new Minor findings were deferred in the gameplay review. The earlier preview's deferred minors remain listed below. The single pre-final-fix performance sample missed targets and is disclosed in [performance.md](performance.md).

## Original preview (0.1.0)

One independent, fresh-context whole-branch review identified 15 Important findings. All were corrected in one regression-driven pass; a shutdown regression found during browser verification was also fixed. The full suite passed 96 tests and all four Edge/WebGL workflows passed. The review was not repeated after the fixes; regression evidence provides their verification.

Corrections cover serialized-property retention, alternative module returns, aliased/cross-module writes, API-member shadowing, dot-style native calls, binary source provenance, omitted expression sites, callback syntax, failed-trace uncertainty, diagnostics/locations/pagination, stale IDs, persistent viewer filters, snapshot-wide endpoint selection, grouping/controls, and complete Rojo component inventory.

## Rulings I made

- Ruling: Use the fresh RoGraph clone on codex/rograph-build as the isolated workspace — native worktree API rejects a nested sourceRoot; the clean clone isolates the original workspace and main — cost if wrong: app-managed worktree attachment is unavailable, but branch and source isolation remain intact.
- Ruling: Use PowerShell equivalents for task briefs/ledger — Git Bash cannot create MSYS named objects under the execution restrictions — cost if wrong: wrapper bookkeeping is manual; retain identical per-task test/commit evidence.
- Ruling: Product files live in RoGraph/ rather than the reference-parent root — remote repository now exists; keeping a dedicated clone avoids including reference checkouts — cost if wrong: documentation source links need upstream URLs instead of sibling folders.
- Task 5: verification initially failed (fixture omitted required Rojo class declarations; completion entry was premature and is superseded below). Ruling: Defer optional luau-lsp integration — no installed executable/compatible offline definitions; official AST + explicit resolver remains authoritative — cost if wrong: less type-assisted resolution, reported as unresolved rather than guessed.
- Task 8: complete (calls RED 2 → GREEN 2/2; full suite 28/28; typecheck passed). Ruling: Shared module-table evaluation lives in module-values.ts — calls and configuration use the same lexical identities — cost if wrong: one extra internal module, no API/scope change.
- Ruling: Exclude the selected analysis workspace from Rojo capture/watch inventory and reject mounts into it — database/cache writes would otherwise trigger repeated rebuilds or contaminate frozen inputs — cost if wrong: game source stored in the analysis workspace must be moved to its own folder.
- Ruling: Normalize captured file paths for Rojo sourcemap identity while retaining the verified raw map hash — repeated equivalent builds changed only temporary absolute map paths and generated different analysis IDs (reproduced RED) — cost if wrong: missed meaningful origin changes could collide; original file paths, manifest hash, map structure and tool version remain in the identity.
- Ruling: Record the inconsistent 60-second cold-time target as an explicit release limitation — measured 31.3/56.0/94.2 seconds at 50k objects, with a 65-second publication outlier — cost if wrong: large imports and queries during publication can take longer than expected; no general capacity guarantee is claimed.
- Ruling: Substitute dependency-isolated portable validation on this development computer for unavailable clean-PC/offline and real-game acceptance — packaged runtime, external-module blocking, Node-network blocking and fixture workflows are executable evidence — cost if wrong: unknown clean-machine/browser/OS networking and representative-game issues remain, explicitly fixture-validated preview.
- Ruling: Give browser acceptance tests a 90-second cold import wait and 150-second workflow deadline — repeated timeouts showed active import progress under ZIP/desktop load, while the compiled portable workflow passed — cost if wrong: slower development-worker startup regressions could pass; performance targets remain independently measured and documented.
- Ruling: Extend the existing place adapter to official pinned rbx_binary3.0.1 for supplied binary games — same DOM/evidence contracts, user originally allowed either format and now supplied2 binary-only games — cost if wrong: binary-specific property/chunk compatibility needs separate evidence and explicit diagnostics.
- Final: Ruling: Keep runtime Studio capture, cloud/model calls, source editing and syncback outside this release while adding binary places for supplied games — preserves the approved static-analysis boundary — cost if wrong: those workflows need a later release.
- Final: Ruling: Leave arbitrary runtime mutation, metatables, framework registries and higher-order dispatch unresolved — saved static inputs do not establish these targets — cost if wrong: dynamic dependencies remain incomplete.
- Final: Ruling: Keep optional Luau LSP and automatic community detection deferred while delivering deterministic service/folder grouping — no compatible offline LSP setup; optional community clustering is outside v1 — cost if wrong: less assisted resolution and automatic clustering.
- Final: Ruling: Treat three supplied-game workflows as partial compatibility evidence, not universal game or clean-PC support — all three imported with explicit warnings and one had an unparsed script — cost if wrong: other games and clean machines may expose additional issues.
- Final: Ruling: Publish measured performance and sampling limits without guaranteeing targets — final50k workload took78-117s and missed overview/render targets on a busy machine — cost if wrong: large games and queries can be slower than users expect.
- Final: Ruling: Keep signing/SmartScreen reputation and browser/OS background-network isolation outside the tested portable boundary — validation covers owned application processes and blocked Node networking — cost if wrong: Windows/browser behavior is not established by this test.
- Final: Ruling: Refresh the ZIP after code fixes and release-evidence updates — final review allowed this queued artifact step — cost if wrong: an older ZIP would not match the committed fixes.
- Final: Ruling: Resolve technical dependency-notice closure without representing it as a legal audit — exact Rojo source lock and nested notices are inventoried — cost if wrong: technical inventory does not establish legal sufficiency.

- Final: Ruling: Fast-forward the checkout to the user-merged main and append documentation-only acceptance evidence — user independently merged PR1/PR2 and requested GitHub updates; application tree is identical — cost if wrong: documentation bypasses a separate PR review; no program behavior changes, no forced remote update.

## Deferred minors

- Final: minor (deferred): label-only FTS omits source-content matches described in architecture.
- Final: minor (deferred): watch can report enabled after watcher closes on error.
