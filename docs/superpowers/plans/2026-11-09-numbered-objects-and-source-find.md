# Numbered object context and source Find

Goal: explain numeric saved-object names without removing valid relationships, and reproduce the supplied browser Find bar within the source inspector.

Evidence: Bangla's saved ImageButton `9` is `DataModel/StarterGui/Inventory/Frame/9`; Manager's two supported conditional MODIFIES edges write `gui.Visible` at saved-source lines 338 and 349, inside callbacks registered for children of Frame. All nine numbered buttons are saved objects. Other supplied games have numeric saved names too; names alone are not evidence of a resolution error.

Design: qualify purely numeric instance labels with their class and the nearest two named ancestors. The inspector shows the same display label plus actual saved name and path. Preserve IDs, names, types, evidence and potential-behavior semantics. React owns the compact dark Find bar. Search is literal and case-insensitive across the full retained source variant, with a counter, wrapping previous/next buttons, Enter/Shift+Enter, Ctrl/Cmd+F and Escape/close. Return bounded excerpts centered on the active match rather than downloading complete large scripts. Keep evidence highlighting and ordinary source paging when Find is empty/closed. Existing uncommitted work remains intact.

- [x] Add red tests for numbered labels, filtered parent context and inspector saved identity.
- [x] Implement numbered display labels and inspector context; audit other game graphs for legitimate numeric names.
- [x] Add red tests for whole-source literal search, UTF-8 locators, original/saved variants, wrap and missing matches.
- [x] Implement bounded source search in query/store contracts and a reusable search helper.
- [x] Build the reference-style Find bar with stale-result protection, navigation, focus and highlighted current/all loaded matches.
- [x] Run core/UI/browser checks, review code and screenshots, build/package, verify existing Bangla and package smoke checks.

Validation so far: 201 tests across 59 files, 12 actual Edge browser checks, typecheck, build and diff checks passed. Existing saved analyses verified 9 / 24 / 10 / 0 / 0 numeric objects across Bangla / BrokenPVP / DemonHunting / Photon / SaveHer; all now have qualified display labels. Bangla node 9 retains its saved name, class and two Manager visibility relationships. Searching its complete Manager source finds eight literal `gui.Visible` occurrences.

Review fixes: explicitly anchor the active highlight to the server-provided UTF-8 range when repeated/overlapping text has a different matching phase at an excerpt boundary. Mark truncated ancestry with an ellipsis, and show saved identity for roots too. An ASCII matching fast path counted 16,777,216 hits and selected the last in about 307 ms on this machine, while retaining Unicode regex folding for non-ASCII source. The API still returns bounded excerpts, not full large files.

Package verification: refreshed the portable Windows folder and ZIP; verified all 732 manifest files while preserving the running, identical runtime and existing workspace. The bundled CLI searched the existing Bangla analysis, returned eight `gui.Visible` matches, and selected the second in a 5,869-byte excerpt. All 21 package workflow checks passed with local connections enabled (the restricted run could not reach its local test server). Packaging validation ran on this development computer, not a separate clean PC.
