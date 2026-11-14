# Use RoGraph

Graph labels use source variable names for source-created objects when the assignment is supported, while the inspector retains the actual object name and class. Generic or repeated saved names include useful parent context, such as `Leg · Dog`. Existing analyses recover direct assignment names from retained source; a new analysis also recognizes parenthesized or typed creation expressions.

Purely numbered objects include their class and nearby hierarchy in graph and inspector labels, for example `ImageButton 9 · Inventory.Frame`. The inspector also shows their exact saved name and object path; an ellipsis marks omitted ancestors in unusually deep or incomplete hierarchies. A numeric saved name can be intentional: Bangla's inventory buttons are named `1` through `9`, and Manager conditionally changes their visibility during dragging. These labels preserve the original object and supported connections.

Right-click a graph node for **Rename** or **Highlight**. Rename changes its personal graph label; leaving the prompt blank restores the automatic label. Highlight toggles a yellow marker behind the node and label. These annotations preserve the source, relationships, node positions and camera. They are stored in this browser for the analysis and survive page refreshes; a different browser or a new local app address has separate storage. Select a node, focus the graph and press **Shift+F10** for the same menu using the keyboard. Press Escape to close it.

Extract the whole Windows ZIP into a writable folder and open `RoGraph.exe`. Keep the folders next to the executable; it uses its own Node runtime and native helpers. The default local workspace is the package's `workspace/` folder. A command-line `--workspace` argument chooses a different dedicated folder.

In Roblox Studio, save your place as **Roblox Place (.rbxlx or .rbxl)**. Choose that file in RoGraph and click **Analyze**. The original file is read, not modified. Native game code is never executed. A snapshot keeps decoded script text and an owned copy of the raw place, so inspection works after the original is moved or edited.

The center opens in **Gameplay**. Its nodes use actual model, tool, GUI, script and config names; connections describe supported triggers, configuration reads, cloning, movement, state changes and transfers. Clones use the real template node, with the creation site and copy identity in edge details. Players are represented through the actual Players service and explicit runtime role paths.


The graph reports its visible nodes and connections. A line can contain several canonical actions; select it for the details. A **Bounded map** notice means records were omitted from this result. **Partial import** describes a separate input/analysis limitation. Search the project to inspect beyond the current map; neither a sparse map nor an absent link proves that no runtime connection exists.

Switch to **Code** for script dependencies, then **Methods & config** to display functions and fields. Select **Show implementation** to inspect supporting code while preserving the selected object. Click a connection to inspect its retained source occurrences and conditions. Click **Gameplay** or **Code** again to return to that view's overview. The left panel searches all indexed objects, methods and fields; expand the hierarchy for geometry. Class, depth and group controls narrow the graph. Old snapshots require reimporting before Gameplay is available; their Code view stays usable.

Unresolved/candidate sites are attached to the inspected neighborhood rather than drawn as generic gameplay objects. **Saved source excerpt** means the imported text is retained exactly; **Relationship resolution** separately reports whether analysis identified a target. Conditional config choices remain visible with their alternatives. The app models potential behavior, not a recorded play session.

**Dependencies** follows modeled uses. **Impact** follows reverse uses and separately labels potential channel effects. Their scope names the original selected component; **Back to overview** restores the overview. Structural containment is not a dependency. **Trace a path** selects a start and destination, with endpoint search across the pinned snapshot. In Gameplay, choose the trace question: potential gameplay flow excludes configuration reads, while the configuration option includes those influence links. Neither establishes runtime execution order. Choose two different components and inspect each returned hop's source.

For the sample shop, choose `ShopClient.BuySword` and `ShopConfig.Prices.Sword`. The trace includes a remote send, the server handler, the purchase method, and the price read. Select **Source** at any hop to see its exact saved expression. Remote/bindable paths are potential communication; they do not establish execution order or runtime data flow.

Expand a relationship card to inspect its mechanism, assumptions, and retained source occurrences. Large inspections have **Next evidence page** and **First evidence page** controls. Source excerpts can be paged independently. Their SHA-256 describes the full source revision; displayed excerpts are explicitly partial. Byte offsets refer to decoded UTF-8 Luau text, with one-based Unicode character columns and lines, not byte positions in the surrounding XML.

