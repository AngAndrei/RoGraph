# RoGraph 0.1.0 validation

Status: **Windows x64 preview validated with synthetic fixtures and three supplied games**. See [provided-game-validation.md](provided-game-validation.md) for the partial-import and parsing limits in those games. A separate clean Windows computer was not available. Saved-file static analysis is the first release; runtime Studio capture is deferred.

The release was built with the versions in `tools/versions.lock.json`, the npm lockfile, and native Cargo lockfiles, on Windows 11 with Node 24.19.0 and Rust 1.90.0. The importer and Luau helper use static compiler runtimes. PE dependency inspection found Windows system DLLs only for the launcher and native helpers.

Validation covers the actual pinned importer/parser processes, lexical resolution, saved properties, source provenance, SQLite reopening/publication, bounded traversal/context, CLI, the official MCP SDK over stdio, authenticated local HTTP, and real Edge/WebGL browser workflows. The Rust test commands compile successfully but currently contain zero Rust unit cases; native behavior is covered by the application integration tests.

The portable smoke harness verifies every manifest checksum, copies only release files to a folder containing spaces and Unicode, uses the bundled Node with a system-only PATH, rejects JavaScript module loading outside the package, and blocks Node network calls. It imports the bundled shop, searches its configuration, traces the four-hop potential remote path with evidence, exports bounded context, reopens the workspace, confirms the input is unchanged, negotiates actual MCP stdio, starts pinned Rojo, serves local UI assets with CSP, and verifies that terminating the launcher closes its owned service. The launcher uses the Windows GUI subsystem and a job object for owned child processes.

This dependency isolation runs on the development computer. It does not establish behavior on an actual clean PC, verify Windows SmartScreen reputation/code signing, or block browser/operating-system background networking. The browser must be available to display the local interface. The package makes no model/API calls and requires no cloud account.

Browser imports exceeded the original 30-second test wait during ZIP building and other active applications. The tests allow up to 90 seconds for cold development-worker startup while still asserting completed imports and all graph/source behavior. This is separate from the recorded performance benchmark. Performance results, including inconsistent cold-import targets and publication delays, are recorded in [performance.md](performance.md) and [performance-results.json](performance-results.json). Those measurements use synthetic saved objects and repeated configuration reads, rather than a representative production game.

To reproduce from a prepared source checkout:

```powershell
npm run typecheck
npm test
npm run build:native
npm run build
npm run test:e2e
npm run bench -- --profile release --output build/release-benchmark.json
npm run package:windows
powershell -NoProfile -File scripts/release-smoke.ps1 -PackagePath dist/windows-x64
```

The ZIP contains only release files, notices, a sample, and checksums. Existing user workspaces are preserved when refreshing the unpacked output folder and are excluded from the ZIP. Reference checkouts and private game files are excluded from the product repository. Extract the complete ZIP into a writable folder before opening `RoGraph.exe`.
