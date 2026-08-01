---
feature_id: "visual-explanation.web-search"
title: "Use bounded web search during AI generation"
status: "implemented"
---

# Use bounded web search during AI generation

## Purpose

Use one Java-owned search-provider boundary for both user entry points:

1. Selection chat exposes a `web_search` function to the active model according
   to the turn's explicit `off | auto | force` mode. Java validates every tool
   call, dispatches the active profile through `SearchProviderRegistry`, appends
   a sanitized protocol-specific tool result, and asks the model for the next
   message. `force` requires at least one call; `auto` records when the model
   skips it.
2. Main-question visual generation exposes a binary search option beside the
   search-provider settings instead of in the primary composer. The option is
   off by default and cannot be enabled until an active search profile exists.
   When on, the
   server route performs one deterministic bounded search through a
   bearer-protected Java internal endpoint before calling the visual model. The
   model may reference only stable IDs from those results, and local assembly
  maps valid references to canonical evidence. When off, no search request is
   made.

Tavily is the default search preset for the current product, while Brave is a
second concrete adapter. Future search providers extend the SPI and
registration set without changing either consumer. There is no browser-visible
general search endpoint.

The tool searches a fixed provider endpoint only. It does not fetch result
pages, follow model-supplied URLs, execute returned content, or expose a general
browser/HTTP tool. Search evidence is explicitly marked untrusted before it is
returned to the model.

## Entry, preconditions, and terminal outcomes

- Entry A: selection chat validates the turn's search mode before constructing
  an OpenAI Chat Completions or Anthropic Messages request.
- Entry B: main visual creation validates its `off | on` option before any
  provider call.
- Availability: `off` omits all search work. `auto` without an active search
  profile records `unavailable` and omits tools. `force` or main-question `on`
  without an active search profile fails with
  `search_provider_not_configured`.
- Validation: only the function name `web_search` is allowed; tool-call IDs must
  be bounded and unique within one response; arguments must be a JSON object
  containing only `query` and optional `freshness`; query length is 1–300;
  freshness is `any | day | week | month | year`.
- Budgets: at most two tool calls are accepted in one chat completion loop and
  every search asks for at most five results.
- Success: Java resolves one immutable snapshot of the active Tavily or Brave
  profile for the loop, calls that exact adapter, keeps unique results
  with non-empty titles and HTTPS URLs, bounds title/snippet/date/URL fields,
  immediately persists completed-search progress while the turn is still
  `PENDING`, appends an `EXTERNAL_UNTRUSTED_EVIDENCE` tool result, then requests
  the final model answer. The normalized results therefore remain auditable
  even if that later model request is known-failed or ambiguous. Main visual
  creation maps only
  model-selected stable result IDs into canonical node evidence; an unrecognized ID
  is rejected rather than turned into a model-supplied URL.
- Failure: malformed or over-budget tool calls are classified as an invalid
  model response. Search timeout, rate limit, invalid credentials, or provider
  failure aborts the turn as a known failure; it is not converted into a fake
  successful tool result and there is no hidden provider fallback or retry.
  Only an explicit structured upstream error that names `tools` or
  `tool_choice` is classified as `model_tools_unsupported`; a generic
  companion/provider rejection retains its original typed failure.

## Runtime flow

