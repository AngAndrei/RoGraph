# RoGraph import QA strategy

The goal is to preserve the saved data RoGraph can read, build only graph links supported by evidence, and tell the user which parts of the game the analysis could not cover. This review starts from `chat_bot_RAG` at `3aa245d`.

| Phase | Work | Exit check |
| --- | --- | --- |
| 1. Baseline | Run saved-game workflow checks and reproduce each suspected issue in a small fixture. Record the job status, coverage, reasons, evidence, and original file hash. | Each issue has a reproduction, an existing regression that covers it, or a stated reason it cannot be reproduced. |
| 2. Fix recoverable failures | Work on decoder fidelity, script coverage and publication, static resolution, Rojo provenance, and the Coverage and Diagnostics UI in parallel. Keep tests in the owning area. | Each product fix has a failing reproduction and a passing regression. Uncertain targets stay uncertain. Existing snapshots remain readable. |
| 3. Test adjacent cases | Repeat the fixture with related input shapes and check the next stage of the pipeline. Send newly reproduced failures back to the owning investigator. Check scale, cancellation, and error reporting separately from graph correctness. | Targeted regressions and their positive controls pass. The first successful attempt is checked against a neighboring case. |
| 4. Integrate | Run type checking, build, automated tests, and repeat the supplied place imports. Compare statuses, script and site coverage, confirmed edges, diagnostics, raw byte retention, and timing. | Report the checks actually run, any changed behavior, and any remaining limitations with their next test or decision. |

Use independent scratch fixtures and workspaces for QA. Never alter the original game files. Keep private source, hashes, detailed per-game analysis, and workspace databases out of version control. Use the same saved inputs and runner when comparing results. Analyze counts alongside reasons and evidence: a lower unresolved total can come from fewer discovered sites, and a newly recognized operation may have no project edge.

### What to verify by area

| Area | Cases |
| --- | --- |
| Saved place decoding | XML and binary, unsupported or dropped properties, attribute fallback, nonfinite values, dangling references, object inventory, decoder warnings, and compact representation with exact raw bytes retained. |
| Script coverage | Valid, empty, missing, and invalid Luau. Preserve exact source and diagnostic locations. Check job status, reopened snapshots, and which analysis is published as current. |
| Resolution | Missing and duplicate objects, dynamic names, aliases and writes, callbacks, conditional modules, external modules, unsupported operations, budgets, and client/server direction. Check both positive evidence and the absence of unsupported claims. |
| Rojo | Capture and build consistency, source mapping, generated/binary inputs, omitted root properties, project boundaries, and watch updates. Distinguish an unmapped source from unavailable source text. |
| Coverage, diagnostics, and queries | Counts and pagination, snapshot changes, diagnostic source links, uncertainty explanations, filters and truncation. Check what the user sees and what the query or export actually contains. |
| Fatal errors and scale | Unsupported and malformed inputs, size and worker limits, helper failures, and cancellation. Check the failed stage and whether the last complete snapshot remains accessible. |

Classify remaining cases as input rejection, saved data representation, missing script coverage, incomplete static evidence, absent runtime data, or bounded retrieval. Some unknowns require a different input or runtime observations. Converting them into confirmed edges from the saved file would make the analysis less accurate. Keep those gaps visible and verify that they do not affect unrelated evidence.

### Results by failure type

