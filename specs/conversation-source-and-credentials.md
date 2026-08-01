# Conversation sources and credentials

## Purpose

Define how the independent visual-explanation product can keep question entry,
context, navigation, and rendering inside Visualized Exp while optionally using
an authorized website AI as a replaceable generation transport. The semantic
core must not couple itself to ChatGPT, DeepSeek, Claude, or any one DOM
structure.

## Source boundary

Website capture must normalize into a read-only evidence layer before any visual document is generated:

```text
Website adapter
  -> ConversationSnapshot
  -> Explanation input
  -> VisualDocument
  -> Web app, extension side panel, or local companion UI
```

`ConversationSnapshot` must carry a source adapter ID, conversation URL, capture time, stable turn IDs when available, role, ordered text blocks, code blocks, links, and user selection boundaries. The original snapshot is immutable evidence; `VisualDocument` is a replaceable projection and must not become the only copy of captured content.

Reading a conversation that the user already opened and using a website AI as
the product's generation backend are different capabilities. The latter uses
the product-owned route:

```text
Visualized Exp question and trusted context
  -> GenerationGateway
  -> authorized website relay or model API
  -> one correlated raw answer
  -> local parsing and contract validation
  -> incremental VisualDocument
```

The user does not have to leave Visualized Exp to formulate the question.

## Replaceable ports

Read permission and permission to speak for the user are intentionally separate:

```ts
interface ConversationReaderPort {
  readonly adapterId: string;
  readonly capabilities: ReadCapabilities;
  capture(grant: CaptureGrant): Promise<ConversationSnapshot>;
  observe?(
    grant: CaptureGrant,
    signal: AbortSignal,
  ): AsyncIterable<ConversationDelta>;
}

interface ConversationFollowUpPort {
  prepare(request: FollowUpRequest): Promise<PreparedFollowUp>;
  submit(
    prepared: PreparedFollowUp,
    grant: OneShotFollowUpGrant,
  ): Promise<SubmissionReceipt>;
  awaitAssistant(
    receipt: SubmissionReceipt,
    signal: AbortSignal,
  ): Promise<ConversationTurn>;
}

interface GenerationGateway {
  submit(request: {
    jobId: string;
    prompt: string;
    contextDigest: string;
    responseContractVersion: string;
  }): Promise<SubmissionReceipt>;
  get(jobId: string, signal: AbortSignal): Promise<{
    status: "queued" | "generating" | "complete" | "failed";
    conversationId: string | null;
    userMessageId: string | null;
    assistantMessageId: string | null;
    blocks: ConversationBlock[];
    rawTextHash: string | null;
    capturedAt: string | null;
  }>;
}
```

- Each supported website owns versioned reader and, when explicitly supported, follow-up adapters. DOM selectors, mutation observers, and composer automation stay inside those adapters.
- The extension content script may read the current page and send normalized messages, but it does not render the main product and never receives provider API keys.
- The extension side panel renders the shared visual UI.
- A service worker coordinates adapter messages, explicit permissions, and optional communication with a local companion.
- The semantic contract and renderer consume normalized snapshots and visual documents, never raw host DOM nodes.
- `GenerationGateway` is the only semantic-core dependency. API, local model,
  and authorized website-relay backends are replaceable implementations.

## Two operating modes

### Faithful conversion

- Default mode.
- Captures only the turns or text explicitly selected by the user.
- May use the user's configured local/provider model to structure the captured answer.
- New visual nodes must retain anchors to original turn/block IDs.
- It does not post anything back to the AI website.

### Website-AI follow-up

- Optional and always user-triggered.
- Visualized Exp creates the exact prompt from the visible question, current
  semantic node, and a bounded trusted context. The extension never invents
  context from unrelated page history.
- A site adapter writes the prompt into the website composer, submits once, observes the newly created assistant turn, and binds that turn to the originating node or term request.
- No background or silent prompting, no credential extraction, no hidden retry loop, and no assumption that one site's private network API is stable or authorized.
- If the site's DOM or user session changes, the adapter fails visibly while preserving the captured snapshot.

