# Evaluation plan

## System map

This repository is an LLM-assisted visual explanation application. Its
generation boundary calls DeepSeek through the local/server adapter, while
deterministic client policy selects background work and persists bounded usage
receipts.

The token-economy component evaluation covers the deterministic boundary:

```text
active semantic frontier
  -> pre-generation profile and persisted receipts
  -> bounded scene/term request plan

provider response usage
  -> durable receipt identity
  -> exact reported-token totals plus explicit unknown counts
```

It does not grade generated-content quality or perform an end-to-end model
request. Model quality, real latency, and real billing distributions require a
separate credentialed evaluation.

## Live comparison decision

The credentialed comparison answers a narrower product decision:

> Do the three pre-generation profiles reduce issued root-frontier work and
> provider-reported Token usage relative to the previous unbounded loading
> mode, without being misreported as an improvement to initial model TTFT?

The evaluation unit is one question with one common accepted `create`, followed
by an independently replayed root-frontier schedule. The baseline is commit
`636db946a42f820f530fb99caf7717ed2d53b997`; the candidate changes scheduling,
persistence, and accounting while retaining the same Pro/Flash action routing.

The frozen dataset is `datasets/token-latency-frozen.jsonl`: 12 questions across
technical architecture, mechanism/process, humanities knowledge, and
comparative decision, with low/medium/high complexity. Four representative
medium cases use three attempts in the baseline matrix. Provider/product
failures are not retried. Evaluator infrastructure failures may be retried once
and remain visible in the raw artifact.

Live observations record:

- complete validated JSON latency for `create`, `expand`, and `define_batch`;
- provider-reported prompt, completion, total, cache-hit, and cache-miss Tokens;
- protocol acceptance or the safe failure stage;
- direct-frontier scene/term call counts;
- initial-result latency separately from prepared-entry readiness and local
  cached rendering.

The comparison must not infer Tokens from characters. Missing provider usage is
`null`. Structured routes do not expose a user-visible first token, so provider
stream TTFT is a component diagnostic, not the time at which the visual answer
becomes readable.

### Gates fixed before the profile run

| Gate | Requirement |
| --- | --- |
| On demand | Zero background scene and term calls |
| Balanced | At most 1 scene plus 1 term batch per semantic frontier |
| Deep | At most 5 scenes plus 4 term batches per semantic frontier |
| Old baseline | Every eligible direct scene and root/direct-child term batch |
| Common create | Identical profile-independent cost; reported separately |
| Initial TTFT claim | No reduction may be claimed from a scheduler change |
| Savings | Provider usage only; call and Token savings both reported |
| Reliability | Product failures and infrastructure failures remain separate |
| Evidence | Raw case-level artifacts retained; aggregate alone is insufficient |

## Evidence contract

| Evidence class | Current gate |
| --- | --- |
| Outcome | Exact selected scene and term candidate IDs |
| Process | Exact per-frontier limits, consumption, remaining budget, and receipt-ID deduplication |
| Safety | No network request or API key; no character-based token estimate |
| Efficiency | Provider-reported fields are summed once; missing fields remain explicitly unknown |

All token-economy cases are critical and require a 100% pass rate. Cases are
frozen in `token-economy/cases.json`, use seed `20260728`, and are graded by
deterministic equality checks in `token-economy/run.mjs`.

## Commands

```bash
npm run eval:token-economy
npm run harness:token-economy
```
