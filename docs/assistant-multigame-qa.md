# Real-game assistant QA and model choice — 15 November 2026

**Recommendation: keep Qwen3.5-2B Q4_K_M as the default for this helper.** On the same real-game tasks it gave the best measured accuracy/latency/download balance. The 0.8B model was materially less reliable for natural-language intent interpretation. The 4B model was slower and did not improve success in the current prompt/schema/runtime integration. This recommendation is specific to these tested models, tasks and this machine, not a universal LLM ranking.

## Model comparison before the new routing fixes

Each model received the same **72 questions across four actual saved games**: 40 inference-required paraphrases (10 forms instantiated with verified game symbols) and 32 commands/ambiguity/missing-name/scope checks. There were **216 scored responses**. Commands bypassed the model in all three runs. Prompt, schema, quantization family, CPU thread limit and graph snapshots remained fixed between candidates. Each candidate had one pass, with the application's non-thinking structured-JSON configuration (temperature 0.1, top-p 0.8, maximum 220 output tokens, four CPU threads and 4,096 context tokens). The application does not fix a sampling seed, so reruns can differ. App-help retrieval and explicit commands do not need the model; this comparison isolates its optional intent-interpreter role.

| Model | Inference-required tasks | All tasks | Warm response median | First model response | Weights |
| --- | --- | --- | --- | --- | --- |
| Qwen3.5 0.8B Q4_K_M | 19/40 (47.5%) | 51/72 | 1.90 s | 14.72 s | 0.53 GB |
| Qwen3.5 2B Q4_K_M | 36/40 (90.0%) | 68/72 | 2.18 s | 19.37 s | 1.28 GB |
| Qwen3.5 4B Q4_K_M | 33/40 (82.5%) | 65/72 | 5.82 s | 46.65 s | 2.74 GB |

Warm response timing includes intent interpretation and canonical retrieval, excluding the first model-backed question, HTTP transport and browser rendering. These were sequential runs on an active, memory-constrained Windows desktop (i7-1165G7, 15.7 GiB RAM, Intel Iris Xe; CPU backend forced for comparability). Initial reported free RAM was approximately 1.7–2.6 GiB. Cold timing includes checksum verification/loading. Desktop load, filesystem/page cache and graph-derived-label caches were not controlled; timing is indicative, not a service-level guarantee or a laboratory throughput comparison.

The measured difference is more useful than model-size assumptions: 2B took about 2.18 s warm versus 5.82 s for 4B, while scoring 36/40 versus 33/40 on the model-required subset. The smaller 0.8B was only modestly faster here and scored 19/40. All three passed **32/32** explicit command checks. On very limited hardware, model-free help and explicit commands remain available; downloading 0.8B does not provide 2B-level paraphrase reliability.

| Interpreted task | 0.8B | 2B | 4B |
| --- | --- | --- | --- |
| search | 8/8 | 8/8 | 8/8 |
| source | 3/8 | 8/8 | 8/8 |
| dependencies | 2/8 | 8/8 | 4/8 |
| impact | 0/8 | 5/8 | 5/8 |
| trace | 6/8 | 7/8 | 8/8 |

The 2B failures were three caller/impact questions routed as dependencies and one passive-reachability trace with incorrect direction. The 4B run also missed caller direction and fell back on some outgoing-dependency questions. Missing/invalid intent handling kept retrieval bounded; these failures were not counted as successful answers simply because the reply was valid JSON or contained real graph facts.

Qwen3.5-9B was not benchmarked: its catalog recommendation is 24 GiB RAM, above this machine's 15.7 GiB. Other model families, dedicated GPUs, other machines and languages were not compared. All tested weights were downloaded from pinned catalog artifacts and SHA-256 verified. Official model context: [0.8B](https://huggingface.co/Qwen/Qwen3.5-0.8B), [2B](https://huggingface.co/Qwen/Qwen3.5-2B), [4B](https://huggingface.co/Qwen/Qwen3.5-4B); the application's exact artifacts are in [the catalog](../tools/assistant-models.lock.json). Selection here is empirical, rather than inferred from publisher benchmark tables.

## Games and ground truth

| Saved game | Indexed nodes | Relationships | Parsed/discovered scripts | Resolver | Import coverage |
| --- | ---: | ---: | ---: | --- | --- |
| Bangla Battlegrounds | 3,515 | 4,555 | 27/27 | 10 | Partial |
| Big Brain | 9,298 | 13,129 | 45/46 | 8 | Partial |
| Broken PVP | 73,305 | 80,322 | 163/163 | 10 | Partial |
| Photon | 509 | 665 | 13/13 | 10 | Complete saved-file import |

Original databases were opened read-only and backed up into ignored evaluation workspaces. The current parser was used against the saved evidence; games were not re-imported or executed. Big Brain is an older resolver/native-serialization snapshot and contains one missing/invalid script source. Three games have partial imports. Selected task endpoints, source IDs and directed relationships were nevertheless verified against canonical queries before scoring.

The generator verified **68 canonical queries** and **72 oracle routing checks**. Each model then had to locate the expected node/source, invoke the correct traversal with the correct node IDs, or preserve the source/destination of a supported path. Ambiguity, absent names and unsupported runtime requests have distinct expected outcomes. Snapshot scope and query budgets were checked on every response; neither was violated in the scored runs.

This is exact-name graph navigation across real projects, not a test of deep whole-game understanding. The local model sees the request and small navigation context, not the complete game. Deterministic graph tools retrieve facts. External foundation models remain the intended place for broad reasoning over exported graph/context or MCP.

