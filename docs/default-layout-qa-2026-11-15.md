# First-import graph layout QA — 15 November 2026

The experimental default keeps connected structures together, with hubs inside and pendant branches outside. It changes placement only. The same projected nodes, connection lines, relationship directions and query limits remain visible. This branch starts at main `0ec177d` and awaits user approval before any merge into main or chat_bot_RAG.

## User inspection

Three original `.rbxl` games were imported through the real app in fresh browser sessions, with no prior game-specific knowledge. Screenshots were inspected in the actual Sigma renderer at 1600 × 1000. A separate import at 1100 × 800 checks the narrower initial arrangement. Source files and game-specific screenshots/queries remain in ignored local build outputs.

| Game | Visible nodes / lines | Connected structures | Crossings before → selected | Edges near unrelated nodes before → selected |
| --- | ---: | --- | ---: | ---: |
| SaveHer | 13 / 9 | 5, 3, 3, 2 nodes | 0 → 0 | 0 → 0 |
| Grow a Chicken | 47 / 46 | One 34-node structure; pairs and isolated nodes | 135 → 5 | 27 → 0 |
| Bangla Battlegrounds | 147 / 140 | Two large structures (45 and 42 nodes), then smaller structures | 198 → 1 | 20 → 0 |

Crossings count unique straight lines with disjoint endpoints. Proximity counts an unrelated node within 22 layout units of a line, not pixel-perfect rendered collisions. Each game's before/after node and unique-edge sets were checked for equality. Counts describe the visible static-analysis graph. Grow a Chicken and Bangla Battlegrounds have partial imports; this does not claim full runtime coverage or the mathematically minimum crossing count.

As a first-time user, I can now distinguish:

- **SaveHer:** Timeboard at the center of a lifetime/leaderstats structure, plus separate animation, dialog and input-control structures. There was already no crossing problem; the useful change is hub placement and component shape.
- **Grow a Chicken:** the connected chicken/egg/pickup/configuration structure, the placement event and its script, and the player-data/shop branches. These are much easier to follow than the previous service-separated crossing field. Five crossings remain in the cyclic structure.
- **Bangla Battlegrounds:** a manager with many inventory/UI leaves, a separate combat/input/animation structure, and smaller NPC, animation and dialog structures. The NPC hubs no longer sit among long inter-service edges.

These shapes help answer “which objects belong to the same connected system?”, “which script is a hub?” and “where do the leaves attach?”. A radial center does not assert execution order. Long labels still require hover or zoom, especially in the larger game and narrower window. Existing label styling and interaction controls were deliberately left unchanged.

In a controlled 1000 × 700 Sigma drawing area, replaying the captured coordinates produced zero overlapping node circles and zero rendered edge/node intersections in all selected layouts. Automatically displayed labels changed from 11 to 13, 21 to 24, and 27 to 24 respectively. Label rectangle overlaps were 0, 4 and 1 after selection (previously 0, 4 and 3); selected screenshots had no clipped displayed labels. This is a structure-readability improvement, not a claim that every label is readable at once. The measurements use the truncated preview text actually rendered at rest. Full-app screenshots remain the primary visual evidence.

## Approaches tested and rejected

The same frozen first-import graph was supplied to each candidate, and candidate coordinates were replayed through the real renderer for inspection.

| Candidate | Grow a Chicken crossings / proximity | Bangla crossings / proximity | Decision |
| --- | ---: | ---: | --- |
| Existing service-group placement | 135 / 27 | 198 / 20 | Splits connected structures across service bins, creating long crossing edges. |
| Existing topology optimizer without service bins | 5 / 0 | 14 / 0 | Strong geometry improvement, but repeated candidate searches took about 8.5 s and 4.9 s in the Node experiment. |
| ELK stress on every node | 14 / 5 | 2 / 33 | Shorter edges, but compressed leaf fans put edges through unrelated nodes. |
| ELK radial on the general graph | Error | 16 / 1,307 | The tree-oriented algorithm is unsuitable for these cyclic inputs; coincident nodes in the larger game. |
| ELK layered, displayed with straight edges | 17 / 17 | 26 / 35 | Excessive width and long edges; Sigma does not display the engine's routed bends. |
| Stress on the cyclic core, topology branches outside | 8 / 0 | 1 / 0 | Useful for the tangled Bangla core; the existing topology placement remains better for Chicken. |
| Selected per-component hybrid, rotated and packed | 5 / 0 | 1 / 0 | Keep whichever internal candidate has the better global geometry score, then pack complete structures. |

Research informed the experiments: [ELK Stress](https://eclipse.dev/elk/reference/algorithms/org-eclipse-elk-stress.html) uses graph distance to guide placement; [ELK Radial](https://eclipse.dev/elk/reference/algorithms/org-eclipse-elk-radial.html) allocates radial wedges to tree branches; [Graphviz twopi](https://graphviz.org/docs/layouts/twopi/) places nodes around a central root. The chosen hybrid is an application-specific inference from those methods and the screenshots, not an implementation of twopi.

## Implementation and limits

`initial-layout.ts` partitions true connected components. Each gets the existing deterministic core/radial layout. For tangled cyclic cores of at most 80 nodes and components of at most 220 connections, it also tries seeded ELK stress with a 160-iteration bound. A candidate replaces the baseline only if its whole-component geometry score improves. Invalid or unavailable solver output falls back to topology placement.

Each component is rotated to suit the viewport and expanded horizontally for labels. Several shelf widths are compared before packing complete components with gutters. Rotation, reflection and expansion preserve crossings; the expansion cannot reduce node/edge clearance. The layout runs in the worker. Existing rendering, semantic projection, group filtering, drag, pinning, camera restoration and saved arrangements remain in place. The new path is used for the all-groups default Gameplay service overview; Code, folder grouping and focused views retain the existing optimizer.

The extra computation trades first-layout time for readability. Final wide browser captures recorded approximately 18 ms, 3.6 s and 2.7 s in the worker. Those runs shared the machine with other checks and are observations, not a controlled latency benchmark. Fresh narrow imports recorded approximately 24 ms, 2.6 s and 1.2 s. Raw Node candidate timings and browser timings are separate measurements. The optimizer runs outside the UI thread; dragging is enabled when placement finishes.

## Evidence and reproduction

Local evidence is under `build/default-layout-review/`: `before/` contains baseline full-app screenshots and worker requests; `comparison/` contains candidate screenshots/coordinates; `final/` contains selected full-app wide captures; `narrow/` contains separate narrow imports; `index.html` compares full-app screenshots side by side. `summary.json` verifies identical projected topology and stores geometry measurements.

Build the baseline app first and capture it with `scripts/inspect-default-layout.ts build/default-layout-review/before 1600x1000 --baseline`. Build this branch and capture `final` at `1600x1000`, then `narrow` at `1100x800`. Run `scripts/compare-default-layouts.ts`, render its successful modes with `scripts/render-layout-comparison.ts build/default-layout-review/comparison original,topology,stress,layered,selected`, and assemble the review page with `scripts/summarize-default-layout-review.ts`. The scripts use the three files in the sibling `Rbxl_files_for_Test` folder; no game code is executed or uploaded.

Validation and package results are recorded in the branch's implementation plan after the final checks.
