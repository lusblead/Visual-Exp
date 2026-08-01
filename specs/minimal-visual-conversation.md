# Minimal visual conversation

## Goal

The default experience turns a long AI answer into a readable knowledge path: orient the reader first, present the current layer in a deliberate top-to-bottom order, and let the reader deepen only the parts they care about. It must feel like an explanation with depth, not a category dashboard, mind map, diagram editor, or collection of cards.

## Functional behavior

### First entry

- Before the first request, the page shows one centered composer and the visible
  prompt `请输入你的问题` as the primary interaction. After local hydration, one
  compact secondary control remains available for choosing the next question's
  pre-generation profile and opening saved knowledge; it does not require a
  first submission.
- Submitting a non-empty question immediately moves the composer into a compact top position and shows a focused loading state.
- A successful create response resets exploration history to the returned root node and reveals only the current scene.
- A failed first request returns the composer to its usable state and shows a compact error. A failed replacement request preserves the previous accepted document.

### Linear explanatory reading

- Every scene is projected as one vertical knowledge spine in normal document flow. The default renderer does not arrange entrances as a dashboard grid, radial map, or disconnected card collection.
- The current scene starts with a restrained title followed by a visually dominant direct answer. Its detail then explains, in this order where applicable: background or problem, purpose or role, mechanism, and limits or next questions.
- The explanation may contain multiple paragraphs. Paragraphs remain readable at normal body size and are never visually demoted beneath the scene title.
- Direct children follow as ordered, full-width explanatory sections. Each entrance states what it is and why it belongs at this point before the reader enters it.
- Each entrance has one unambiguous enter affordance. Activating its ordinary prose or enter affordance opens that scene; activating an annotated term explains the term without navigating.
- Math policy has three states. Explicit “no formula” language forbids notation; explicit requests allow mathematical treatment; the default `optional` mode permits at most one compact formula only when it removes real ambiguity, and the following prose must explain every symbol in plain language.
- The renderer uses open, auto-sizing layout. Text wraps normally; no fixed border, line clamp, absolute radial position, or oversized heading may push explanatory prose outside the readable hierarchy.
- AI may retain a semantic `view` hint for future projections, but the MVP default projection remains the linear knowledge spine and exposes no view selector.

### Primary material before interpretation

- When the question asks about an identifiable poem, passage, statute, code sample, or other primary object, the root reading flow shows the trusted object before the model's interpretation.
- Complete text is accepted only when it was supplied by the user, verified as public-domain, or supplied under an explicit license. Protected material is limited to a bounded necessary excerpt.
- If no verifiable body is available, the page states the limitation and may link to the identified source. It never asks the language model to reconstruct “the original” from memory.
- The primary-material contract contains provenance and content only. It contains no layout, HTML, SVG, CSS, or component instructions.

### Renderer-owned semantic diagrams

- Architecture, process, comparison, timeline, and explicit sibling relations may receive one quiet semantic overview before their complete linear sections.
- The overview is derived only from canonical ordered child IDs, child nodes, relations, and `view`; it never evaluates model-authored Mermaid, HTML, SVG, coordinates, styles, or component names.
- A diagram is auxiliary navigation, not the answer. It cannot replace or visually outweigh the direct answer and explanatory body.
- When fewer than two visible nodes exist, or a `grid` scene has no explicit relation, the renderer emits no diagram rather than inventing an edge.

### Budgeted one-layer-ahead scene pre-generation

- Background preparation follows the persisted `省流 | 平衡 | 深入` profile
  defined in `knowledge-session-persistence.md`.
- `省流` sends no background Pro expansion and no background Flash definition.
  Every uncached result is generated only after an explicit user action.
- `平衡` prepares at most one direct entrance and one one-node term batch for
  each active semantic frontier. `深入` raises those hard limits to five direct
  entrances and four one-node term batches.
- Background scene expansion remains sequential because each accepted expansion
  advances the canonical document version.
- The client sends each background expansion with the latest accepted document. It adopts a response only when the response still matches that request's base version and the current document is still authoritative.
- Entering an entrance whose children have already been prepared performs no model request and shows the next scene immediately.
- Entering an entrance whose preparation is incomplete gives the foreground action priority. Background scene work is cancelled, and the selected entrance is expanded using the latest accepted document.
- Pre-generation stops at one semantic frontier: while scene A is active, the client may prepare A's direct children, but it does not prepare their children until one of them becomes active.
- Lowering the profile cancels background work only. It does not cancel
  foreground work or delete accepted documents and completed caches.
- Terminal nodes, already expanded nodes, failed content identities, depth-12 nodes, and documents without capacity for at least three children are skipped.
- Changing the question, exhausting the frontier budget, hiding the page, or
  unmounting the experience cancels background scene work. Background failure
  never replaces the foreground error or discards accepted knowledge.

