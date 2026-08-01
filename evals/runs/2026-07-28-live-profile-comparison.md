# Live profile comparison — 2026-07-28

## Decision

The profile scheduler materially reduces background generation work, but it
does not reduce the latency of the initial visual answer. Its user-visible
benefit appears after the root has loaded: a prepared branch opens locally,
whereas an unprepared branch waits for another Pro request.

This report keeps three different measurements separate:

1. provider TTFT;
2. complete, validated visual-result latency;
3. prepared-hit local-render latency.

They are not interchangeable.

## Evaluation protocol

- Baseline commit: `636db946a42f820f530fb99caf7717ed2d53b997`
- Frozen dataset: `evals/datasets/token-latency-frozen.jsonl`
- Baseline matrix: 12 questions, four categories and three complexity levels
- Valid baseline attempts: 20
- Live selected replay: one medium question from each category
- Models: `deepseek-v4-pro` for create/expand and
  `deepseek-v4-flash` for term batches
- Token source: provider-reported `usage` only
- Missing usage: retained as unknown and never inferred from text length
- Retry rule: provider/product failures are retained; one evaluator
  infrastructure rerun is allowed and preserved as a separate artifact
- Initial create: generated once per sample and treated as the common cost for
  all four profile projections in that sample

Raw evidence:

- `evals/artifacts/profile-live-selected-2026-07-28.jsonl`
- `evals/artifacts/profile-live-infra-rerun-2026-07-28.jsonl`
- `evals/artifacts/baseline-matrix-636db946-raw-v3.json`
- `evals/artifacts/baseline-matrix-636db946-infra-rerun.json`

## Frozen-baseline projection

Seventeen baseline attempts completed `create → expand → define_batch`. Their
root frontiers exposed 184 old-mode background calls, or 10.82 calls per
accepted question on average.

| Profile | Background calls | Calls avoided | Call reduction |
| --- | ---: | ---: | ---: |
| Old full frontier | 184 | — | — |
| On demand | 0 | 184 | 100% |
| Balanced | 34 | 150 | 81.5% |
| Deep | 148 | 36 | 19.6% |

Projecting each accepted case with its first measured expansion and term-batch
usage, including the common initial create:

| Profile | Mean Token/question | Reduction vs old |
| --- | ---: | ---: |
| Old full frontier | 34,896 | — |
| On demand | 5,244 | 85.0% |
| Balanced | 10,767 | 69.1% |
| Deep | 30,522 | 12.5% |

This is a 17-case projection, not a claim about exact billing. Later old-mode
requests may contain a larger evolved document, so the selected live replay
below is the stronger evidence wherever both sides completed with known usage.

## Selected live replay

Two of the four selected roots completed. The technical-architecture and
humanities roots failed structured content validation after the product's one
repair attempt, so their profiles were not run. These failures remain part of
the result.

No selected sample produced known provider usage for all four profiles. The
following aggregates therefore describe only exact completed rows and must not
be compared as if they were a paired experiment:

| Profile | Exact rows | Mean total Token | Mean calls | Mean elapsed | Mean first prepared |
| --- | ---: | ---: | ---: | ---: | ---: |
| Old full frontier | 1 | 40,720 | 12 | 171.718 s | 19.009 s |
| On demand | 4 | 4,204 | 1 | 33.333 s | n/a |
| Balanced | 2 | 10,674 | 3 | 65.651 s | 24.339 s |
| Deep | 3 | 31,463 | 10 | 180.421 s | 27.254 s |

The original mechanism sample is the only exact pair with the same shared root
and a complete old-mode result:

| Same-root comparison | Total Token | Calls | Reduction vs old |
| --- | ---: | ---: | ---: |
| Old full frontier | 40,720 | 12 | — |
| On demand | 4,094 | 1 | 89.9% Token |
| Deep | 31,251 | 10 | 23.3% Token |

The balanced row for that sample had one network call with missing usage, so it
is correctly excluded from the exact Token comparison.

## Latency boundaries

One unchanged streaming probe measured:

| Model | Provider TTFT |
| --- | ---: |
| DeepSeek V4 Pro | 828 ms |
| DeepSeek V4 Flash | 577 ms |

The scheduler starts after the root document has been assembled and validated.
Therefore its measured reduction is:

- provider TTFT: `0 ms`;
- initial visual-answer latency: `0 ms`;
- baseline initial visual-answer p50: `31.152 s`;
- baseline on-demand expansion p50: `20.058 s`.

In a deterministic browser run at `http://localhost:3000/`, Balanced restored a
saved document, prepared the active frontier, and opened two successive prepared
scenes in `279 ms` and `295 ms` end to end through the browser automation
boundary. Refresh restored the same depth and heading; the receipt count stayed
at four calls, three of them background calls. This is prepared-hit
local-render evidence, not TTFT.

A fresh deterministic session also restored a two-level term explanation after
refresh with the call receipt unchanged at four calls. An older session created
by a previous plain `npm run dev` process produced an invalid parent-context
token, as expected from that command's process-local development signing
fallback. The supported local product path is `npm run dev:local`, whose
companion supplies a stable signing secret from Windows Credential Manager.

## Reliability and interpretation

- Baseline protocol acceptance was `17/20` (85%). By category it was 60%
  technical architecture, 100% mechanism/process, 80% humanities, and 100%
  comparative decision.
- The selected live replay accepted only two of four roots. Several later
  profile calls also returned product-structure failures or local network
  failures.
- JSON mode improves syntactic framing but does not guarantee the semantic
  schema, child shape, content depth, or math-policy constraints.
- The current evidence supports the cost-control mechanism and persistence
  behavior. It does not support a production-readiness claim for model
  reliability or answer quality.

## Release-gate conclusion

**PASS** for deterministic profile budgets, usage accounting, persistence,
export safety, and prepared-hit behavior.

**NOT YET PASS** for production reliability. The next gate should raise
structured root and expansion acceptance on the frozen multi-category dataset
and add a calibrated semantic-quality judge without weakening the existing
schema and source-safety checks.
