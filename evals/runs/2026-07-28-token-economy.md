# Token economy baseline — 2026-07-28

## Configuration

- Candidate: current uncommitted working tree
- Suite protocol: `visual-token-economy-eval/1`
- Seed: `20260728`
- Samples per case: 1
- External model/API calls: 0
- Credentials required: none

## Commands run

```text
npm run eval:token-economy
npm run harness:token-economy
git diff --check -- lib/prefetch-policy.mjs lib/usage-receipt-metrics.mjs tests/prefetch-policy.test.mjs evals/token-economy harness/token-economy.mjs harness/acceptance-checklist.md package.json
```

## Measured result

| Category | Passed | Total | Critical failures |
| --- | ---: | ---: | ---: |
| Profile budget | 3 | 3 | 0 |
| Receipt integrity | 1 | 1 | 0 |
| Budget exhaustion | 1 | 1 | 0 |
| Usage accounting | 2 | 2 | 0 |
| **Total** | **7** | **7** | **0** |

The dedicated policy regression suite also passed `8/8`; the token-economy
harness passed. `git diff --check` found no whitespace errors in the scoped
files.

## Release-gate result

**PASS for the deterministic token-economy component gate.**

- `on_demand`, `balanced`, and `deep` select exactly their declared hard
  budgets.
- Replayed receipt IDs do not double-spend budget or inflate usage.
- Issued failed, aborted, and discarded requests consume budget just like
  accepted requests.
- Exhausted frontiers schedule no more background work.
- Only provider-reported numeric usage contributes to totals; missing usage
  remains unknown despite adversarial character-count inputs.

## Limitations

- This is a component evaluation, not evidence of lower real DeepSeek billing.
- It does not call a provider, measure TTFT, score explanation quality, or
  measure cache-hit behavior in a browser session.
- Full repository build, typecheck, lint, browser acceptance, and the main
  harness are owned by the enclosing implementation run and were not executed
  by this focused baseline.
