# Helpful node labels and personal annotations

Goal: show source binding names such as punchAnim while retaining the Animation class, qualify ambiguous saved objects by meaningful parents, and offer Rename / Highlight on graph nodes.

Architecture: source-derived display names are separate from actual object names and IDs. Existing snapshots gain conservative names from retained source at the recorded creation span. React owns the menu and personal annotations; Sigma owns node/label rendering. Browser local storage keeps annotations per analysis and node across refreshes and views. Annotation edits update the renderer without resetting layout, camera or pins. The existing graph shell and layout algorithms remain in use.

- [x] Test direct/local/reassigned bindings, explicit object names, dynamic table fallback, existing snapshots and parent context.
- [x] Implement source-backed labels in created-node metadata and query results, preserving actual object attributes and relationship IDs.
- [x] Add validated personal annotation storage with persistence and analysis isolation tests.
- [x] Add Rename (cancel/blank reset) and toggleable yellow Highlight behind node and label, with menu dismissal and keyboard entry.
- [x] Exercise real renderer interactions, persistence and camera/position preservation; inspect screenshots.
- [x] Run relevant tests, typecheck, build and existing exploration/drag checks; update user guide.

Checks: duplicate variables retain context; annotations cannot leak across analyses; invalid storage cannot break the graph; missing source falls back without invented names; highlights survive selection and hover.

Validation: 194 tests across 57 files, 10 Edge graph interaction/drag checks, typecheck and build passed. An earlier concurrent run hit the existing 30-second evidence-budget test deadline; the complete isolated rerun passed. All five original inputs retained their hashes. Their existing snapshots gained 38 / 237 / 124 / 13 / 2 binding labels respectively (Bangla / BrokenPVP / DemonHunting / Photon / SaveHer).

Review resolutions: reject comparison and derived-value suffixes in legacy recovery; preserve actual ancestor names when parent/child labels match; normalize identity-preserving parentheses/type assertions to the original call so allocations are not duplicated. Regression tests cover each finding. The read-only reviewer found no confirmed menu/hover/selection/drag/camera regression.

Persistence scope: annotations are local to the browser origin and analysis. They survive refresh, but a new random local-server port starts a different origin. Workspace-wide annotation persistence across app restarts is not included in this change.

Delivery: updated `dist/windows-x64` and regenerated the Windows ZIP. The standard package copy hit the running bundled Node executable; a hash-checked copy completed the remaining changed file while leaving the identical in-use runtime and existing workspace untouched. All 732 package manifest entries verified, and all 21 portable smoke checks passed. A separate query through the packaged runtime against the existing Bangla snapshot returned `punchAnim`, class `Animation`, with retained evidence. Restart the running app to load the updated files.
