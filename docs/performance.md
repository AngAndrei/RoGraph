# Measured performance

## Gameplay preview (0.2.0)

One development-machine run on 2026-10-31 used the same 50,000-object, 1,000-script, 100,000-line synthetic input as the baseline below. It measured 91.3 seconds cold analysis, 0.97 ms warm Code search, 633 ms Code impact, 620 ms Code overview, 2.29 seconds first browser overview, and 2.14 GiB sampled aggregate working set. Cold-import, warm-query and memory targets were missed. These are observations from one run before the final correctness fixes, not repeated final-build measurements or a Gameplay performance guarantee. See [performance-gameplay-results.json](performance-gameplay-results.json) for the input, tool hashes and samples.

The final correctness checks and private-game timings are recorded separately in [release-validation.md](release-validation.md) and [provided-game-validation.md](provided-game-validation.md). Larger games can take over a minute and require several GiB of memory. The sampling limits below still apply.

## Original preview baseline (0.1.0)

RoGraph 0.1 has synthetic-fixture and provided-game validation. This benchmark is a synthetic workload, not a promise about every game with the same object count.

The final 2026-10-31 Windows run used an Intel i7-1165G7 (8 logical processors), about 16 GB RAM, Node 24.19.0, 50,000 saved Instances, 1,000 unique script texts, 100,000 source lines, and 100,899 source relationship occurrences. Geometry has minimal saved properties. The scripts repeatedly read a shared configuration; this does not represent 100,000 unique call edges or large mesh/binary properties.

| Measurement                               | Observed                     | Target           |
| ----------------------------------------- | ---------------------------- | ---------------- |
| Three independent cold analyses           | 77.7 / 107.0 / 116.6 seconds | under 60 seconds |
| Cold median                               | 107.0 seconds                | under 60 seconds |
| Warm search median / slowest              | 0.7 / 15.4 ms                | under 500 ms     |
| Warm config impact median / slowest       | 444.5 / 1,245.1 ms           | under 500 ms     |
| Warm overview median / slowest            | 630.4 / 1,491.9 ms           | under 500 ms     |
| First browser overview with worker layout | 3.75 seconds                 | under 3 seconds  |
| Sampled aggregate working set             | 1.78 GiB                     | under 2 GiB      |

**Cold-import, warm-overview, and first-render targets were not met in the final run.** Some cold analyses overlapped regression checks, and desktop activity was not controlled. Large imports can take over a minute, and queries may wait during synchronous database publication. The hard import limits below are guards, not supported-capacity or response-time guarantees. Allow for slower disks, background load, richer saved properties, and different graph shapes. Three supplied games passed the documented workflows with partial-import warnings; see provided-game-validation.md.

Memory is sampled across the process tree, including the Node service and its worker threads, native helpers, and the test browser. Worker threads share the Node process working set and are not double-counted. Short-lived helper peaks may fall between 200 ms samples; shared DLL pages can be counted in multiple processes. The Node process high-water reading is recorded separately. These are measured working sets, not a strict memory bound.

The initial unindexed service lookup exceeded the worker timeout. Indexing service classes removed that scan. Reusing one parser process reduced an earlier single-run cold analysis from 70.9 to 34.2 seconds. Streaming syntax into the CPU worker avoids retaining every AST in the host. Those observations motivated the changes; the table above reports the later repeated run, including its slow cases.

Default retrieval limits are depth 3 (maximum 6), 1,000 nodes, 5,000 evidence records, five paths, and a 300-node initial overview. Evidence selection reserves an occurrence for each relationship before filling the remaining budget. Inspections provide analysis/filter-bound cursors for subsequent evidence pages. Omissions and coverage remain in every result. Source reads return at most 32,000 UTF-8 bytes per excerpt; context packs default to 2,000 estimated tokens with a 32,000-byte hard cap. Estimates use characters/4.

Import guards are 512 MiB input, 200,000 saved Instances, 16 MiB per script, 256 MiB total decoded source, and XML depth 256. Individual native responses are capped at 256 MiB. Jobs and worker queues are bounded. Cancellation preserves the last complete published snapshot.

Reproduce from a development checkout:

```powershell
npm run build
npm run bench -- --profile release --output build/release-benchmark.json
```

The benchmark needs Microsoft Edge for its browser measurement and PowerShell 7 for process-tree memory sampling. It creates owned synthetic inputs under `build/bench-*`; game source is never executed. The browser requests the bounded overview and a bounded inspection, rather than downloading the full graph. Exact input, tool/bundle hashes, stage timings, and raw measurements are in [performance-results.json](performance-results.json).
