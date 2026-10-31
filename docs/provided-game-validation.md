# Provided-game validation

## Additional games: large-input correction

Three additional saved `.rbxl` games were tested on 2026-10-31 with resolver 9 and native serialization 4. All passed Gameplay overview/context, Code search/inspection/source, modeled trace, bounded context export, database reopening, retained raw-byte and unchanged-original checks. The owned-model/template trace was sampled for BrokenPVP and DemonHunting; Photon had no matching sampled pattern. Game source, input files, detailed reports and CPU profiles remain excluded from Git.

| Game         | Saved objects | Scripts parsed | Observed analysis | Gameplay relationships | Import status                                                                               |
| ------------ | ------------: | -------------: | ----------------: | ---------------------: | ------------------------------------------------------------------------------------------- |
| BrokenPVP    |        58,870 |      163 / 163 |            51.0 s |                  2,111 | Partial; numeric-property warnings and opaque-buffer metadata                               |
| DemonHunting |        32,294 |      120 / 121 |            35.2 s |                  1,500 | Partial; one script with parse errors, numeric-property warnings and opaque-buffer metadata |
| Photon       |           101 |        13 / 13 |             1.6 s |                     78 | Complete saved-file import; static unresolved/candidate sites remain                        |

The first baseline took about 125 seconds overall; that run overlapped diagnostic profiling, so this is not a controlled speedup comparison. DemonHunting originally failed the 256 MiB native-output limit: repeated `MeshPart.PhysicalConfigData` values alone serialized to roughly 218 MB. Hierarchy lookups now reuse an index and bounded traversal cache, and callback binding reuses execution contexts. The worker deadline and native-output cap were not increased.

Opaque `SharedString` values over 1,024 bytes are represented by BLAKE3 hash, byte length and an explicit `rawInput` retention marker instead of repeated inline physics/geometry buffers. A diagnostic and partial-import status disclose this representation. Exact payload bytes remain in the retained raw place; script source, references and small buffers remain inline. These observations establish the listed saved-file workflows, not complete runtime behavior, universal game compatibility or a clean-PC performance guarantee.

The rebuilt Windows executable was tested separately on all three originals in dedicated workspaces. It completed analysis in **89.7 / 50.4 / 1.0 seconds** respectively, then reopened both Gameplay and Code overviews for each revision. All input hashes remained unchanged. These executable timings include startup and differ from the development-pipeline observations above; the portable smoke procedure ran alongside part of this check. The rebuilt package also passed all **21** dependency-isolated portable checks.

## Gameplay update (0.2.0)

The same unchanged inputs were reanalyzed with the final gameplay resolver (version 8) on 2026-10-31. These are raw site counts with the same denominators; recognized platform operations and conditional targets are reported separately. Lower unresolved counts do not establish runtime completeness.

| Game           | Code sites | Resolved | Conditional candidates | Unresolved (0.1 → 0.2) | Gameplay relations | Visible object/file nodes | Observed analysis |
| -------------- | ---------: | -------: | ---------------------: | ---------------------: | -----------------: | ------------------------: | ----------------: |
| Big Brain      |      1,550 |      738 |                    183 |            1,052 → 629 |                286 |                       135 |             6.0 s |
| Egg High       |      4,136 |    2,036 |                    522 |          3,119 → 1,578 |                314 |                        95 |             6.4 s |
| Grow a Chicken |      1,666 |      820 |                    241 |            1,246 → 605 |                395 |                        78 |             5.4 s |

Every game passed gameplay overview/context checks and retained only concrete object/file nodes in that view. Grow a Chicken also passed a model → controller → clone-template gameplay trace with source evidence. Inspection confirmed pickup/prompt/tool and Home-button/remote connections. The other two inputs did not supply that particular sampled owned-model/clone pattern; their gameplay trace check is reported as not sampled, not a passing runtime claim. Raw-input retention, unchanged original hashes, Code queries/source/context, and database reopening passed for all three.

All imports retain the earlier partial-import limitations below. Remaining cases include dynamic callable targets, unbound callbacks, missing saved engine services, reassigned aliases, unsupported iterators and computed keys. Local-model categorization and Studio capture remain future work. Timings were observed on the development computer; they are not guarantees or directly controlled comparisons with the earlier runs.

## Original preview baseline

Three locally supplied games were tested on 2026-10-31. Their place files, script source, snapshots, and detailed reports are excluded from this repository. These results validate the listed saved-file workflows, with the coverage limits below.

| Game           | Format   | Saved objects | Scripts parsed | Resolved / unresolved code sites | Import status                                                  |
| -------------- | -------- | ------------: | -------------: | -------------------------------: | -------------------------------------------------------------- |
| Big Brain      | `.rbxl`  |         8,077 |        45 / 46 |                      498 / 1,052 | Partial; decoder warnings and one script with parse errors     |
| Egg High       | `.rbxlx` |           366 |        10 / 10 |                    1,017 / 3,119 | Partial; unsupported serialized property retained in raw input |
| Grow a Chicken | `.rbxl`  |         2,738 |        28 / 28 |                      420 / 1,246 | Partial; decoder warning                                       |

For every game, the pipeline imported the place, searched the index, inspected a node, queried dependencies and impact, retrieved revision-pinned source, traced a modeled relationship with evidence for each hop, exported bounded context, reopened the database, and verified exact retained raw bytes. SHA-256 checks before and after confirmed the original place files were unchanged. Cold runs on this computer took approximately 5.4, 5.0, and 3.2 seconds respectively; these are observations, not general response-time guarantees.

All three analyses remain inspectable as partial snapshots. They cannot replace an existing complete current analysis. The parser did not recover a semantic graph for the one invalid/unsupported script in Big Brain. Dynamic dispatch, external asset code, and runtime-created objects remain outside these saved-file results. A successful workflow does not establish complete dependency coverage or runtime execution.

Run `node --import tsx scripts/validate-games.ts <local-directory> <private-report.json>` from a prepared checkout to reproduce the workflow checks with your own inputs. Reports include coverage, retained input hashes, diagnostic counts, and per-workflow outcomes. Keep reports and original games outside version control.
