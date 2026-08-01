# Token economy evaluation

This deterministic component evaluation is the release gate for background
generation budgets and provider-token accounting.

## Evaluated unit

- `lib/prefetch-policy.mjs`: selects one active frontier's bounded scene and
  term preparation work.
- `lib/usage-receipt-metrics.mjs`: deduplicates durable request receipts and
  aggregates only provider-reported usage.

The suite does not evaluate model answer quality. It performs no network
request, needs no API key, uses seed `20260728`, and runs the frozen cases in
`cases.json` once each.

## Gates

All cases are critical and must pass:

- `on_demand` selects `0` scene requests and `0` term batches;
- `balanced` selects at most `1` scene request and `1` term batch;
- `deep` selects at most `5` scene requests and `4` term batches;
- a replayed `receipt.id` consumes budget and usage exactly once;
- issued requests consume budget regardless of accepted, failed, aborted, or
  discarded outcome;
- exhausted budgets select no additional work;
- numeric provider usage is summed exactly;
- missing provider usage remains `null`/unknown and is never inferred from
  character counts.

## Run

```bash
npm run eval:token-economy
npm run harness:token-economy
```

## Live same-question comparison

`live-compare.mjs` measures a running Visualized-Exp server without reading,
accepting, or printing an API key. The server URL must be supplied explicitly
through `VISUALIZED_EXP_WEB_URL`; credential configuration remains entirely
inside the already-running application and companion.

The input is JSONL. Each non-empty line needs a stable `id`, a `question`, and
an optional `repeat_count` from 1 to 10:

```jsonl
{"id":"arch-medium-01","question":"设计一个可递归探索的 AI 知识应用架构。","repeat_count":3}
{"id":"mechanism-medium-01","question":"Transformer 的自注意力机制如何工作？"}
```

Run all cases or select exact IDs:

```powershell
$env:VISUALIZED_EXP_WEB_URL = "http://localhost:3000"

node --experimental-strip-types evals/token-economy/live-compare.mjs `
  --dataset .\path\to\frozen-questions.jsonl `
  --output .\live-comparison.jsonl

node --experimental-strip-types evals/token-economy/live-compare.mjs `
  --dataset .\path\to\frozen-questions.jsonl `
  --case-ids arch-medium-01,mechanism-medium-01 `
  --output .\selected-comparison.jsonl
```

For each case sample the tool performs one shared `create`, validates the root
document, and then clones that exact document into four independent branches:

| Profile | Direct scene expansions | Root/direct-child term batches |
| --- | ---: | ---: |
| `old_full` | all eligible | all eligible |
| `on_demand` | 0 | 0 |
| `balanced` | 1 | 1 |
| `deep` | at most 5 | at most 4 |

Scene order comes from `buildScenePrefetchQueue`. After that branch's scene
requests finish, term-batch order comes from `buildTermPrefetchBatches` with
only the root and its direct children included. A failed request is recorded
and the next originally selected candidate may still be measured; branches
never reuse another profile's expanded document or definition result.
Every request belonging to the same sample reuses one opaque `sessionId`, as
the browser does within one tab. A new sample receives a new ID.

Output is JSONL metadata only. It contains the case ID, sample index, profile,
action/status, HTTP status, complete usable-result latency, provider/model
labels, and the official provider `usage` events. It never contains the
question, generated document or explanation, request body, server URL, or a
secret.

When `--output` is used, the destination must not already exist. The runner
creates it exclusively before the first request, appends `shared_create`
immediately after that call completes, and appends each profile record
immediately after that profile completes. It never rereads or rewrites earlier
records. If a run is interrupted, completed records remain available while the
currently in-flight profile has no record. Use a new output path to resume or
repeat a run.

The shared `create` is emitted once as profile `shared_create`. Every profile
summary then reports:

- incremental calls and usage after the shared root;
- total cost including that same shared `create`;
- call and token savings relative to incremental `old_full`;
- `firstPreparedMs`, defined as the production scheduler's 250 ms first-scene
  delay plus that first scene request's complete usable-result latency.

The runner does not sleep for the simulated 250 ms; it adds the fixed scheduler
delay to the measured request. `firstPreparedMs` is `null` when no scene request
is scheduled or its first scene request fails. Token savings are also `null`
whenever either side lacks official `totalTokens`; text length is never used as
an estimate.

This command makes real provider requests: one shared create plus every call in
all four comparison branches for every repetition. Use a small selected subset
before running the complete frozen suite.