| Failure type | Change and regression coverage | Remaining boundary |
| --- | --- | --- |
| Saved serialization | Missing XML shared payloads are reported instead of looking like empty data. Nonfinite compound properties retain an affected-object diagnostic. Binary `Content` object references use stable IDs and saved relationship evidence. A declaration-like string inside source no longer rejects the file. | Unknown formats and properties the pinned decoder cannot represent still require diagnostics and retained raw data. The binary decoder can fold absent object references into null, so the distinction needs raw binary inventory or upstream support. Opaque buffers still carry hash and size metadata. |
| Missing or invalid scripts | Imports with incomplete script coverage remain inspectable and preserve the last published analysis. Diagnostic source ranges preserve exact BOM bytes. A new analysis identity allows old inputs to be reimported under the new policy. | Previously stored snapshots remain immutable. Syntax-invalid scripts retain source and diagnostics with no semantic edges for the affected script. |
| Static references | Known conditional module and callable alternatives appear as candidates. Ordinary method calls retain their confirmed evidence. Event context errors and unknown handlers retain specific reasons. Supported inline table iteration keeps candidate objects and correct result slots. | Dynamic names, mutations, unknown callers, arbitrary iterators, external asset code and runtime-only values can still leave unknowns. |
| Rojo source mapping and watch | Map paths to the verified captured files on Windows. Preserve original provenance for a unique model or inline source, report ambiguous origins, limit repeated retained source text, clean canceled captures, and run one initial job for import with watch. The UI offers partial watched revisions for inspection. | Rojo builds omit some custom root properties and Studio-only objects. Unmapped source uses the retained compiled script when available. |
| Reporting and retrieval | Coverage shows limitations. Diagnostics show severity and total across pages. Traversal reports endpoint omissions, and diagnostic pagination does not count as a graph query limit. | Overview, traversal and AI context budgets still apply. Their omissions can be inspected separately from import coverage. |
| Failed and canceled jobs | Malformed places, hard limits, and native helper failures report distinct codes. A stopped worker rejects calls promptly. If a save times out, RoGraph reopens the store and checks for the exact committed analysis. An absent commit still fails, and a canceled job still cancels. | Large inputs can still hit deadlines and memory or output limits. Check stage timings and resource use on the target machine before changing guards. |

Run `node --import tsx scripts/validate-games.ts <local-place-directory> <private-report.json> <scratch-workspaces>` to compare revisions. Use separate, empty workspace directories for cold runs. The runner records each failed phase, continues to other inputs, and exits with a nonzero status if any input fails its checks.

### Saved game validation

All six supplied files passed the saved game workflow across the initial run and one fresh-workspace retry. Each passed source inspection, a sampled modeled trace, bounded context export, database reopening, and hash checks for both the retained input and the original.

| Game | Scripts parsed | Unresolved before → after | Candidates before → after | Saved snapshot |
| --- | ---: | ---: | ---: | --- |
| Bangla Battlegrounds | 27/27 | 1,237 → 1,223 | 320 → 429 | Partial |
| BrokenPVP | 163/163 | 8,772 → 8,711 | 1,942 → 2,355 | Partial |
| DemonHunting | 120/121 | 3,321 → 3,315 | 957 → 1,232 | Partial |
| Grow a Chicken | 14/14 | 143 → 144 | 90 → 102 | Partial |
| Photon | 13/13 | 150 → 146 | 127 → 141 | Complete |
| SaveHer | 4/4 | 65 → 55 | 26 → 41 | Complete |

The frozen `3aa245d` baseline finished all six checks on the same input hashes. Both revisions found 28,746 sites overall. Unresolved sites went from 13,688 to 13,594, candidates from 3,462 to 4,300, and resolved sites from 11,596 to 10,852. Higher candidate counts are consistent with keeping conditional and unsupported outcomes visible. The focused site regressions establish the expected classification on known source patterns. These aggregate figures do not measure runtime accuracy.

BrokenPVP initially hit the 120-second worker deadline during persistence. A read-only SQLite check found the exact snapshot committed and still marked partial. A dedicated regression reproduced the lost acknowledgement and verified recovery without repeating the write. The fresh real-game retry took about 130 seconds total, including 44 seconds in persistence. These observations are sensitive to machine load and preserve the existing worker and native deadlines.

DemonHunting's 55 parse messages came from one script with 11 uncommented date headings. RoGraph retained the exact source and marked its script coverage incomplete. Correcting the source requires editing those headings in the game, for example changing a bare date to a Luau comment before reimporting.

The final automated run passed 599 tests across 88 files. Six Rust importer tests, TypeScript checking, and the production build also passed. The Playwright browser check stopped at Edge startup, before exercising the app. The local HTTP and component tests passed in the final suite.
