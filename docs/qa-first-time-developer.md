# RoGraph: first-time Roblox developer QA

Reviewed 9 November 2026 on Windows with the six saved games in the supplied test folder. The goal was to understand an unfamiliar game visually and recover its component relationships later. This is an expert walkthrough using the actual Edge renderer, rather than a usability study with external participants. Private place files, extracted source, detailed snapshots and screenshots remain outside Git.

## Assessment

RoGraph can provide a useful first picture of a game's implemented systems and a strong route into the relevant source. Before these changes, it expected the developer to know which object or script to select: a small graph looked sparse and a larger graph became a collection of indistinguishable spokes. The new starting guide makes those graphs easier to enter, while explicit scope and direction help the developer interpret what they see.

It still cannot reliably explain an entire game loop from a saved file alone. An input can contain scenery, unused systems, incomplete scripts and dynamic behavior that static analysis does not resolve. The graph is evidence for potential saved-code relationships, not a recording of play or a guarantee of execution order.

## What I could understand from each game

These are interpretations supported by the visible relationships and inspected source, not claims about the complete experience or its intended design.

| Supplied game | Saved objects | Parsed scripts | Useful first picture | Important limit |
| --- | ---: | ---: | --- | --- |
| SaveHer | 1,818 | 4 / 4 | A lifetime/leaderboard script creates and updates player statistics; separate scripts handle dialogue audio, animation and controls. | These systems do not establish the objective suggested by the game's title. Some platform operations remain unmodeled. |
| Bangla Battlegrounds | 1,096 | 27 / 27 | Inventory management, move buttons, server combat and NPC behavior are identifiable. Selecting a controller reveals its UI/object changes and input links. | The large inventory hub obscures smaller systems in the overview. The map is bounded, and 1,237 code sites remain unresolved. |
| BrokenPVP | 58,870 | 163 / 163 | Map loading/timing and vehicle prompt/UI systems can be recognized and followed into their controllers. | The initial sample overrepresents repeated vehicle scripts. It is insufficient to describe the full combat/round loop. |
| DemonHunting | 32,294 | 120 / 121 | Combat, soul-related UI, sword/shop UI and proximity interactions are visible enough to identify relevant source. | One script does not parse. Numerous unrelated controllers and repeated names make the global map difficult to read. |
| Grow a Chicken | 2,295 | 14 / 14 | Chicken-to-egg creation, pickup prompts, transfer into a tool/backpack, player statistics and shop controls are traceable. | Flow and configuration influence are different questions. Dynamic values and conditional callbacks still require source interpretation. |
| Photon 2 | 101 | 13 / 13 | Block spawning, visual outlines/surface UI, sound and laser/eye scripts form a recognizable set of systems. | Recognizing these systems does not establish the player's objective or actual timing. Unknown execution context must remain unknown. |

The supplied Grow a Chicken file differs from the older example documented elsewhere: this review imported 2,295 objects and 14 scripts. Results above describe this exact supplied set.

## Developer questions exercised

| Question | Result and route |
| --- | --- |
| Where should I start reading? | **Improved.** Start here suggests up to four connected scripts from retained relationships, with object counts and a directional example. It ranks useful exploration candidates, not proven startup entry points. |
| What triggers this object or controller? | **Supported where modeled.** Incoming connections and their labels expose saved signal/controller links. Inspect the canonical relationship and source for conditions and callback details. |
| What does this component touch or change? | **Improved.** At a glance separates incoming and outgoing connections and links to the other object. The complete loaded relationship list remains available below it. |
| How are these two things connected? | **Improved.** Trace a path is now discoverable. Gameplay flow follows supported action/event links; the configuration option also includes configuration influence. Every returned hop remains inspectable in source. |
| What might depend on this change? | **Improved.** Dependencies and Potential impact identify their root and have a visible Back to overview action. They no longer appear as failed zero-hop path searches. No dependent found is still not proof of safety. |
| Which side runs this script? | **Qualified.** Guide cards show the saved class and retained execution context, including unknown. Class alone is not used to invent a server/client claim. |
| Is this the entire game map? | **Improved.** Visible node/connection counts, bounded-result notices and partial-import notices remain alongside the graph. Project search queries the whole snapshot. |
| How can I remember this next time? | **Partly supported.** Personal node names and highlights survive refresh at the same browser origin; a different local app address has separate storage. Layout/focus controls preserve recognizable arrangements during a session. Their regression checks were retained. Durable workspace-level annotations and named saved views remain future work. |
| Can I inspect this on a narrow display? | **Improved.** The navigator and starting guide collapse on portrait screens; the graph remains available and the inspector can be closed without navigating away. Text summaries and project/node search provide alternatives to precise graph picking. |
| Can I infer the player's complete experience or runtime sequence? | **Not established.** Saved-code analysis does not prove runtime execution, dynamic targets, event ordering or designer intent. |

## Changes made

