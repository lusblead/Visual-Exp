---
feature_id: "visual-explanation.selection-chat"
title: "Ask AI about selected text"
status: "implemented"
---

# Ask AI about selected text

## Purpose

Let a reader choose between two independent actions for selected prose:
`向 AI 提问` opens a left conversation workspace, while `深入` keeps the
existing structured deep-reading flow. The conversation workspace is closed by
default, can be opened from the persistent launcher or a selected quote, and can
be closed again without discarding history. Opening the chat only freezes the
quote in browser state. A model request starts only after the user submits a
question.

Each submitted turn carries an explicit search mode: `off`, `auto`, or `force`.
`off` never offers a tool; `auto` lets a compatible model decide whether current
facts need search; `force` requires at least one validated `web_search` call or
fails visibly. The returned turn records whether search was disabled,
unavailable, offered but skipped, used, or failed, so provider configuration is
not confused with actual execution.

The Java backend stores one ordered `chat_turns` history per knowledge-session
ID. A turn is one durable record containing the user question, selected text,
assistant answer, status, resolved model profile ID when applicable, search
mode/execution trace, and normalized search sources; there is no separate
thread/message aggregate. Chat turns remain separate from the canonical
`visual-knowledge-session/1` payload and never mutate the semantic document.

## Entry, preconditions, and terminal outcomes

- Entry: the user selects at most 600 characters in a rendered semantic node,
  term explanation, or deep explanation and chooses `向 AI 提问`; the independent
  `深入` button continues to use `visual-explanation.semantic-zoom`. The user may
  also open the chat without a selection from its persistent launcher.
- Preconditions for opening: the browser can associate the DOM selection with a
  node or currently rendered explanation when a quote is supplied. Opening or
  closing performs no persistence and no provider call.
- Preconditions for submission: session ID, client turn ID, question, node ID,
  selected text, search mode, and optional context-token shape pass Java
  validation. The
  current backend records the supplied node/context identity but does not
  cryptographically verify the context token or re-check that the selected text
  occurs in the stored semantic document.
- Success: a new `PENDING` turn resolves the owner's active Java model override,
  or falls back to the authenticated local DeepSeek companion when available.
  On success the same row becomes `COMPLETED` with assistant text, search
  execution trace, and any normalized sources produced by the model-owned tool
  loop.
- Duplicate recovery: the same owner-scoped `clientTurnId` and request hash
  returns the existing completed, pending, or ambiguous turn without another
  model call. Reusing it with a different payload is rejected.
- Failure: a known provider/configuration failure moves the row to `FAILED` and
  returns a typed error. An ambiguous model transport result, or a `PENDING`
  turn older than five minutes, moves to the ambiguous terminal state; neither is replayed
  automatically.

## Runtime flow

```mermaid
flowchart TD
    E1(["E1 Select rendered prose"]) --> D1{"D1 Browser can bind 1-600 characters to current rendered context"}
    D1 -->|No| X1(["X1 Clear selection action; no side effect"])
    D1 -->|Yes| D2{"D2 User chooses Ask AI or Deepen"}
    D2 -->|Deepen| X2(["X2 Delegate to semantic deep-reading flow"])
    D2 -->|Ask AI| A1["A1 Freeze quote and open left chat workspace"]
    A1 --> X3(["X3 Focus composer; no model or turn yet"])
    E4(["E4 User opens launcher or closes chat"]) --> D6{"D6 Requested panel state"}
    D6 -->|Open| X3
    D6 -->|Close| X10(["X10 Hide workspace and keep session history"])

    E2(["E2 Submit question"]) --> A2["A2 POST through same-origin Java proxy"]
    A2 --> D3{"D3 Java request fields valid"}
    D3 -->|No| X4(["X4 Typed rejection before turn or provider"])
    D3 -->|Yes| D4{"D4 owner plus clientTurnId and request including search mode already exists"}
    D4 -->|Hash mismatch or FAILED| X5(["X5 Conflict; require a new clientTurnId"])
    D4 -->|COMPLETED| X6(["X6 Return stored completed turn"])
    D4 -->|Pending or ambiguous| X7(["X7 Return 202 stored status; no replay"])
    D4 -->|No| T1["T1 Insert one PENDING chat_turn with search mode"]
    T1 --> D7{"D7 Owner has active Java model override"}
    D7 -->|Yes| A3["A3 Load history and call owner model override"]
    D7 -->|No| D8{"D8 Local companion DeepSeek transport available"}
    D8 -->|Yes| A5["A5 Load history and call local DeepSeek default"]
    D8 -->|No| T3
    A3 --> D9{"D9 Custom response excludes the active provider Key"}
    D9 -->|No| T3
    D9 -->|Yes| D5{"D5 Model and search operation outcome"}
    A5 --> D5
    D5 -->|Success| T2["T2 Store assistant text, optional provider ID, search trace, sources, COMPLETED"]
    T2 --> X6
    D5 -->|Known failure| T3["T3 Mark FAILED with safe error code"]
    T3 --> X8(["X8 Return typed failure; prior history remains"])
    D5 -->|Ambiguous transport| T4["T4 Mark ambiguous terminal state"]
    T4 --> X7

    E3(["E3 Mount or switch active knowledge session"]) --> A4["A4 Abort stale browser requests and GET session turns"]
    A4 --> C1["C1 Detect and recover stale pending rows without model replay"]
    C1 --> T5["T5 Move recovered rows to ambiguous terminal state"]
    T5 --> X9(["X9 Render at most 200 turns in chronological order"])

    G1["G1 Bounded browser and Java input validation"] -.-> D1
    G1 -.-> D3
    G2["G2 Owner-scoped clientTurnId plus request hash"] -.-> D4
    G2 -.-> T1
    G3["G3 Server-only provider credentials"] -.-> A3
    G3 -.-> A5
    G4["G4 Abort and epoch guards isolate session delivery"] -.-> A4
    G4 -.-> X9
    G5["G5 Explicit panel visibility independent of viewport"] -.-> D6
    G5 -.-> X10
    G6["G6 Exact credential-echo rejection"] -.-> D9
    G6 -.-> T2
```