The following task invariants are mandatory:

```text
one jobId -> at most one submitted user message
one jobId -> exactly the unique assistant message created after that submission
retry -> inspect local receipt and page boundary before any resend
capture -> only the correlated answer, never the whole active conversation
adoption -> parse, sanitize, and validate before changing VisualDocument
```

### Current ChatGPT website boundary

As of the OpenAI Terms of Use effective January 1, 2026, automatically or
programmatically extracting data or Output is prohibited. Therefore the
automatic ChatGPT website send-and-read backend is currently classified as
`blocked_by_provider_terms`, even when a browser extension has `activeTab`
permission or the user is signed in. Browser permission is not provider
authorization.

The product may keep the replaceable relay contract and may implement it for a
website/provider that gives explicit official permission. It must not ship a
ChatGPT DOM automation backend, read cookies, call private endpoints, or
mislabel such automation as an ordinary browser permission. Reference:
https://openai.com/policies/terms-of-use/

OpenAI Apps SDK is a separate option for rendering an app inside ChatGPT. It
does not preserve the current requirement that Visualized Exp owns the primary
question-entry and navigation surface, so it is supplementary rather than the
default architecture.

## Personal Hub extension reference

`%USERPROFILE%\Documents\Personal-Hub-Android\browser-extension` is a useful
capture reference, not an existing two-way relay.

Reusable parts:

- a versioned page-adapter `capture()` boundary;
- current-branch message detection and structured text/list/table/code blocks;
- streaming and final-message completion checks;
- explicit `activeTab` invocation;
- loopback-only pairing, scoped token, size limits, request hash, and
  idempotency;
- server-side revalidation of every browser-produced record.

Missing for a generation relay:

- locating and writing the website composer;
- send-once behavior and duplicate-send recovery;
- `jobId -> user message -> assistant message` correlation;
- waiting for one newly created answer rather than recapturing the conversation;
- concurrent jobs, tab close, login expiry, CAPTCHA, rate-limit, and DOM-drift
  recovery;
- an API that returns the correlated answer to Visualized Exp.

Synthetic DOM tests cannot establish real-page compatibility. The reference
project's history already shows that ChatGPT menu and message DOM changes can
break real capture after unit fixtures still pass.

## Cost-aware routing

The system must not send the complete graph or every previous answer on each
request. A backend receives only the current action envelope:

- create: visible user question plus output contract;
- expand: selected node, its ancestor titles, and only the facts required to
  preserve local consistency;
- define: the literal term and its current sentence/paragraph;
- dive: the literal selection, current node, and one signed parent
  explanation when present.

Provider choice is policy, not document state:

```text
authorized website relay -> one substantial root or deep answer
local deterministic code -> IDs, graph assembly, validation, projection
local model when present -> inexpensive extraction and normalization
deepseek-v4-flash -> short definitions or bounded repair
deepseek-v4-pro -> explicit deep work only when no cheaper authorized path fits
```

Stable content fingerprints cache every accepted definition and deep result.
Closing UI, changing focus, or expanding an unrelated branch does not spend
tokens again. Unexplored branches remain absent; only the next semantic
frontier is eligible for profile-budgeted preparation. Provider-reported usage
is stored only as bounded numeric receipts; missing usage remains unknown rather
than being estimated from characters.

## Credential modes

### Current local web application

- The scene-planning model is fixed to `deepseek-v4-pro`; contextual term definitions use `deepseek-v4-flash`. They share the same DeepSeek API Key and authenticated transport.
- A user may enter a DeepSeek Key in the page settings. The plaintext exists in browser memory only while the input and save request are active, then the input state is cleared.
- The same-origin settings route forwards the credential to an authenticated loopback companion. The Windows companion stores it as a generic credential in Windows Credential Manager and exposes only configured status plus a fixed DeepSeek proxy.
- The credential persists across page reloads, application restarts, and Windows sign-in sessions until explicit deletion or replacement.
- `DEEPSEEK_API_KEY` remains a supported server-runtime alternative. Hosted deployments continue to use runtime secrets and do not enable browser-triggered local persistence.