- Added a compact, collapsible starting guide with deterministic suggestions and directional relationship examples. Empty results give an honest next step instead of an invented game description.
- Added a short directional relationship summary to the Gameplay inspector. It preserves conditional markers and links to the full existing evidence workflow.
- Exposed the existing trace workflow and its configuration-influence option; retained filters and revision pinning. Fixed repeat tracing so a previous alternative cannot hide a later valid path. Gameplay hops show their action names and conditions rather than labeling every property change as communication.
- Added clear exploration scope, return navigation, bounded-map/partial-import notices and visible graph counts. Replaced the misleading dependency/impact zero-hop presentation.
- New-snapshot notices detect imports that actually arrived after the browser loaded its known analyses, name the incoming file, and clear when switching analyses. Selecting an older, already-known game no longer creates a false update offer; imports arriving from outside the browser still notify correctly.
- Moved graph controls and legend outside the drawing area to avoid covering nodes. Increased legend readability and improved portrait navigation, inspector access and guide behavior.
- Indexed graph-projection relationship lookups instead of rescanning all relationships for each projected edge.
- Indexed exact source spans during gameplay evidence construction instead of scanning every source site during each recursive expression lookup. Retained the same support IDs and insertion order, and copied indexed lists before accumulating recursive evidence.

## Performance evidence

The existing 6,000-occurrence evidence-budget regression timed out twice at its original 30-second limit before the source-span change, including an isolated run. It passed at that same limit after the change in approximately **7.9 seconds**. This is a test observation, not a universal import-speed claim.

A synthetic projection comparison verified identical output before and after the relationship index. With 300 nodes, median time per projection was 0.367 → 0.262 ms for 140 relationships, 0.692 → 0.294 ms for 300, and 4.405 → 2.754 ms for 1,000. Each median used nine batches of 50 calls after warm-up. This isolates projection work; it does not measure complete UI rendering or import time.

## Validation

Validation includes actual Edge imports of all six originals, overview and source inspection, selecting a guide candidate, dependency exploration and return, a direct supported trace with source evidence, and desktop/laptop/portrait screenshots. No browser page errors were observed in the recorded six-game walkthrough. Direct sampled traces validate those relationships, not every possible game flow.

The typecheck and production build passed, as did all **217 tests across 62 files**. A complete Edge run passed **20 / 20** checks before the final review corrections. The later complete run passed **19 / 20**: the source-Find test stalled during its synthetic import, before reaching the source UI. An immediate isolated rerun of both source-evidence checks passed in 18.6 seconds. This intermittent import stall remains a reliability observation; it was not reproduced or claimed fixed. The new orientation, mobile, trace and existing graph checks passed in the complete run. After the final message corrections, all **five targeted Edge checks** passed in 42.2 seconds, covering source Find, desktop/portrait orientation, gameplay tracing and externally imported snapshot selection/pinning. The corresponding 15 UI regression checks passed without the earlier duplicate-panel-key warnings.

All six originals passed the final saved-game validation: indexed search, inspection, dependencies/impact, source access, a supported sampled trace, bounded context, database reopening, exact retained bytes and unchanged input hashes. The refreshed six-game UI walkthrough also passed guide selection, source access, dependency return, configuration-aware trace/source inspection and desktop/laptop/portrait captures, with no page errors or horizontal document overflow. Detailed source-bearing reports are intentionally ignored.

## Remaining priorities

1. **Choose a more representative large-game overview.** The bounded selection and connection-count ranking can favor repeated vehicles or a large UI manager. A future system summary should group repeated controllers, reserve space for input/remote/configuration paths, disclose its selection policy, and let the developer expand a system into the same canonical evidence.
2. **Preserve research across app restarts.** Browser-origin storage separates annotations when the app opens at a different local address. Workspace-level annotation storage, named neighborhoods, bookmarks, notes and revision-aware restoration would better serve returning developers. Existing personal labels/highlights preserve refreshes at the same address, but do not store a complete research session.
3. **Give unknowns task-specific explanations.** Thousands of unresolved sites are difficult to prioritize. Prefer a compact explanation of what is missing for the selected component, with its source and supported next step.
4. **Improve dense label reading.** Contextual labels and focus help, but global large-game screenshots still contain crowded labels. Further work should measure readable labels and preserved relationships, not only crossings or visual compactness.
5. **Expand runtime and import evidence carefully.** The unparsed DemonHunting script, unsupported platform operations, external assets and runtime-created relationships remain analysis limits. Runtime observation would answer different questions from saved-file analysis and should be labeled separately.
6. **Investigate intermittent import stalls.** One synthetic browser import remained at Reading scripts for the 90-second assertion window; the same source-evidence tests passed when rerun. Keep the captured failure and check native-worker startup, cancellation and stage timing before assigning a cause.

## Branch and review provenance

Work is on `codex/qa-game-understanding`; it is not merged into the original branch or main. Existing uncommitted work was preserved first as baseline commit `a459aa3`, separate from the QA changes. A fresh read-only reviewer identified the repeat-trace and execution-context issues; both were reproduced with failing tests and corrected before final verification.