### History

- The only persistent navigation controls are `‹` and `›`.
- History is `{entries, cursor}` over scene node IDs.
- Entering a node after moving backward truncates the forward branch before appending the new node.
- Backward and forward navigation never mutate the semantic document or call a model.
- A new successful question resets history to the new root.
- The current question, canonical document, bounded history, completed
  explanations and profile are saved as one local knowledge session. The latest
  valid session restores before background work and without a provider request;
  a successful new question keeps older sessions available.

### Contextual term explanation

- Each semantic node carries a bounded `terms` allowlist generated with its content. Terms are exact, boundary-safe visible spans such as `Agent`, `RAG`, `残差连接`, `ReLU`, or `Dropout`. ASCII terms require word boundaries and longer terms win overlaps. A one-character Han term must occupy an explicitly delimited semantic position; it cannot be cut out of an ordinary compound such as marking `键` inside `关键`, `主键`, or `键值`.
- The renderer annotates occurrences in titles, summaries, and details. A single activation requests or opens the short contextual explanation and stops scene navigation.
- Short definition results use `visual-term-explanation/2` and contain a definition, relevance to the current passage, and zero to four nested annotated terms that occur in the returned explanation.
- Every base term owns a stable task/card identity. Several cards may remain visible together in one top-aligned explanation rail; each card has its own bounded nested stack and close action.
- Closing a card changes only its visible key. It does not abort a pending request or delete a ready result. Reactivating the same pending or ready identity restores it without another provider request.
- Nested annotated terms inside a definition can be activated in the same way. Only that originating card's stack changes, so the reader does not lose sibling definitions.
- A nested-definition request includes the validated parent explanation. The server accepts the nested term only when it is listed in the parent's `terms` allowlist and literally occurs in the parent definition or relevance.
- Every returned short or deep explanation is accompanied by an opaque server
  HMAC context token. The exact validated explanation and token may be saved in
  a private local knowledge session so a completed cache survives reload. The
  signing secret remains server-only in Windows Credential Manager (or
  deployment secret management), and export always removes tokens. Nested
  define and dive requests must return the exact explanation plus its token;
  verification binds the explanation to the document ID, source node,
  source-node content fingerprint, protocol, and complete explanation fields.
  Missing, altered, cross-document, or cross-node contexts are rejected before
  provider access.
- Recursive definition depth is capped at four. The UI retains the current explanation at the cap and offers the stronger deep-explanation path instead of continuing an unbounded chain.
- `deepseek-v4-flash` produces short definitions. Definitions never mutate the semantic document, document version, or route history.

### Current-layer term preparation

- Subject to the selected profile and its remaining frontier budget, the client
  prepares short definitions in the active scene followed by visible direct
  entrances.
- Preparation is batched by semantic node: one Flash request returns definitions for that node's still-uncached annotations. Batches run sequentially with the active scene first, then visible entrances in reading order; within a node, higher literal frequency first and original term order breaks ties.
- There is no arbitrary six-term wave limit. The provider workload remains bounded by at most eight annotations in one node batch, the maximum direct-child count, the one-layer frontier, cancellation, cache identity, and one concurrent Flash batch.
- A user term activation has priority over background definition work. Cached results open immediately; an uncached activation cancels the background batch and starts a foreground single-term request.
- Definition cache identity includes document ID, node ID, normalized term, and a stable fingerprint of the source text. Nested-definition identity also includes a stable fingerprint of the parent explanation.
- Expanding an unrelated branch preserves unchanged definitions. Changing source content invalidates only affected identities.
- A failed background definition is non-blocking and cannot navigate, mutate the document, or open model settings.
- A restored ready definition is a cache hit and sends no provider request.

### Deep explanation of selected knowledge

- Double-activating an annotated term requests a deeper explanation using `deepseek-v4-pro`. Single activation remains the fast Flash definition.
- Selecting a bounded sentence or paragraph reveals a small contextual `深入` action. Nothing is sent merely because text was selected; the request starts only after the user activates that action.
- The same `深入` action is available from the short-definition surface for keyboard and touch users. Double activation is never the only path.
- A deep request may target literal text in the current scene or literal text in a validated term explanation belonging to that scene. Arbitrary client-provided text is rejected.
- Deep results use `visual-deep-explanation/1` and explain: the direct meaning, why the concept appears in this context, relevant background, how it works, and practical boundaries. They may annotate zero to eight nested terms.
- A term annotated inside a deep result remains interactive: single activation uses Flash with the signed deep result as parent context; double activation or the explicit deep action uses Pro with the same signed context.
- Deep explanations appear as a full-width reading section in the current vertical flow, not as another small card. They do not mutate the semantic document, document version, or route history.
- Deep tasks use a stable identity derived from the document, source-node content, literal selection, and complete signed parent explanation. Switching from A to B never aborts A; returning to a pending or ready A restores its task without another provider request.
- The Pro prompt remains beginner-first and follows the same `avoid | optional | requested` math policy as its source question and selected text.

