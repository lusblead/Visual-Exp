# Live Token and latency baseline — 2026-07-28

## Decision and evaluated configuration

This run freezes the previous loading behavior before comparing the new
pre-generation profiles.

- Baseline commit: `636db946a42f820f530fb99caf7717ed2d53b997`
- Scene model: `deepseek-v4-pro`
- Term model: `deepseek-v4-flash`
- Runtime: Windows, Node `v24.11.1`, npm `11.6.2`, .NET SDK `10.0.302`
- Dataset: `evals/datasets/token-latency-frozen.jsonl`
- Cases: 12 questions; 4 categories × low/medium/high complexity
- Attempts: 20; the four representative medium cases have 3 attempts
- Product retry policy: unchanged baseline provider retry plus one content repair
- Evaluator retry policy: provider/product failures are not retried; four
  evaluator infrastructure failures were retried once and retained in the raw
  artifacts

The isolated baseline received one observational patch that forwards DeepSeek's
official `usage` metadata to the evaluator. It did not change prompts, model
IDs, request limits, scheduling, parsing, retries, repair, or document
assembly. The production working tree was not checked out or reset.

Raw evidence:

- `evals/artifacts/baseline-636db946-run-001.json`
- `evals/artifacts/baseline-matrix-636db946-raw-v3.json`
- `evals/artifacts/baseline-matrix-636db946-infra-rerun.json`

The earlier partial `raw` and `raw-v2` artifacts are retained as evaluator
diagnostics; they are not included in the valid sample set.

## Outcome and reliability

Four initial attempts returned an invalid local HTTP response or connection
reset and all four passed their single infrastructure rerun. After replacement,
the frozen set contains 20 valid attempts:

| Result | Attempts | Rate |
| --- | ---: | ---: |
| Complete `create → expand → define_batch` accepted | 17 | 85% |
| Product/provider structured response rejected | 3 | 15% |

The three product failures were one create in a technical-architecture case,
one create in a humanities case, and one expansion in a
technical-architecture case. They remain failures even though a stochastic
rerun might succeed.

| Category | Accepted | Valid attempts | Rate |
| --- | ---: | ---: | ---: |
| Technical architecture | 3 | 5 | 60% |
| Mechanism/process | 5 | 5 | 100% |
| Humanities knowledge | 4 | 5 | 80% |
| Comparative decision | 5 | 5 | 100% |

These rates measure protocol acceptance, not semantic answer quality.

## Accepted-action efficiency

All Token values below are provider-reported. They are not inferred from text
length.

| Action | n | Latency mean | Latency p50 | Latency p95 | Token mean | Token p50 | Token p95 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Initial create | 17 | 33.122 s | 31.152 s | 63.168 s | 5,244 | 4,182 | 10,918 |
| One scene expansion | 17 | 23.910 s | 20.058 s | 54.222 s | 3,875 | 3,873 | 4,495 |
| One term batch | 17 | 2.621 s | 2.618 s | 4.339 s | 1,649 | 1,615 | 2,505 |

Across the 17 accepted attempts, the initial root exposed 7–13 eligible old-mode
background calls, with mean 10.82 and median 11. This is a steady-frontier
minimum: the old React effects could additionally spend work that was later
aborted when successive scene expansions changed the document.

The measured call-budget comparison over those 17 frontiers is:

| Profile | Old calls | Profile calls | Calls avoided | Aggregate reduction |
| --- | ---: | ---: | ---: | ---: |
| On demand | 184 | 0 | 184 | 100% |
| Balanced | 184 | 34 | 150 | 81.5% |
| Deep | 184 | 148 | 36 | 19.6% |

Using each case's first measured expansion and term-batch usage as a
single-action projection gives the following preliminary total, including the
common create:

| Profile | Projected mean Token/question | Reduction vs old |
| --- | ---: | ---: |
| Old full frontier | 34,896 | — |
| On demand | 5,244 | 85.0% |
| Balanced | 10,767 | 69.1% |
| Deep | 30,522 | 12.5% |

This table is explicitly a projection because later old-mode calls contain a
larger evolved document and different term batches. The profile replay run
measures selected representative questions directly and supersedes the
projection where both are available.

## First-token and usable-result boundary

One unchanged short streaming probe measured provider TTFT at 828 ms for Pro
and 577 ms for Flash. The profile scheduler cannot improve these numbers.

The visual application does not expose partial JSON. Its initial readable
answer appears only after the full candidate is received, assembled, and
validated, whose measured p50 is 31.152 seconds. Therefore:

- provider TTFT reduction from the profile change: `0 ms` by design;
- initial visual-answer latency reduction from the profile change: `0 ms` by
  design;
- a prepared next scene may remove a later click wait, but that must be reported
  as prepared-hit/local-render latency, not TTFT.

## Limitations

- The 20 attempts are enough to expose large effects and report empirical
  p50/p95, but not a narrow confidence interval for every category.
- Product failures spent provider work. Usage was not exposed by the original
  error response in those three attempts, so failed-call Tokens remain unknown
  rather than being estimated.
- DeepSeek service latency and cache behavior vary over time.
- The suite checks protocol acceptance and efficiency. It does not yet grade
  the required semantic layers with a calibrated human or model judge.