### Local companion

- Implemented first slice: a Windows-only local companion stores the DeepSeek credential in the operating-system credential vault, not in extension storage, localStorage, logs, `.env.local`, or the repository.
- The local web launcher gives the companion a random per-process bearer and maps the companion URL and bearer into Vinext's server-worker bindings through `vite.config.ts`; neither value is exposed as a client environment variable or included in the browser bundle. The companion binds only to `127.0.0.1`, rejects direct browser `Origin` requests, fixes the provider, model, and upstream URL, and exposes no plaintext credential-read endpoint.
- The companion owns a second Windows Credential Manager target for the
  explanation-context HMAC secret. It creates that secret once and returns it
  only to the authenticated local launcher over the Origin-rejecting loopback
  channel; the launcher maps it into Vinext's server-worker binding. The secret
  is stable across local restarts, unrelated to the DeepSeek credential and
  per-process bearer, and never enters a client response or bundle. Hosted or
  multi-instance production deployments supply
  `EXPLANATION_CONTEXT_TOKEN_SECRET` with at least 32 bytes through deployment
  secret management.
- The companion preserves DeepSeek JSON-mode and thinking-mode request fields while enforcing an exact model allowlist of `deepseek-v4-pro` and `deepseek-v4-flash`; any other incoming model is rejected rather than forwarded. Safe upstream error codes remain distinguishable across the companion and web adapter, including `provider_auth_failed`, `provider_insufficient_balance`, `provider_invalid_parameters`, `provider_content_filtered`, `provider_insufficient_resources`, rate limiting, timeout, unavailable service, and invalid envelopes. Fixed safe messages replace upstream message bodies.
- Future production extensions prefer Native Messaging with an exact extension-origin allowlist. The authenticated loopback interface is the current local-web bridge, not permission for an extension content script to receive credentials.
- The extension sends normalized conversation snapshots to the companion; it never sends website cookies or page-session tokens.

### Website AI reuse

- Reusing a signed-in website AI may avoid a separate provider key only when the
  provider officially permits the relay behavior.
- The extension must not scrape session tokens or call undocumented private endpoints.
- Faithful conversion still needs either a local/provider model or a deterministic parser; reading an existing answer and asking the website AI a new question are separate capabilities.

## Security and failure boundaries

- Capture is opt-in per invocation or per clearly visible session; do not read unrelated tabs.
- Remove hidden DOM, input drafts, account identifiers, and unrelated conversation content unless selected.
- Treat website text and model responses as untrusted input.
- Version adapter capabilities and fail closed when a required selector or turn boundary cannot be proven.
- Bound snapshot size, term length, follow-up count, and observation timeout.
- Redact sensitive values from logs and diagnostics.
- Browser session persistence may contain canonical knowledge, validated
  explanation content and opaque context MACs. It must never contain the API
  Key, companion bearer, HMAC secret, prompts, raw provider responses or account
  data. JSON and Markdown exports additionally remove the opaque MACs.
- Usage receipts contain only action, lane, model, duration and
  provider-reported numeric token fields. They do not contain questions,
  selections, prompts or generated text.
- Treat the local credential as protected against accidental browser, repository, and cross-user disclosure, not against an administrator or malicious process running as the same Windows user.

## This stage

Implemented now: server-side provider selection, Windows local credential persistence and DeepSeek proxy, recursive visual document, route history, contextual inline-term definition, and replaceable model-port boundaries.

Verified reference only: the Personal Hub extension's capture, completion,
structured-block, loopback-authentication, and idempotency approach.

Specified but not implemented now: `GenerationGateway`, extension manifest, site adapters, side panel, source anchors, live observation, Native Messaging, non-Windows credential vaults, and an officially authorized website-AI relay.

Explicitly blocked at this stage: automatic ChatGPT website send-and-read
automation. A future implementation requires a provider-policy change or
explicit official authorization plus current real-browser acceptance tests.
