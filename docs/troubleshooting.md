# Troubleshooting

- **Wrong file format:** `.rbxl` is binary and is not supported by this version. Save a Roblox XML Place (`.rbxlx`) from Studio and import that copy.
- **The app does not open:** extract the entire ZIP into a writable folder. Keep `runtime/`, `dist/`, and `build/bin/` next to `RoGraph.exe`. Set a default browser in Windows. Another copy may hold the same workspace; stop it before rebuilding the package.
- **Browser says a local session is required:** reopen through the launcher. The launcher gives each browser tab its local credential without logging it. A bare copied address does not contain that tab's session.
- **Partial import or missing source:** inspect Coverage and diagnostics. Unknown serialized types, dangling saved references, or unmodeled numeric components remain explicit. The raw input and readable sources are retained; partial imports cannot replace a prior complete current snapshot.
- **Missing connections:** dynamic paths, reassigned aliases, computed exports, metatables, runtime-created Instances, external asset code, and unsupported patterns may remain unresolved. Inspect the unknown node/source; do not infer safety from an empty result. No Luau LSP or runtime capture is included in v1.
- **Rojo rejected a path:** mounts must remain inside the selected project root. Remove symlink/reparse escapes or import an exported `.rbxlx`. Keep source outside the dedicated analysis workspace. The project must declare a DataModel root.
- **Rojo reports mixed revisions:** files changed during capture/build. Retry after saving finishes. Watch mode can capture a later consistent revision; it never combines a build and sourcemap from different inputs.
- **A generated config has different line numbers:** the saved Luau view and original file view are distinct. Generated statement mapping is unavailable for JSON/TOML/model conversions; the UI does not assign Luau line numbers to original files.
- **Slow large import:** see `performance.md`. The 50,000-object benchmark had 31–94 second cold runs on the tested laptop; publication can delay queries. The hard import guards are not a universal capacity guarantee. Cancel or let the job finish; the last complete snapshot remains current.
- **MCP fails to start:** use the full executable path and an existing workspace. Index the game first. Do not route normal logging to protocol stdout. Every query after `workspace` needs an explicit analysis ID.

For development builds, run the pinned bootstrap and native build commands in the repository README. The portable package itself does not need npm, Rust, CMake, Studio, or an API key. Only Windows 11 x64 has been exercised here; separate clean-machine validation remains outstanding.
