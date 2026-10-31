# Third-party notices

RoGraph uses Node.js, React, Sigma, Graphology, Zod, jsonc-parser, the official Model Context Protocol SDK, Roblox DOM/XML Rust libraries and their dependencies, Luau, nlohmann/json, and the optional Rojo command-line tool. Their original notices are included in the portable package's `notices/` directory, with exact dependency versions in its inventory and the repository lockfiles.

The Node notice includes the notices for components bundled into the Node runtime. Luau and nlohmann/json are used under MIT. Rojo 7.7.1 is distributed unmodified under MPL-2.0; its license and corresponding-source location are included. Windows system DLLs are supplied by Windows and are not included in the package.

Graphify and GitNexus supplied architectural inspiration. Their code is not bundled into RoGraph. Graphify's supplied checkout uses MIT; GitNexus's supplied checkout uses PolyForm Noncommercial. Inspiration here means the staged analysis and context-retrieval approach, rather than copying their implementation.

See `notices/dependency-inventory.json`, the individual license texts, `package-lock.json`, and the native Cargo lockfiles for the component inventory. Build/test libraries in that inventory are not all loaded by the distributed application.

The resolver also uses a pinned index of Roblox engine API member names from the official setup.rbxcdn.com API dump. Its source URL, engine version, and SHA-256 are recorded in api-members.json and tools/versions.lock.json. The pinned Rojo source lockfile is used to inventory its Windows dependency closure and nested notices.
