# Topology layout and additional game validation

The user's two screenshots specify the desired arrangement: connected hubs and bridges inside, degree-one leaves outside, separated components, fewer crossings and no overlapping nodes. Keep real object names, existing filters, dragging and camera behavior.

- [x] Reproduce the Animate / NPCBehavior / Humanoid / Modon cycle with leaves in a regression test. Measure crossings and edge-to-node clearance, not exact coordinates.
- [x] Lay out cyclic cores independently of pendant trees; use crossing-aware core placement and outward branch sectors. Use a radial tree arrangement for acyclic components. Retain deterministic component packing and minimum spacing.
- [x] Run SaveHer and Bangla through saved-file workflows and the packaged executable. Investigate failures rather than weakening evidence requirements. Keep private games and reports out of Git.
- [x] Run the full unit suite, typecheck/build and browser checks; inspect a rendered representative layout. Install and verify the Windows package and prepare the GitHub update with aggregate validation results.

Implementation choices: reuse Graphology/ForceAtlas2 for general cyclic cores; use exact cycle placement and weighted branch sectors for simple structures. Bound crossing optimization for dense graphs. Some graphs are nonplanar, so reducing crossings is a heuristic, not a universal zero-crossing guarantee. Canonical graph data and edge evidence remain unchanged.

Review resolutions: preserve the true outward cone even for 300-node hub/leaf fixtures; cap expensive swaps at 24 core nodes / 60 edges; size circles by rendered pixel clearance (including Sigma's zoom scaling), remeasure after viewport resize, and guard pending frames on disposal. Final measurements on Bangla: 15 crossings / 1 near-node obstruction versus 180 / 106 previously. An earlier concurrent evidence-budget test timeout passed in the complete sequential rerun.


