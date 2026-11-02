# RoGraph validation

## 0.2.0 gameplay update

Latest correction checks: **145/145 TypeScript tests**, **2/2 native importer tests**, typecheck/build and **6/6 Edge browser workflows** passed. A focused independent review of the large-input fix found no actionable issues. The new lookup tests count object visits/context reads rather than relying on timing thresholds.

Large-input correction: three additional games passed the saved-file workflows with unchanged originals, including places with 58,870 and 32,294 objects; see [provided-game-validation.md](provided-game-validation.md). Repeated hierarchy/context scans are indexed or cached, with bounded retained traversal results. Large opaque shared buffers use explicit hash/size/raw-input metadata and partial status, avoiding native-output expansion. Neither the 120-second worker deadline nor the 256 MiB native-response limit was raised. Regression checks cover lookup work, constructor invalidation, compact repeated mesh data, and exact inline source/small buffers.

Viewport correction: dragging outermost nodes now keeps the graph's coordinate frame fixed, including after release. Rapid node drags no longer trigger double-click zoom. Background panning, mouse-wheel zoom and explicit Fit graph remain available; new layouts establish fresh bounds. A real-renderer browser regression reproduced the drift before the fix and now checks inward/outward drags at all four margins, a stationary node and camera, manual fit, pan and wheel. All six browser workflows, nine component tests, typecheck and build pass for this correction.

Application checks: 142/142 unit/integration/component tests; typecheck/build; five Edge browser workflows including the authored Chicken/Egg gameplay fixture, cross-view selection, Code source/context, XML/binary imports and snapshot pinning. The portable smoke procedure additionally checks the bundled Gameplay sample, model-to-template trace evidence, support-site omission disclosure and config provenance. Three private inputs were reanalyzed with gameplay overview/context and unchanged-input/reopen checks; see [provided-game-validation.md](provided-game-validation.md).

The update keeps one canonical graph with Gameplay/Code projections. Visible gameplay endpoints must be concrete saved or source-defined objects and retain real names. Template-copy identity and player role paths stay in relationship metadata. Regression checks cover config alternatives, nil versus unknown, library shadowing/mutation, callback/guard growth, native class/receiver safety, actual model-to-template paths, and remote direction compatibility. No model weights or Studio plugin are installed.

Portable release: **21/21 checks passed** on the development computer with the packaged runtime and dependency-isolation harness. This includes the four Gameplay proof checks above, the existing XML/binary, Code, MCP, pinned Rojo, source/context, reopening, input-immutability and process-cleanup checks. It is not a separate clean-PC test. Notice files with timestamps outside ZIP's supported range are normalized only in staging copies; their contents and hashes are preserved.

The independent review's eight findings were fixed in one tested pass; see [review-and-decisions.md](review-and-decisions.md). The saved Grow a Chicken input also passed an explicit Chicken → Script → Egg trace and config-definition provenance check. Original game files and detailed private reports are excluded from Git.

## 0.1.0 baseline

Status: **Windows x64 preview validated with synthetic fixtures and three supplied games**. See [provided-game-validation.md](provided-game-validation.md) for the partial-import and parsing limits in those games. A separate clean Windows computer was not available. Saved-file static analysis is the first release; runtime Studio capture is deferred.

The release was built with the versions in `tools/versions.lock.json`, the npm lockfile, and native Cargo lockfiles, on Windows 11 with Node 24.19.0 and Rust 1.90.0. The importer and Luau helper use static compiler runtimes. PE dependency inspection found Windows system DLLs only for the launcher and native helpers.

Validation covers the actual pinned importer/parser processes, lexical resolution, saved properties, source provenance, SQLite reopening/publication, bounded traversal/context, CLI, the official MCP SDK over stdio, authenticated local HTTP, and real Edge/WebGL browser workflows. The Rust test commands compile successfully but currently contain zero Rust unit cases; native behavior is covered by the application integration tests.

The portable smoke harness verifies every manifest checksum, copies only release files to a folder containing spaces and Unicode, uses the bundled Node with a system-only PATH, rejects JavaScript module loading outside the package, and blocks Node network calls. It imports the bundled XML and binary shop samples, searches its configuration, traces the four-hop potential remote path with evidence, exports bounded context, reopens the workspace, confirms the input is unchanged, negotiates actual MCP stdio, starts pinned Rojo, serves local UI assets with CSP, and verifies that terminating the launcher closes its owned service. The launcher uses the Windows GUI subsystem and a job object for owned child processes.

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

The single independent whole-branch review identified 15 Important issues, all addressed in one regression-driven fix pass. The final suite passed 96 tests, including loss/ambiguity/diagnostic regressions, and all four Edge browser workflows passed. Two smaller items remain deferred: search indexes labels rather than source contents, and a watcher that closes after an error can still report enabled.
