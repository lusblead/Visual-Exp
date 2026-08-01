---
feature_id: "visual-explanation.session-lifecycle"
title: "Persist and restore knowledge sessions"
status: "implemented"
---

# Persist and restore knowledge sessions

## Purpose

Make the Java backend the durable authority for accepted
`visual-knowledge-session/1` records. `LineageStudio` uses
`BackendKnowledgeSessionRepository`, which calls the same-origin
`/api/backend/v1/sessions` proxy; the proxy adds a device-scoped owner ID and
the internal Java bearer. The older `IndexedDbKnowledgeSessionRepository`
remains in the repository as an offline implementation and retains its own
tests, but it is not the repository selected by the current application.

A knowledge-session snapshot owns the accepted semantic document, navigation,
completed term/deep explanation caches, visible cache references,
pre-generation profile, and bounded usage receipts. Selection-chat turns are
stored separately in `chat_turns` under the same session ID. They are not part
of the portable semantic snapshot or export.

## Entry, preconditions, and terminal outcomes

- Boot: after the component mounts, the browser reads `/sessions/restore`.
  Java returns only complete sessions, chooses the owner’s active complete
  session when present, otherwise the newest complete session, and returns at
  most 50 summaries. With no saved session the workspace becomes ready and no
  session is created.
- First save: a successful semantic `create` allocates a `knowledge-*` ID in the
  browser. The autosave effect builds revision 1 and sends the complete strict
  protocol to Java.
- Subsequent save: accepted document/navigation/cache/profile/receipt changes
  build a new immutable snapshot and monotonically increment the client
  revision. The browser serializes every save, activate, and delete mutation in
  one failure-tolerant queue before network I/O. Java accepts only a placeholder
  or a lower stored revision.
- Stale write: equal or lower revision returns `saved=false, stale=true` and
  never overwrites newer server state. The current browser marks the latest
  request as saved but does not automatically reload the newer server record.
- Session switch: the browser first saves its latest snapshot, reads the chosen
  complete session, cancels document/background/term/deep work, restores only
  validated completed state, then activates the chosen server record.
- Backend delete: `DELETE /sessions/{id}` transactionally deletes the session
  and its `chat_turns`. The current `KnowledgeSessionControls` UI does not expose
  a delete action.
- Backend unavailable or invalid response: the UI reports an error or
  current-page-only state. It does not silently fall back to IndexedDB.

## Runtime flow

```mermaid
flowchart TD
    E1(["E1 LineageStudio mounts"]) --> A1["A1 GET authoritative Java restore response"]
    A1 --> D1{"D1 Restore response available and structurally valid"}
    D1 -->|No| X1(["X1 Mark history unavailable; keep current page state"])
    D1 -->|Yes, no complete session| X2(["X2 Hydrated empty workspace; no persistence side effect"])
    D1 -->|Yes, active or newest complete session| A2["A2 Cancel task families and restore accepted snapshot"]
    A2 --> X3(["X3 Render restored document and server summary list"])

    E2(["E2 Accepted knowledge state changes"]) --> A3["A3 Build bounded canonical session snapshot and next revision"]
    A3 --> A10["A10 Enqueue immutable browser mutation behind prior saves, activation, or deletion"]
    A10 --> A4["A4 PUT full snapshot through same-origin proxy"]
    A4 --> D2{"D2 Java strict schema, size, owner, and ID validation pass"}
    D2 -->|No| X4(["X4 Reject save; retain browser state and show retry"])
    D2 -->|Yes| D3{"D3 Stored row is placeholder or has lower revision"}
    D3 -->|No| X5(["X5 Return stale without overwriting server state"])
    D3 -->|Yes| T1["T1 Save complete payload and activate session transactionally"]
    T1 --> X6(["X6 Return updated complete-session summaries"])

    E3(["E3 User selects another knowledge record"]) --> A5["A5 Save latest current snapshot"]
    A5 --> A6["A6 GET selected complete session"]
    A6 --> D4{"D4 Selected session still exists and parses"}
    D4 -->|No| X7(["X7 Keep current session and show restore error"])
    D4 -->|Yes| A7["A7 Abort old work and restore selected snapshot"]
    A7 --> T2["T2 Activate selected complete session"]
    T2 --> X8(["X8 Show selected knowledge and its separate chat history"])

    E4(["E4 Authorized client deletes a session"]) --> T3["T3 Delete session and its chat turns in one transaction"]
    T3 --> X9(["X9 Deleted record no longer restores or lists"])

    E5(["E5 User exports active accepted knowledge"]) --> A8["A8 Project canonical state to deterministic JSON or Markdown"]
    A8 --> X10(["X10 Download portable secret-free artifact without chat turns"])

    G1["G1 Same-origin proxy owner isolation and internal bearer"] -.-> A1
    G1 -.-> A4
    G1 -.-> A6
    G1 -.-> T3
    G2["G2 Strict canonical schema and sensitive-field exclusion"] -.-> D2
    G2 -.-> A8
    G3["G3 Monotonic revision compare-and-set"] -.-> D3
    G3 -.-> T1
    G4["G4 Restore cancels stale task families before adoption"] -.-> A2
    G4 -.-> A7
    G5["G5 One failure-tolerant browser mutation queue"] -.-> A10
    G5 -.-> A4
    G5 -.-> A5
    G5 -.-> T2
    G5 -.-> T3
```