## Repairs and post-fix evaluation

Two explicit word orders now use deterministic direction-preserving parsing:

- Caller queries such as “Identify the routines that rely on X” mean **Impact of X**, rather than X's own dependencies. List/show/find variants with routines/scripts/modules/components/nodes are supported.
- “Is destination reachable through the graph from source?” resolves **source → destination**, preserving the passive question's direction.

A regression test reproduced the error before the fix and passed afterwards, including a deliberately misleading model stub. Additional routing regressions now allow explicit lookup of objects named Runtime/FPS, and route “Where is the Export for AI button?” directly to maintained help without loading a model. The final focused assistant suite passed 31/31 tests. These requests no longer require model loading. The same 72 real-game questions were then rerun with the chosen 2B model: **72/72 passed**, with **40 deterministic requests and 32 model-backed requests**. Each game passed 18/18.

This final 72/72 is a known-case regression after repairing failures, not an unseen/general accuracy estimate. The original model comparison is preserved above. The later retest measured about 4.13 s median for its remaining warm model-backed requests. Desktop activity, caches and the mix of model-backed tasks differed; it is not an apples-to-apples timing comparison and does not establish a speed improvement for every query.

The local portable app retains 2B as its selected model with Auto backend. The verified 0.8B and 4B weights are also available locally for manual comparison; they remain excluded from Git and the release ZIP. Model descriptions now reflect the observed tradeoff.

## Where to export for another AI

After loading/selecting a game, click **Export for AI** in the top bar, next to **Import project**.

- **Game overview**: a bounded overview in the current Gameplay/Code mode, without the active class/depth filters. This is a compact starting point, not the whole game.
- **Current graph query**: the active overview, dependency, impact or trace query, including its query filters. Canvas-only label search/hidden nodes affect display and do not trim the export.
- **Selected node neighborhood**: focused retained evidence for a selected component, usually the most useful choice for a specific question.

Choose an estimated 2,000/4,000/8,000-token preparation budget, then **Download JSON** or **Download Markdown**. JSON keeps one graph representation with its exact pinned query; Markdown includes readable source evidence, coverage, unknowns, provenance and omissions. Estimates use characters/4, and compact JSON has a 32,000-byte cap. Real model tokenizers can differ.

For the complete retained snapshot, expand **Full snapshot graph (larger file)** and select **Download full graph JSON**. It returns the unchanged canonical graph from the selected analysis: both graph modes' retained nodes, relationships, evidence, sites, diagnostics and source records. It is independent of the selected compact scope, filters and token budget. It can exceed an AI model's context window and is not a copy of every original binary-place byte or a recorded runtime session.

For efficient reasoning, start with a focused compact pack plus your question; use a full graph or MCP when the external model needs broader structure. No universal token-saving percentage is claimed.

The export control and API are applied independently to **both active GitHub branches, main and chat_bot_RAG**. Main receives export functionality without the chatbot. Previously deleted upstream historical branches are not recreated.

## Reproduction and privacy

```powershell
node --import tsx scripts/assistant-multigame-cases.ts
node --import tsx scripts/assistant-model-comparison.ts
npm test
npm run typecheck
npm run test:e2e -- tests/e2e/context-export.spec.ts tests/e2e/assistant.spec.ts
```

The first script requires matching saved games/workspaces and writes private cases plus safe backup paths under build/. Its model-required flag follows the current router; after the two direction fixes, eight formerly model-backed questions are correctly classified as fast commands. The original baseline question strings and scoring records remain unchanged. The second requires the three verified installed models and an installed model selected beforehand, runs them sequentially, and restores the prior model/backend selection. Do not run it concurrently with another inference evaluation. Detailed private questions, model intents, responses and timings remain in ignored build/model-comparison/ and build/model-comparison-after/. Private labels, source, databases and model weights are not committed. Public aggregate data is in [assistant-model-comparison-results.json](assistant-model-comparison-results.json).

Export was tested through the actual browser downloads for compact JSON, Markdown and full snapshot JSON, including scope/filter provenance, exact byte counts, bounds/unknowns, pinning while another analysis is current, strict input, authentication/Origin checks and equality with the canonical full graph. The main-branch backport has its own independent state/mount and contains no chat dependency. Final branch/build/test outcomes are recorded with the delivery commit.

## Verification limits observed on this desktop

The initial full Vitest run completed 539/542 tests successfully. Two 30-second deadlines and one short UI-readiness wait failed under load. The notice and UI checks subsequently passed unchanged in an isolated run. The remaining unchanged 6,000-occurrence evidence stress case passed all assertions under a diagnostic 120-second allowance: ingestion took 38.07 s, impact retrieval 0.95 s and the two inspect pages 1.07 s; total test time was 44.03 s. Temporary profiling was removed and the original test deadline/assertions were restored. Thus the default full-run timing result is not represented as a clean pass.

Import-dependent browser setup also exceeded its 90-second Coverage wait on this desktop. Loaded-snapshot export is checked separately so unrelated ingestion timing does not stand in for export correctness. The browser tests of export itself use the public shop fixture; full large-game raw-download memory stress and a clean-machine installation remain unperformed. Main and chat export API/UI checks, build results and browser observations are reported separately.

Final feature verification: both branches passed typecheck and production build. Main passed all four scoped export UI/API tests. The loaded-snapshot browser check passed on main and chat_bot_RAG, downloading compact JSON, Markdown and full canonical JSON; chat also verified that the modal stays above an expanded assistant. The public aggregate JSON includes these verification outcomes.
