# Provided-game validation

Three locally supplied games were tested on 2026-10-31. Their place files, script source, snapshots, and detailed reports are excluded from this repository. These results validate the listed saved-file workflows, with the coverage limits below.

| Game           | Format   | Saved objects | Scripts parsed | Resolved / unresolved code sites | Import status                                                  |
| -------------- | -------- | ------------: | -------------: | -------------------------------: | -------------------------------------------------------------- |
| Big Brain      | `.rbxl`  |         8,077 |        45 / 46 |                      498 / 1,052 | Partial; decoder warnings and one script with parse errors     |
| Egg High       | `.rbxlx` |           366 |        10 / 10 |                    1,017 / 3,119 | Partial; unsupported serialized property retained in raw input |
| Grow a Chicken | `.rbxl`  |         2,738 |        28 / 28 |                      420 / 1,246 | Partial; decoder warning                                       |

For every game, the pipeline imported the place, searched the index, inspected a node, queried dependencies and impact, retrieved revision-pinned source, traced a modeled relationship with evidence for each hop, exported bounded context, reopened the database, and verified exact retained raw bytes. SHA-256 checks before and after confirmed the original place files were unchanged. Cold runs on this computer took approximately 5.4, 5.0, and 3.2 seconds respectively; these are observations, not general response-time guarantees.

All three analyses remain inspectable as partial snapshots. They cannot replace an existing complete current analysis. The parser did not recover a semantic graph for the one invalid/unsupported script in Big Brain. Dynamic dispatch, external asset code, and runtime-created objects remain outside these saved-file results. A successful workflow does not establish complete dependency coverage or runtime execution.

Run `node --import tsx scripts/validate-games.ts <local-directory> <private-report.json>` from a prepared checkout to reproduce the workflow checks with your own inputs. Reports include coverage, retained input hashes, diagnostic counts, and per-workflow outcomes. Keep reports and original games outside version control.
