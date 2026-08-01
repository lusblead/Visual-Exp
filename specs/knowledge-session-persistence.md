# Knowledge session persistence

## Goal

Every accepted question becomes a local knowledge session. Reloading the page or
restarting the local application restores the latest valid session without
calling a model. Starting another question keeps the earlier session available.
Completed term and deep explanations are knowledge assets: hiding them or
changing focus does not delete them, and restoring them does not spend tokens.

## Session contract

The browser persists `visual-knowledge-session/1` records in a versioned
IndexedDB database. One record contains:

- a stable session ID, creation/update timestamps, and monotonically increasing
  revision;
- the accepted canonical `visual-explanation-document/2`;
- bounded exploration history and the current cursor;
- only completed term and deep explanation results, their stable content keys,
  and their opaque signed context tokens;
- ready explanation-card stacks, visible-card keys, and the active ready deep
  result when those references still resolve;
- the selected pre-generation profile;
- bounded generation receipts containing action, lane, model, duration and
  provider-reported token counts.

The archive keeps at most 12 sessions. Eviction is least-recently-updated and
never removes the active session in the transaction that saves it.

## Save behavior

- A hydration barrier prevents the bundled example document from being saved
  before restore completes.
- After the hydration barrier finishes, the compact knowledge-session control
  is available even when no accepted document exists. The user can choose the
  pre-generation profile for the next question and inspect any valid saved
  sessions without first submitting a new question. When the archive is empty,
  the same surface explicitly shows `暂无记录` rather than hiding the history
  section.
- Choosing a profile in an empty workspace changes only in-memory next-session
  policy. It creates no empty session, writes no IndexedDB record, starts no
  model request, and the first subsequently accepted document inherits it.
- JSON and Markdown export actions are absent until an accepted active session
  exists.
- Accepted document, navigation, ready cache, profile, or receipt changes create
  an immutable snapshot and enqueue one IndexedDB transaction.
- Writes are serialized per page and carry a revision. A stale delayed write
  cannot overwrite a newer revision.
- The session record and active-session pointer commit in one transaction.
- Creating a new root session changes the active pointer only after the new
  document passes the canonical contract. A failed create leaves the previous
  session and its caches intact.
- `pagehide` requests a final save of the latest immutable accepted snapshot.
- A quota, serialization, or transaction failure leaves the in-memory knowledge
  readable and exposes a non-blocking `未保存` state with an explicit retry.

## Restore behavior

1. Open the versioned database and read the active session, then remaining
   sessions from newest to oldest if the active record is corrupt.
2. Parse the complete document with `parseVisualDocument`; a shallow protocol
   check is insufficient.
3. Accept navigation only when it is non-empty, bounded to 60 entries, every
   entry exists in the document, and the cursor is valid. Otherwise recover at
   the document root.
4. Parse term and deep explanations with their protocol validators. Recompute
   stable content identities and drop any cache record whose document, node,
   parent, or key no longer matches.
5. Restore only ready/success results. Pending, loading, error, request epochs,
   failure sets, controllers, DOM references and text selections do not cross a
   reload.
6. Restore visible cards and active deep reading only when every referenced
   completed cache entry exists.
7. Rebind opaque context tokens to the validated explanation objects. A token
   is never trusted without server verification on the next recursive request.
8. Adopt the first valid record without provider access. A corrupt record is
   quarantined by deletion; it does not delete other sessions or block the
   blank composer.

## Context-token lifetime

The local launcher obtains one dedicated explanation-context signing secret
from Windows Credential Manager through the authenticated loopback companion.
The secret is generated once, remains server-only, and is independent of the
DeepSeek API Key and per-process companion bearer. This allows an unchanged
signed explanation pair to remain verifiable after an application restart.

Hosted or multi-instance deployments provide the same server-only secret
through deployment secret management. Browser storage contains only the opaque
`ect1` token paired with its exact validated explanation; exported files contain
neither the token nor the secret.

## Pre-generation profiles and budgets

The setting changes background preparation only. Foreground clicks and already
completed caches are never cancelled or deleted.

| User label | Internal value | Background scene calls per active frontier | Background term batches per active frontier |
| --- | --- | ---: | ---: |
| 省流 | `on_demand` | 0 | 0 |
| 平衡 | `balanced` | 1 | 1 |
| 深入 | `deep` | 5 | 4 |

- `balanced` is the default for a new installation.
- One term batch contains terms from one node and remains bounded by the
  existing maximum of eight terms.
- Every scene request still expands only one direct entrance; no profile may
  generate grandchildren of an unentered branch.
- The page being hidden, the frontier changing, the budget being exhausted, or
  switching to a lower profile cancels background controllers only.
- Budget consumption and accepted results survive reload through receipts and
  cache state, so a restored page cannot silently repeat the same background
  spend.

## Usage receipts

The DeepSeek adapter reads official non-streaming `usage` fields when supplied:
prompt, completion, total, prompt-cache-hit, and prompt-cache-miss tokens.
Unavailable counts are stored as `null`; character counts are never presented
as token counts.

Each bounded receipt records foreground/background lane, action, model,
duration, outcome, frontier key for background work, provider usage, and whether
a prepared result was later consumed. It contains no question, prompt, selected
text, response body, credential, URL authorization, or user identifier.

Receipts support these evaluation metrics:

- foreground and background request count;
- provider-reported input/output/cache token totals;
- restored-cache and prepared-hit count;
- prepared results never entered by the user;
- usable-result and prepared-hit latency.

## Export

- Full-fidelity export is `visual-knowledge-export/1` JSON containing the
  canonical document, valid navigation and completed explanation content. It
  omits runtime tasks, receipts' internal IDs, opaque context tokens and all
  credentials.
- Portable export is Markdown projected deterministically from canonical
  `childIds`: question, primary material where allowed, root orientation,
  ordered sections, relationships and completed explanations.
- Export is local-only, does not call a model, does not change document version
  or navigation, and revokes temporary Blob URLs after download.

## Security and data constraints

- No API Key, companion bearer, signing secret, environment variable, prompt,
  response body, cookie, account identifier, AbortController or DOM object may
  enter IndexedDB or an export.
- Session IDs, cache keys and strings are bounded; a persisted payload larger
  than 3.5 MiB is rejected before write.
- Only the current schema version is writable. Unknown future protocols fail
  closed and leave their record untouched for a newer client.
- Local persistence protects against accidental reload and ordinary UI
  navigation, not against another process running as the same operating-system
  user.

## Non-goals

- Cloud sync, collaboration, merge conflict resolution or multi-device history.
- Persisting unfinished provider jobs across a browser or application restart.
- Treating a locally restored explanation as independently sourced evidence.
- Unlimited session, explanation, receipt or pre-generation growth.
- Estimating billed tokens from text length when the provider does not report
  usage.