## Component sequence

```mermaid
sequenceDiagram
    actor U as User
    participant S as LineageStudio
    participant R as BackendKnowledgeSessionRepository
    participant B as Same-origin backend proxy
    participant J as KnowledgeSessionController and Service
    participant D as KnowledgeSessionRepository database

    S->>R: restoreLatest()
    R->>B: GET /api/backend/v1/sessions/restore
    B->>J: Internal bearer plus owner ID
    J->>D: List complete sessions and active ID
    D-->>J: Active or newest record plus up to 50 summaries
    J-->>R: Strict restore envelope
    alt Complete session exists
        R-->>S: Parsed visual-knowledge-session/1
        S->>S: Abort old tasks and adopt completed snapshot
    else Empty
        R-->>S: null session and empty summaries
    end

    U->>S: Change accepted document, route, cache, profile, or receipts
    S->>S: Build immutable snapshot with next revision
    S->>R: save(snapshot)
    R->>R: Enqueue immutable mutation after the prior mutation settles
    R->>B: PUT /api/backend/v1/sessions/{id}
    B->>J: Owner-scoped strict JSON
    J->>J: Validate exact protocol, shape, bounds, timestamps, and size
    J->>D: Update only placeholder or lower revision
    alt Accepted
        D->>D: Save payload and activate in transaction
        D-->>S: saved true and summaries
    else Stale
        D-->>S: saved false stale true; stored payload unchanged
    else Invalid or unavailable
        J-->>S: Typed error
        S-->>U: Retry control; current accepted state remains
    end

    U->>S: Select another server summary
    S->>R: Save current latest snapshot
    S->>R: read(selectedId)
    R->>J: GET selected complete session
    J-->>S: Strict session or null
    S->>S: Abort old tasks and restore selected session
    S->>R: activate(selectedId)
    R->>J: POST /sessions/{id}/activate
    J->>D: Clear prior active flag and set selected active
```

## Persisted state lifecycle

```mermaid
stateDiagram-v2
    [*] --> PLACEHOLDER: T0 chat creates session identity before a full semantic snapshot
    [*] --> COMPLETE: T1 first accepted semantic snapshot
    PLACEHOLDER --> COMPLETE: T1 first accepted semantic snapshot
    COMPLETE --> COMPLETE: T1 higher client revision accepted
    COMPLETE --> ACTIVE: T2 explicit activation
    ACTIVE --> COMPLETE: T2 another complete session becomes active
    PLACEHOLDER --> DELETED: T3 backend delete
    COMPLETE --> DELETED: T3 backend delete
    ACTIVE --> DELETED: T3 backend delete
```

## Safeguards and recovery

- G1 uses an HttpOnly `vexp_owner` cookie at the web boundary, hashes the owner
  identity in Java, and requires the launcher-generated internal bearer when
  configured. This is device-scoped isolation, not account login or multi-device
  synchronization.
- G2 parses the full client snapshot before sending, then Java rejects unsupported
  top-level/document/node/relation fields, invalid bounds, forbidden sensitive
  field names, inconsistent IDs/timestamps, unsupported protocols, and payloads
  over 3.5 MiB. Export is separately projected from accepted state and excludes
  chat turns.
- G3 commits only a higher revision or the first complete payload replacing a
  placeholder. Equal/lower revisions are read-only stale outcomes.
- G4 aborts document, scene prefetch, term prefetch, term jobs, and deep jobs
  before restoring another snapshot. Only completed cache entries and valid
  context tokens in the accepted snapshot are adopted.
- G5 captures each parsed snapshot at enqueue time and serializes `save`,
  `activate`, and `delete` through one queue. A rejected mutation releases the
  queue so later work can continue; concurrent profile autosaves cannot overlap
  or pass a session activation/deletion request.

`pagehide` sends a best-effort repeat of the latest snapshot, which is safe
because the server revision check makes it idempotent/stale. There is no
automatic server-to-IndexedDB fallback and no automatic stale-write merge.
