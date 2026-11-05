# Graph readability validation - 4 November 2026

Structural readability takes priority over allocating space to every label. Hover labels remain available, and initial optimization may take several seconds in a background worker. Unchanged views reuse positions and camera without another optimizer.

## Implementation

The network pipeline retains topology-aware trees, simple cycles and outward branches. It compares canonical, natural/degree and stable evidence-order placements with incremental fCoSE on complex cyclic regions. Serious edge obstruction, clearance, crossings and node separation determine candidate quality. Spatial cleanup finishes dense overlap removal; expensive coordinate descent is limited to 350 nodes and 500 connections.

Sigma remains the renderer. Cytoscape/fCoSE and ELK load in the worker. Neighborhood focus reports hidden and boundary connections. Direction mode uses ELK with straight rendered arrows and preserves its reading axis across filters. Both directions of bundled relationships retain their action IDs and evidence. Overlapping groups remain memberships rather than invented compound parents.

Changed network views align with their prior orientation/location, while dragged nodes are distinct manual pins. Worker output must contain every exact ID once with finite coordinates. Worker startup, dispatch, asynchronous errors and timeouts recover using cheap existing positions. Fallbacks remain browsable and are retried rather than cached as successful optimization.

## Reproduction and measurement

Original games, frozen query exports and generated images stay local in ignored directories. Geometry comparisons use identical nodes, connections, labels and styles. Focus/directional exploration and the complete 645-node connected sample are separate checks; query budgeting is unchanged.

```powershell
git show c38d619:apps/web/src/layout.ts > build/readability-original-layout.ts
npx tsx scripts/compare-layouts.ts --fixtures build/graph-layout-research --baseline build/readability-original-layout.ts --out build/layout-comparison --repeats 3
npx tsx scripts/render-layout-comparison.ts build/layout-comparison
```

The runner records input SHA-256, revision, dependencies, positions and options. Crossings are strict nonincident straight-segment intersections. The obstruction measure uses unrelated node centers within 22 layout units of an edge; candidate selection also considers 40-unit clearance. Collinear overlaps and semantic path difficulty are not represented by crossing counts.

`firstOptimizationMilliseconds` is the first run for a case in a shared Node process. `repeatOptimizationMilliseconds` measures recomputation, not cached reopening. Timings depend on host load and are not an SLA; no p95 is claimed from a handful of samples. Browser results distinguish fixed-position replay from live production-worker layout.

Real React/Sigma rendering uses Edge with software WebGL, a 1000 by 700 graph viewport, DPR 1, Segoe UI, explicit locale/timezone, reduced motion, font readiness and layout readiness. It measures circle separation and edge/circle intersections. Label bounds are font-measured estimates over Sigma's displayed-label IDs, not exact glyph masks. Gameplay, Code, focus, Direction and narrow-screen screenshots are reviewed locally.

## Verification and limits

Independent review found six important issues in recovery, sparse-array validation, duplicate identity, directional alignment and fallback caching. Each received a reproducing regression and fix. Timing names and comparison/render defaults were corrected as well.

Dense graphs still contain crossings and label collisions. Focus, hover and keyboard browsing remain necessary. Arrangements are session state rather than durable saved views or URL state. Orthogonal routing and improved overview selection are separate work. The build reports its existing large-chunk warning; ELK's approximately 1.46 MB uncompressed chunk loads only for the directional worker route. A source build does not update an installed executable automatically.

## Measured results

Private dataset names omitted. Final identical-input geometry comparison:

| View | Nodes / connections | Crossings before to after | 22-unit obstructions before to after |
| --- | ---: | ---: | ---: |
| Gameplay A | 147 / 140 | 14 to 14 | 0 to 0 |
| Gameplay B | 118 / 89 | 0 to 0 | 0 to 0 |
| Gameplay C | 198 / 161 | 56 to 9 | 5 to 0 |
| Code A | 278 / 292 | 753 to 361 | 243 to 88 |
| Gameplay D | 28 / 22 | 0 to 0 | 0 to 0 |
| Code B | 196 / 209 | 1149 to 108 | 288 to 97 |
| Gameplay E | 13 / 9 | 0 to 0 | 0 to 0 |

Code A reduces crossings by 52.1%; Code B by 90.6%. Both meet the proposed 30% target. Three sparse overviews remain crossing-free. Gameplay A retains its original crossing and obstruction counts using the stable evidence-order baseline candidate.

The complete 645-node/752-connection sample reduces crossings from 17,633 to 16,671 and 22-unit obstructions from 2,748 to 1,940. Minimum center separation improves from 61.89 to 72.00 layout units. Its measured repeat optimization was about 4.5 seconds after the descent cap; only one repeat was collected. It still needs focused exploration.

Final verification passes 178 unit/integration tests in 55 files and 14 browser tests. Typecheck and production build pass. Error-path browser cases substitute only the worker boundary. All five original game hashes match the initial research.

Final real-browser captures contain zero circle/circle overlaps and no page errors across 16 overview renders. Live Code initialization was approximately 2.2 seconds and 1.8 seconds on this machine, including renderer startup; this is separate from shared-process Node timings. Font-measured label collisions remain, and fewer labels can display at fit after contextual disambiguation. The selected/hover and keyboard paths remain available. Large focused hub fans can make Direction mode very tall; use Connections, a narrower group/filter, or zoom for that task.