```mermaid
flowchart TD
    E1(["E1 Submit selection-chat turn"]) --> D1{"D1 Search mode"}
    D1 -->|Off| A1["A1 Send model request without tools; record disabled"]
    D1 -->|Auto| D2{"D2 Active search profile exists"}
    D1 -->|Force| D2
    D2 -->|No and auto| A1
    D2 -->|No and force| X1(["X1 Fail with search_provider_not_configured"])
    X1 --> T2["T2 Mark parent turn FAILED"]
    D2 -->|Yes and auto| A2["A2 Send protocol tool schema with automatic choice"]
    D2 -->|Yes and force| A3["A3 Send exact forced web_search tool choice"]
    A1 --> D3{"D3 Model response contains a tool request"}
    A2 --> D3
    A3 --> D3
    D3 -->|No and force unmet| X2(["X2 Fail because forced search was skipped"])
    X2 --> T2
    D3 -->|No and off or auto| T1["T1 Complete turn with observed search trace and sources"]
    D3 -->|Yes| D4{"D4 Calls are valid web_search requests within total budget two"}
    D4 -->|No| X3(["X3 Fail as invalid provider response"])
    X3 --> T2
    D4 -->|Yes| A4["A4 Resolve exact SearchProvider and call fixed endpoint"]
    A4 --> D5{"D5 Search response excludes the exact Key and is parseable within bounds"}
    D5 -->|No| X4(["X4 Fail with typed search-provider error"])
    X4 --> T2
    D5 -->|Yes| A5["A5 Normalize at most five unique HTTPS sources"]
    A5 --> A13["A13 Persist observed search progress while turn remains PENDING"]
    A13 --> A6["A6 Append sanitized untrusted protocol tool result"]
    A6 --> A7["A7 Request next model completion"]
    A7 --> D3

    E2(["E2 Choose search permission beside the active provider, then submit main-question create"]) --> D6{"D6 Search option"}
    D6 -->|Off| A8["A8 Generate visual document without search"]
    A8 --> X5(["X5 Return model-only visual document with disabled trace"])
    D6 -->|On| A9["A9 Call bearer-protected Java internal search once"]
    A9 --> D7{"D7 Java returned exact-Key-safe non-empty bounded sources"}
    D7 -->|No| X6(["X6 Return typed search error before visual model"])
    D7 -->|Yes| A10["A10 Assign stable S1 through S5 IDs and mark evidence untrusted"]
    A10 --> A11["A11 Generate visual draft using stable evidence IDs only"]
    A11 --> D8{"D8 Evidence references are recognized canonical IDs and at least one is used"}
    D8 -->|No but repairable| C1["C1 Run one bounded content repair"]
    C1 --> D9{"D9 Repaired references valid"}
    D9 -->|No| X7(["X7 Reject generated visual content"])
    D9 -->|Yes| A12["A12 Map references to canonical source metadata"]
    D8 -->|Yes| A12
    A12 --> X8(["X8 Return search-backed visual document and used trace"])

    G1["G1 Fixed provider origins and no redirects or page fetch"] -.-> A4
    G1 -.-> A9
    G2["G2 Tool, query, call, result, timeout, and byte bounds"] -.-> D4
    G2 -.-> A4
    G2 -.-> A5
    G2 -.-> A9
    G3["G3 Server-only key, exact echo rejection, and untrusted evidence boundary"] -.-> D5
    G3 -.-> D7
    G3 -.-> A6
    G3 -.-> A10
    G3 -.-> T1
    G4["G4 Pin one exact provider snapshot with no fallback"] -.-> A4
    G4 -.-> A9
    G5["G5 Canonical evidence-reference assembly"] -.-> D8
    G5 -.-> A12
    G6["G6 Classify tool incompatibility only from explicit structured evidence"] -.-> A2
    G6 -.-> A3
    G6 -.-> A7
    G7["G7 Search permission stays off without an active provider"] -.-> E2
    G7 -.-> D6
```

## Component sequence

