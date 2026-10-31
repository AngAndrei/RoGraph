# Use RoGraph

Extract the whole Windows ZIP into a writable folder and open `RoGraph.exe`. Keep the folders next to the executable; it uses its own Node runtime and native helpers. The default local workspace is the package's `workspace/` folder. A command-line `--workspace` argument chooses a different dedicated folder.

In Roblox Studio, save your place as **Roblox Place (.rbxlx or .rbxl)**. Choose that file in RoGraph and click **Analyze**. The original file is read, not modified. Native game code is never executed. A snapshot keeps decoded script text and an owned copy of the raw place, so inspection works after the original is moved or edited.

The left panel searches all indexed objects, methods, fields, and unknown nodes. Expand the hierarchy to find objects omitted from the default graph, including geometry. The center opens with a bounded script overview. **Details** shows methods and fields; selecting a node opens its functions, configuration, and relationships. **Overview** returns to the initial view. Context/type/status filters narrow the graph.

**Dependencies** follows modeled uses. **Impact** follows reverse uses and separately labels potential channel effects. Structural containment is not a dependency. **Trace a path** selects a start and destination from the current bounded graph. Search/inspect a different neighborhood if the desired endpoint is not present.

For the sample shop, choose `ShopClient.BuySword` and `ShopConfig.Prices.Sword`. The trace includes a remote send, the server handler, the purchase method, and the price read. Select **Source** at any hop to see its exact saved expression. Remote/bindable paths are potential communication; they do not establish execution order or runtime data flow.

Expand a relationship card to inspect its mechanism, assumptions, and retained source occurrences. Large inspections have **Next evidence page** and **First evidence page** controls. Source excerpts can be paged independently. Their SHA-256 describes the full source revision; displayed excerpts are explicitly partial. Byte offsets refer to decoded UTF-8 Luau text, with one-based Unicode character columns and lines, not byte positions in the surrounding XML.

Saved values are initial values, not runtime-final values. Exact large integer values and non-finite values use explicit JSON markers (`int64`, `uint64`, `nonFinite`); non-UTF-8 Luau string values use `bytesHex`. Unmodeled non-finite compound properties produce a partial-import diagnostic and retain the raw XML.

**Coverage** distinguishes imported objects, parsed scripts, resolved/candidate sites, and unknowns. An incomplete/partial snapshot remains inspectable but cannot replace the last complete current snapshot. Missing or invalid script source and unresolved dynamic behavior constrain conclusions. No modeled dependent does not prove a change is safe.

For Rojo, choose **Rojo project**, paste the path to `default.project.json`, and optionally enable **Watch for saved changes**. RoGraph captures contained files together, verifies the pinned build and sourcemap, then uses the same importer. Symlinks and mounts escaping the project are rejected. Use a dedicated analysis workspace; mounting game source inside that workspace is rejected. A watch change creates a new immutable snapshot and offers an **Open new snapshot** action. The displayed evidence stays pinned until you switch.

Original Rojo code/config text is stored separately from generated Luau. Source inspection offers both views. Generated JSON/TOML/model statements do not claim original line coordinates when no mapping exists.

**Export context** downloads a bounded pack for the current view. The default is 2,000 estimated tokens; the hard cap is 32,000 UTF-8 bytes. Estimates use characters/4. Read the included omissions and coverage. Full graph export is available from the CLI; the normal browser never needs the complete graph download. See `agent-setup.md` for MCP.

**Compare snapshots** compares modeled relationships after matching logical identities. Duplicate/ambiguous matches remain explicit. These are relationship differences, not a claim that two game files are otherwise identical.

Use **Stop app** to close the local service. The portable launcher owns its Node process and helpers. Closing the browser tab alone does not stop an in-progress analysis. Snapshots and caches remain on disk; stop RoGraph before moving or deleting a workspace. Keep your original game files outside the dedicated workspace.

Use **Group by** to organize the canvas by service or folder; **Visible group** focuses one group. **Classes**, **Depth**, and **Show saved objects** control the graph scope. Graph actions and context exports retain the selected filters. Trace endpoint search covers the pinned snapshot beyond the current canvas. The diagnostic report supports paging, affected-object inspection, and exact source locations for parse errors. Original binary Rojo models are retained as verified blobs and are never displayed as UTF-8 text.
