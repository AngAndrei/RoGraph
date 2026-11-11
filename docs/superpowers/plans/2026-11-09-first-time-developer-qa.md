# First-time developer QA and orientation

Purpose: let a Roblox developer form an evidence-backed picture of an unfamiliar saved game, find a useful starting script, follow an interaction, and return to a recognizable overview.

Approach: retain the existing React/Sigma graph and layout; add a compact orientation layer and expose existing path tracing. A larger layout replacement would disrupt the user's current work and cannot explain missing static evidence. A prose-only summary would not support the visual reading task. The chosen approach derives every suggestion from retained relationships and discloses bounded/partial results.

Branch: `codex/qa-game-understanding`. Existing edits preserved separately in baseline commit `a459aa3`. Source and original game files remain outside Git. Work is inline under the user's authorization to review and improve the app; no intermediate design approval is needed.

- [x] Walk through all six supplied games in real Edge; retain private screenshots and timings under ignored `build/qa-user-review`.
- [x] Add failing tests for starting-script ranking, directional summaries, uncertainty, and honest missing information.
- [x] Add a compact Start here guide with useful controllers, example actions, visible static/partial-map scope, and selection. Keep the graph as the main visual.
- [x] Expose Trace a path and Back to overview. Show dependency/impact scope without presenting an empty path as zero hops. Protect requests from stale snapshot/view results.
- [x] Improve graph count/direction guidance, legend readability and narrow-screen graph/inspector access. Provide keyboard-accessible text paths and a collapsible guide.
- [x] Replace repeated relationship scans in graph projection with a map; preserve bundled direction and all canonical relationship IDs.
- [x] Run focused regression tests, full tests, typecheck/build and real browser tests. Inspect desktop, laptop and portrait screenshots. Revisit all six games and record what can/cannot be understood.
- [x] Review the final diff and prepare the separate QA commit and branch delivery with findings and limitations.

Render ownership: Sigma owns one visible graph and the existing worker owns geometry. React owns the brief, text alternatives and trace controls. The brief indexes retained nodes and relationships and sorts its candidate scripts; it uses only the bounded query and adds no remote dependency or model call. Graph filters stay in session; existing node annotations persist in browser storage. No new URL persistence is introduced, because a local session URL is not a shareable project reference. Portrait uses a compact navigator and an overlay inspector, keeping graph access available. Tests cover interpretation and interactions rather than incidental pixels.

Initial evidence: SaveHer's 13-node graph exposes timer/leaderboard, dialog audio and animation scripts, but no starting point. Bangla's 147-node overview has 300 retained relationships and is truncated; this limit was not visible on the canvas. Dependency/impact exploration passes an empty paths array to TraceView, causing a misleading zero-hop/no-path message. The legend uses 8px text. Baseline restricted tests reported local connection/rename failures; repeat with local test access before classifying those as app bugs.

Ruling: add an exact-span source-site index to gameplay evidence construction. The existing 6,000-occurrence evidence-budget test timed out at 30 seconds twice, including an isolated run. Investigation found a repeated full-site scan in recursive witness construction. The same test passed in 7.94 seconds after the index, without changing its timeout or expected behavior. The read-only reviewer verified identical matching/order semantics and copied support lists.

Review: a fresh reviewer identified stale alternative-path state on repeated traces and guide labels that inferred server execution from Script class. Both received failing regression tests and fixes. Outgoing connections are labeled as connections because configuration reads and implementation links do not all represent effects. Early whole-suite runs that overlapped the new red review tests are not final verification results.

Final visual pass: an unrelated game's newer snapshot could appear as an update, and a local property-write hop was presented as communication. Red tests reproduced both. Update notices now distinguish unseen incoming imports from already-known analyses, name the incoming file, and clear on analysis changes. The existing externally imported snapshot/pinning workflow remains supported. Gameplay traces use action labels and conditional markers with a gameplay-path heading; code communication labels remain intact. The screenshot harness now waits for overview restoration after tracing before capturing the laptop/portrait state. Multi-snapshot rendering also exposed pre-existing duplicate React sibling keys, now namespaced for diagnostics and comparison panels.

Delivery validation: clean typecheck/build; 217 tests in 62 files passed (120.39 seconds); all five final targeted Edge checks passed (42.2 seconds); all six final UI walkthroughs passed with no page errors or document overflow. All six original files passed search/inspect/source/trace/context/reopen/raw-byte/input-hash checks. The earlier intermittent synthetic-import stall is documented in the QA report and is not claimed fixed. No private game source or generated snapshots are staged.