```mermaid
sequenceDiagram
    actor U as User
    participant C as Selection chat client
    participant M as Active model provider
    participant L as Main-question route
    participant J as Java internal search and tool validation
    participant R as SearchProviderRegistry
    participant S as Tavily or Brave
    participant D as ChatTurnRepository

    U->>C: Submit turn with off, auto, or force
    alt Off
        C->>M: Model request without tools
    else Auto with active search
        C->>M: Tool schema with automatic choice
    else Force with active search
        C->>M: Exact required web_search choice
    else Force without active search
        C->>D: Mark FAILED with provider_not_configured
    end
    opt Model returns a valid tool request
        C->>J: Validate and execute bounded web_search
        J->>R: Require exact active adapter
        R-->>J: Tavily or Brave SearchProvider
        J->>S: Fixed-origin request with server-side key
        S-->>J: Provider results or typed failure
        J->>J: Reject an exact API Key echo before JSON parsing
        J-->>C: Normalized sources
        C->>D: Persist USED trace and sources while still PENDING
        C->>M: Untrusted protocol tool result
    end
    M-->>C: Final content, skipped force, or invalid tool output
    C->>D: Complete or store a failed/non-replayable terminal state without erasing search progress

    U->>L: Create visual explanation with search on
    L->>J: POST /internal/v1/search with bearer and owner
    J->>R: Require exact active adapter
    R-->>J: Tavily or Brave SearchProvider
    J->>S: One fixed-origin bounded search
    S-->>J: Provider response
    J->>J: Reject an exact API Key echo before JSON parsing
    alt Search failure or no results
        J-->>L: Typed error before model generation
    else Bounded results
        J-->>L: Normalized sources
        L->>L: Assign S1 through S5
        L->>M: Generate using untrusted stable evidence IDs
        M-->>L: Draft evidenceRefs
        alt Invalid or unused evidence after one repair
            L-->>U: Reject generated content
        else Valid references
            L->>L: Map IDs to canonical source metadata
            L-->>U: Search-backed visual document
        end
    end
```

## Persisted turn state

```mermaid
stateDiagram-v2
    PENDING --> PENDING: A13 persist observed search progress before later model I/O
    PENDING --> COMPLETED: T1 final content / persist search mode, status, call count, provider ID, and sources
    PENDING --> FAILED: T2 forced search unavailable or skipped, invalid tool call, or known search failure
    PENDING --> NON_REPLAYABLE: T3 ChatTurnRepository.markUnknown after ambiguous model transport
```

`NON_REPLAYABLE` is a diagram-only semantic label. T3 points to
`ChatTurnRepository.markUnknown`, which remains the authoritative persisted
status transition.

## Safeguards and recovery

- G1 selects Tavily or Brave from fixed server presets. `SafeHttpClient` follows
  no redirects, and the model cannot choose the host or cause Java to fetch a
  returned result URL.
- G2 allows at most two tool calls, five results per call, a 300-character
  query, a 45-second upstream request timeout, and a 2 MiB response cap. Tool
  arguments allow no extra keys. Source titles, snippets, dates, and URLs are
  bounded, and only HTTPS source URLs survive normalization.
- G3 decrypts the active search key only in Java. Tavily and Brave compare every
  successful raw response with the exact active Key before JSON parsing; an
  echo returns `provider_response_rejected` and no source or tool result is
  used, persisted, or returned. Safe tool content carries an explicit
  untrusted-evidence notice so snippets cannot legitimately redefine
  system/tool policy.
- G4 registers exactly one adapter for each implemented search provider.
  `ProviderWebSearchClient.findActive` resolves the owner profile once into a
  `SearchSession` containing both the decrypted provider snapshot and its
  configuration ID. Every call in the loop uses that pinned session, so a
  concurrent activation change cannot make execution and audit identity refer
  to different profiles. Duplicate or non-search registrations fail
  application startup; a missing adapter returns
  `search_provider_unsupported`. There is no implicit adapter selection and no
  cross-provider fallback.

- G5 accepts only locally assigned `S1` through `S5` references, maps them to
  the server-held canonical URL/title/snippet values, and requires at least one
  accepted reference when main-question search is on.

- G6 maps a model/provider response to `model_tools_unsupported` only when a
  structured error explicitly refers to `tools` or `tool_choice`. Ordinary
  authentication, validation, endpoint, or companion failures keep their
  original classification; the system never retries by silently removing the
  tool contract.

There is no automatic Tavily-to-Brave fallback and no automatic search retry.
Selection-chat `auto` may continue without live sources when no search profile
exists, but `force` fails. Main-question `on` fails before visual generation on
configuration, provider, empty-result, or internal-response errors. A generated
document with invalid or unused search evidence is rejected after at most one
bounded content repair. `offered` means the model was allowed to search but no
completed or failed search call was recorded; it is not proof that the model
never attempted one. Once a search succeeds, the `used` trace and sources are
written before the next model request: a known later failure moves the turn to
`FAILED`, while an ambiguous later transport uses the repository's
non-replayable transition, and both terminal states retain that observed search
evidence.