The source inspector's dark **Find in source** bar searches the complete saved source file (or the selected original-file variant), including text outside the displayed excerpt. Matches update as you type. The counter shows the current match and total; the arrows, Enter and Shift+Enter move through matches and wrap at either end. The current match is orange and other loaded matches are yellow. Ctrl+F or Cmd+F opens/focuses Find; Escape or its × button closes Find while leaving the source inspector open. Search is literal and case-insensitive; source is still retrieved in bounded excerpts around the selected match.

Saved values are initial values, not runtime-final values. Exact large integer values and non-finite values use explicit JSON markers (`int64`, `uint64`, `nonFinite`); non-UTF-8 Luau string values use `bytesHex`. Unmodeled non-finite compound properties produce a partial-import diagnostic and retain the raw XML.

**Coverage** distinguishes imported objects, parsed scripts, resolved/candidate sites, and unknowns. An incomplete/partial snapshot remains inspectable but cannot replace the last complete current snapshot. Missing or invalid script source and unresolved dynamic behavior constrain conclusions. No modeled dependent does not prove a change is safe.

For Rojo, choose **Rojo project**, paste the path to `default.project.json`, and optionally enable **Watch for saved changes**. RoGraph captures contained files together, verifies the pinned build and sourcemap, then uses the same importer. Symlinks and mounts escaping the project are rejected. Use a dedicated analysis workspace; mounting game source inside that workspace is rejected. A watch change creates a new immutable snapshot and offers an **Open new snapshot** action. The displayed evidence stays pinned until you switch.

Original Rojo code/config text is stored separately from generated Luau. Source inspection offers both views. Generated JSON/TOML/model statements do not claim original line coordinates when no mapping exists.

**Export context** downloads a bounded pack for the current view. The default is 2,000 estimated tokens; the hard cap is 32,000 UTF-8 bytes. Estimates use characters/4. Read the included omissions and coverage. Full graph export is available from the CLI; the normal browser never needs the complete graph download. See `agent-setup.md` for MCP.


Close the last RoGraph tab or browser window to stop the local service. A short grace period allows page reloads; other open RoGraph tabs keep it running. If a browser crashes without delivering its close event, an inactive-session timeout stops the service. Original game files and saved snapshots remain on disk.

Use **Group by** to organize the canvas by service or folder; **Visible group** focuses one group. **Classes** and **Depth** control the graph scope. **Search nodes** matches full or partial displayed labels in the current graph, ignoring case and including personal renames. Click a result to select and center that node while retaining its connections; clear the field to close the results. Graph actions and context exports retain the selected filters. Trace endpoint search covers the pinned snapshot beyond the current canvas. The diagnostic report supports paging, affected-object inspection, and exact source locations for parse errors. Original binary Rojo models are retained as verified blobs and are never displayed as UTF-8 text.

The initial graph layout can spend several seconds optimizing crossings and edge clearance. This runs in the background. Reopening an unchanged view in the same browser session restores its arrangement and camera without repeating the optimization. Dragged nodes are preserved as manual constraints when that view's visible graph changes; other nodes can move as the graph changes.

Select a node and choose **Focus selected neighborhood** to inspect its direct neighbors. The graph reports hidden nodes and hidden connections. **Show whole graph** returns to the current filtered overview. A partial query still omits project content outside that query; focus does not load that content automatically.

Arrows preserve the original relationship directions, including connections that contain actions in both directions. Graph placement does not establish runtime execution order. Use **Trace a path** to follow a particular supported route with source evidence.

Hover reveals the full node label. Selected nodes remain highlighted, and repeated names include available parent/path context. **Search nodes**, project search, starting-guide buttons and inspector connections provide keyboard-accessible selection. If the renderer is unavailable, a node list remains available; if background layout fails, the graph keeps basic positions and reopening the view retries optimization.

Use the sun/moon switch beside **Import project** to change between light and dark mode. The choice is remembered in this browser.