### Model settings

- The settings surface presents one DeepSeek V4 credential: `deepseek-v4-pro` creates, expands, and deeply explains; `deepseek-v4-flash` supplies short term definitions. The default interface does not expose provider, base URL, temperature, or reasoning controls.
- A compact settings control is part of the composer, not a third navigation system.
- In local mode, entering a Key sends it once to the same-origin settings API. The browser clears the input after the request and never stores the Key in localStorage, sessionStorage, IndexedDB, the semantic document, history, logs, or a client-readable response.
- The settings API delegates persistence and DeepSeek requests to an authenticated loopback companion. The Windows implementation stores the credential in the current user's Windows Credential Manager and keeps it across page reloads, app restarts, and Windows sign-in sessions until the user explicitly deletes or replaces it.
- Hosted mode continues to use runtime secrets and rejects attempts to persist a browser-supplied Key when no authenticated local companion is present.
- Saving a replacement is verify-before-write: an invalid Key must not destroy the last configured credential.

### Structured generation and prompt policy

- DeepSeek produces action-specific semantic drafts rather than canonical visual documents or operation envelopes.
- Local deterministic adapters own protocol/version fields, document and node IDs, parent and child links, depth, document version, evidence arrays, expansion state, relation endpoint IDs, and nullable operation fields.
- Create and expand prompts first require an orienting explanation, then ordered direct entrances. Every entrance must explain both its meaning and its role in the parent topic.
- Prompts assume the reader may not know the first technical noun. They prefer plain-language causality over unexplained labels, categories, or formulas.
- Established technical components retain a bilingual first occurrence when it improves recognition and searchability, for example `Encoder（编码器）` and `Decoder（解码器）`. The complete bilingual phrase is one term annotation; the model must not split it into two competing controls or mechanically translate ordinary Chinese nouns.
- Every JSON-mode prompt includes a small complete JSON example and its action-specific draft schema. The provider is never asked to author the larger canonical graph contract.
- JSON-mode requests also follow DeepSeek's documented transport boundary:
  `response_format.type=json_object`, the literal word JSON plus a complete
  output example in the prompt, an action-bounded `max_tokens`, and distinct
  classification of empty content, truncation, JSON syntax and business-Schema
  failure. Reference: [DeepSeek JSON Output guide](https://api-docs.deepseek.com/zh-cn/guides/json_mode).
- Draft terms are annotations rather than graph integrity. The adapter trims, normalized-deduplicates, bounds, and drops terms that do not occur at the same renderable boundary used by `AnnotatedText`.
- In short single/batch definitions, malformed, ancestral, duplicate, non-literal, or excess nested-term candidates are independently dropped in stable order. A bad optional annotation cannot discard an otherwise valid definition and relevance; those prose fields, source state, signed parent context, recursion depth, and math preference remain hard validation boundaries.
- Structured tasks use non-thinking JSON mode. Provider transport retry and content repair have separate one-retry budgets. Repair receives a safe category plus category-specific instructions; relation/self-edge, source, math-preference, term, and content failures are classified before generic child-shape failures. Every repair also repeats a cross-category invariant: fixing the named error must not relax the original Schema, count, source, or math mode. For example, a child-shape repair cannot introduce an unsolicited ReLU formula. A second invalid candidate fails closed and never silently falls back to demo.
- Server diagnostics may record action, attempt kind, duration, finish reason, response length, and stable validation category. They never record API keys, authorization headers, full prompts, original questions, selected prose, or model response bodies.

### Latency observability

- Provider first-token latency and user-visible usable-result latency are distinct metrics. JSON scene generation cannot be shown as accepted knowledge until the full candidate is assembled and validated.
- Diagnostics may measure upstream first content token and complete `create`, foreground `expand`, background `expand`, `define`, and `dive` durations.
- A pre-generated scene or definition reports cache-hit or prepared-hit latency separately; it must not be described as improving provider TTFT.
- Diagnostic output is bounded metadata only and contains no credentials, prompt, question, selected text, response text, or generated semantic content.
- When the provider supplies token usage, receipts preserve prompt,
  completion, total, prompt-cache-hit and prompt-cache-miss counts. Missing
  usage remains `null`; text length is not relabelled as tokens. Receipts
  distinguish foreground from background work and prepared results that were
  actually entered.

## Data constraints

- Question: 1–1,200 trimmed characters.
- Node summary: a non-empty direct answer of 8–220 characters.
- Node detail: 24–1,200 characters of explanatory prose, optionally separated by blank lines, and not a repetition of the summary or navigation filler.
- Terms per node: 0–8 unique, single-line strings of 1–40 characters; every term must occur in visible node text.
- DeepSeek draft children: create returns 3–6 children; expand returns 3–5 children, bounded by the remaining 80-node document capacity.
- Definition term: 1–40 trimmed characters and equal, case-insensitively for Latin text, to an allowed annotation. One-character Han annotations require punctuation/whitespace on both sides, or one such hard boundary plus a bounded grammatical connector on the other side.
- Short definition and relevance: non-empty bounded strings; accepted nested terms: the first 0–4 distinct, non-ancestral, boundary-safe visible substrings after local sanitation.
- Deep selection: 1–600 trimmed characters and a literal substring of the selected semantic node or validated term explanation.
- Deep result fields are non-empty bounded prose; nested terms: 0–8 exact visible substrings.
- Primary material: `complete | excerpt | unavailable`; a complete body is at most 20,000 Unicode characters and requires user-supplied, verified-public-domain, or licensed provenance; an excerpt is at most 600 characters; unavailable material has no body and requires an omission reason.
- Math mode: `avoid | optional | requested`; optional generated content contains no more than one compact formula-like expression and must explain it in adjacent plain prose.
- Generated explanation protocols contain no coordinates, CSS, component names, URLs, or unsupported evidence claims.
- Explanation context token: opaque `ect1` HMAC, server-issued, allowed only in
  the private local session store beside its exact validated explanation, and
  never accepted without that explanation and current source node. It is never
  included in JSON or Markdown export.
- API keys never appear in a client-readable response, browser storage, repository file, URL, log, or any `NEXT_PUBLIC_*` variable.

## Error and concurrency behavior

- Foreground create and expand requests are serialized and own the document request epoch.
- Background scene pre-generation is sequential, profile-budgeted,
  version-checked, cancellable, and lower priority than foreground entry.
- Short definition batches, foreground definitions, and deep explanations use independent keyed request identities, loading states, caches, and abort controllers.
- Model-setting requests have independent saving and failure state. Failed verification leaves the previous credential unchanged.
- Older or cancelled responses cannot overwrite a newer document, reopen a hidden card, replace another card's stack, or insert a deep result for a different selection.
- Hiding a card, returning within its recursive stack, or focusing another deep selection does not cancel the owning task. A late response may settle only its own key and remains hidden unless that key is visible again.
- Browser cancellation propagates through the API route to the provider fetch. A caller-aborted request does not enter provider retry or content repair.
- Errors never discard the last valid document or route history.
- Restore completes before autosave or pre-generation. A corrupt session falls
  back to another valid session or the blank composer; a storage failure leaves
  the accepted in-memory document readable.
- A depth-12 node is terminal. Expansion that cannot add at least three children without exceeding 80 nodes is rejected before provider access.
- `length` and invalid or empty content enter the bounded repair path; insufficient resources, network failures, 429, and retryable 5xx enter provider retry; authentication, balance, invalid parameters, and content filtering do not retry automatically.
- Background failures remain bounded diagnostic state and never replace a foreground error.

## Accessibility

- Icon-only controls have Chinese accessible names.
- Focus states are visible and all hit targets are at least 44 CSS pixels on touch layouts.
- Term controls expose single-activation and deep-explanation actions to keyboard and touch users.
- The explanation rail is one named complementary region containing independently labelled article cards; it does not claim modal dialog semantics or trap the rest of the interface. Every card has accessible close and, when nested, back actions.
- The inline deep-reading section receives focus when requested and exposes a close action without stealing route history.
- The selection action is positioned near the selected range where possible and has a stable keyboard-accessible fallback.
- The credential settings surface is modal, restores focus to its trigger, and keeps save, delete, show/hide, and error states keyboard accessible.
- Reduced-motion preferences suppress movement and emergence animations.

## Non-goals

- Generating an entire future knowledge graph before the reader chooses a branch.
- Free-form canvas editing or AI control of pixels, coordinates, CSS, or React components.
- Manual projection selection in the default interface.
- Making every noun clickable; only bounded, model-annotated terms are interactive.
- Automatically deep-explaining every nested term; nested terms remain on demand to avoid unbounded provider work.
- Browser-extension DOM capture in this local MVP.
- Browser-persisted or repository-persisted API keys.
- Cross-platform credential vault implementations beyond the Windows local companion.
- Cloud-synchronized history, collaboration, automatic publication, or full
  source retrieval.