## Component sequence

```mermaid
sequenceDiagram
    actor U as User
    participant S as LineageStudio
    participant P as SelectionChatPanel
    participant B as Same-origin backend proxy
    participant J as ChatController and ChatService
    participant D as ChatTurnRepository
    participant M as OpenAiCompatibleChatClient

    U->>S: Select prose
    S-->>U: Show Ask AI and Deepen
    alt Deepen
        U->>S: Choose Deepen
        S->>S: Continue existing deep-reading flow
    else Ask AI
        U->>S: Choose Ask AI
        S->>P: Set sessionId and frozen selection
        P-->>U: Open composer without model request
        U->>P: Submit question
        P->>B: POST /api/backend/v1/chat/turns
        B->>J: Internal bearer plus device owner ID
        J->>D: Find by owner and clientTurnId
        alt Existing identical turn
            D-->>J: Existing status and content
        else New turn
            J->>D: Insert PENDING
            J->>D: Read up to 12 completed history turns
            J->>M: complete(owner, question, selection, history)
            opt Model requests web_search
                M->>M: Execute bounded tool loop from web-search contract
            end
            alt Custom provider response echoes its active Key
                M-->>J: Unsafe response rejected without body disclosure
                J->>D: PENDING to FAILED with safe code
            else Completion succeeds
                M-->>J: Text, provider ID, normalized sources
                J->>D: PENDING to COMPLETED
            else Known provider failure
                J->>D: PENDING to FAILED
            else Ambiguous model transport
                J->>D: PENDING to ambiguous terminal state
            end
        end
        J-->>P: HTTP 200, 202, or typed error
        P-->>U: Render matching session history or require refresh
    end
    U->>P: Close conversation workspace
    P-->>U: Hide panel; keep persisted and loaded history
```

## Persisted state lifecycle

```mermaid
stateDiagram-v2
    [*] --> PENDING: T1 accepted unique submission / insert
    PENDING --> COMPLETED: T2 model success / persist answer and sources
    PENDING --> FAILED: T3 known failure / persist safe code
    PENDING --> NON_REPLAYABLE: T4 ChatTurnRepository.markUnknown after ambiguous transport
    PENDING --> NON_REPLAYABLE: T5 recoverStalePending after five minutes
```

`NON_REPLAYABLE` is a diagram-only semantic label. The authoritative persisted
value is the one written by `ChatTurnRepository.markUnknown`; the diagram does
not introduce a second status name.

## Safeguards and recovery

- G1 bounds selection text to 600 characters and question text to 4,000
  characters, validates IDs, and allows only the expected JSON fields.
- G2 uses a database uniqueness constraint on `(owner_id, client_turn_id)` plus
  a SHA-256 request hash. A completed duplicate is a read; pending and
  ambiguous duplicates return 202; a failed or conflicting ID must not be
  reused.
- G3 provider and search keys are decrypted only in Java provider clients and
  never appear in the turn DTO, source DTO, semantic session, or browser
  history.
- G4 keys the panel by active session ID, aborts prior list/send requests on
  unmount, and uses a local history epoch to discard stale list responses.
- G5 derives desktop workspace layout from `chatPanelOpen`, not viewport width.
  Closing only changes explicit panel visibility; it does not clear loaded or
  persisted history, and the launcher remains available while the panel is
  closed.
- G6 scans a successful custom-model response for the exact active API Key
  before parsing assistant content. A match becomes a known safe failure, so
  neither the browser nor `chat_turns` can receive the reflected credential.

The browser treats an unconfirmed POST result conservatively and requires a
history refresh before allowing another send. Java never automatically retries
an ambiguous model request. Chat list reads convert only stale `PENDING` rows
to the ambiguous terminal state; a user retry is a new turn with a new
`clientTurnId`.
