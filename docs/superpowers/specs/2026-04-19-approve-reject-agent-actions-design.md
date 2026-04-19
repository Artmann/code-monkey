# Approve / Reject Agent Actions — Design

## Problem

Agents (Claude Code, Codex) regularly reach points where they need the user
to approve an action — most often a shell command like `git commit`. Today
Code Monkey silently either auto-accepts edits (`acceptEdits` mode) or leaves
the underlying SDK to block on its own approval prompt that never reaches the
UI. The agent ends up narrating that it needs approval ("the git commands
need your approval — you can commit it yourself or approve the operations
and I will") but there is no way for the user to actually approve or reject
from inside Code Monkey.

We need a first-class approval surface: when the agent asks to do something,
the user sees the request in the task's agent pane, approves or rejects it,
and the agent continues.

## Goals

- Let the user approve or reject individual agent-initiated actions from the
  task view.
- Work for both Claude Code and Codex with one shared UX.
- Persist approval requests and decisions to the thread event log so the
  transcript stays coherent across restarts.

## Non-goals

- "Approve always" / remembered decisions for a tool or command pattern.
- Per-task approval-policy picker in the UI.
- Structured diffs or rich previews for file edits. First pass renders the
  raw tool input.
- Inventing our own notion of "risky" actions. The SDK decides when to ask;
  we just surface it.

## Decisions

1. **Both providers from the start.** Claude Code and Codex share one UX.
2. **Agent-decided triggers.** We do not reclassify risk. Whatever the SDK
   chooses to ask about, we surface.
3. **Inline card + swapped composer.** The request appears in the transcript
   as a card (durable history) and the composer area at the bottom of the
   agent pane is replaced with an Approve / Reject action bar while a
   request is pending.
4. **Approve / Reject with reason.** Reject reveals a free-text reason field
   that is passed back to the agent.
5. **Reuse `waiting_for_input` state.** No new top-level task state. The
   in-pane UI differentiates approval-waiting from generic input-waiting.
6. **On interruption, auto-resume from the last completed turn.** If the app
   is closed or crashes with an approval pending, the in-flight tool call is
   lost; on restart the task is resumed from the last completed turn and a
   synthetic "app restarted" rejection is written to the transcript so the
   card is not orphaned.

## Architecture

### Provider layer

Extend the provider contract so the runner can receive approval requests and
deliver decisions back.

`AgentThreadOptions` gains:

```ts
onApprovalRequest?: (request: ApprovalRequest) => Promise<ApprovalDecision>
```

where

```ts
type ApprovalRequest = {
  id: string          // stable id for this request
  tool: string        // e.g. 'Bash', 'Edit', 'Write'
  input: unknown      // raw tool input from the SDK
  summary: string     // short human-readable summary (e.g. 'git commit -m "…"')
}

type ApprovalDecision =
  | { decision: 'approve' }
  | { decision: 'reject'; reason?: string }
```

**Claude Code** (`src/main/agents/claude-code/claude-code-provider.ts`):

- Wire `canUseTool` on the SDK query. When invoked, build an
  `ApprovalRequest`, emit a `NormalizedEvent` of type
  `item.approval_requested`, await `onApprovalRequest`, and translate the
  decision into the SDK's `{ behavior: 'allow' }` or
  `{ behavior: 'deny', message }` response.
- The previous `acceptEdits` shortcut is removed. Approvals are now driven
  by `default` permission mode + the `canUseTool` callback — anything the
  SDK would have blocked on now becomes a user-facing request.

**Codex** (`src/main/agents/codex/codex-provider.ts` +
`src/main/codex/codex-client.ts`):

- Set `approvalPolicy: 'on-request'` by default.
- Codex emits approval-request events on its stream. Normalize those to the
  same `item.approval_requested` shape and use the SDK's reply channel to
  deliver the decision.

### NormalizedEvent additions

Two new event types, persisted to the thread event log:

- `item.approval_requested` — `{ id, tool, input, summary, requestedAt }`
- `item.approval_resolved` — `{ id, decision, reason?, resolvedAt }`

Unresolved-vs-resolved is derived by looking for a matching
`item.approval_resolved` with the same `id`.

### Main-process runner

`AgentRunner` (`src/main/codex/agent-runner.ts` — despite the folder name,
this is the shared runner) owns approval lifecycle:

- `pendingApprovals: Map<threadId, { id, resolve }>` — only one in-flight
  request per thread at a time; the SDK model is turn-based so this is
  sufficient.
- On `item.approval_requested` from a provider:
  1. Write the event to the thread log.
  2. Register the pending resolver in `pendingApprovals`.
  3. Flip task state to `waiting_for_input`.
  4. Publish the event through the existing thread event broker so the
     renderer streams it.
- New API route `POST /threads/:threadId/approvals/:requestId`
  (in `src/main/api/routes/threads.ts`) carrying `{ decision, reason? }`:
  1. Look up the pending resolver. If none, no-op (already resolved or
     abandoned).
  2. Resolve the stored promise with the decision.
  3. Write `item.approval_resolved` to the thread log.
  4. Transition task state back to `running` (the agent turn will continue
     and eventually emit `turn.completed`).

On app startup, `AgentRunner` scans tasks whose latest events contain an
unresolved `item.approval_requested`:

- Mark task state as `idle`.
- Append a synthetic `item.approval_resolved`
  with `decision: 'reject'`, `reason: 'app restarted'`.
- If the task was previously auto-running, resume it from the last completed
  turn using the provider's `resumeThread` (Claude Code session id or Codex
  thread id). The in-flight tool call is lost — the agent will see the
  rejection in its history and decide what to do next.

### Renderer

`agent-transcript.tsx`:

- Render `item.approval_requested` as a distinct card showing tool name, a
  one-line summary, and an expandable "show input" disclosure.
  - If a matching `item.approval_resolved` exists, collapse to a one-liner:
    `✓ Approved <tool> <summary>` or `✗ Rejected: "<reason>"`.
  - If unresolved, show Approve / Reject buttons on the card itself.
- Reject reveals an inline textarea for the reason; Submit posts the
  decision.

`agent-pane.tsx`:

- When the thread has an unresolved approval, replace the composer with a
  sticky action bar: Approve / Reject + reason textarea (expands on Reject).
- The "nudge the agent" pathway stays accessible via an "override and send
  message" link on the action bar — sending text implicitly rejects the
  pending request, using the typed text as the reason. This preserves the
  user's ability to redirect the agent without blocking them behind the
  approval buttons.
- The same action bar appears on the inline card; resolving from either
  place updates both.

### Data model

No schema migration required. Events already live on threads and tasks
already support `waiting_for_input`. We derive `hasPendingApproval(thread)`
from the event log (latest `item.approval_requested` without a matching
`item.approval_resolved`).

## Error handling

- **Provider emits a malformed approval event.** Log, write a synthetic
  rejection, continue — do not crash the runner.
- **User closes the task view with a pending approval.** Nothing special —
  the pending state is persisted; reopening shows the same card.
- **User responds after the SDK timed out / turn already failed.** The
  resolver map entry is already gone; the IPC handler no-ops and the UI
  reconciles from the written `item.approval_resolved`.
- **Two approval requests arrive for the same thread before the first is
  resolved.** Not expected given turn-based SDKs, but guarded: the second
  request is auto-rejected with reason `"concurrent approval not
  supported"`. If this ever fires we'll know the assumption was wrong.

## Testing

- Unit tests on the Claude Code provider using a stub SDK that invokes
  `canUseTool`: verify the `NormalizedEvent` is emitted and the decision is
  translated correctly (approve → `behavior: 'allow'`; reject with reason →
  `behavior: 'deny', message: reason`).
- Unit tests on the Codex provider with a stub SDK emitting approval events.
- Runner tests: pending map lifecycle, state transitions, startup recovery
  (synthetic rejection written; task resumed).
- API route tests: decision routes to the right thread; unknown
  request ids no-op (404 or idempotent success — pick and test).
- Renderer tests (`agent-transcript`, `agent-pane`): pending card renders
  buttons; reject opens textarea; resolved card collapses; composer swap
  on/off based on pending state.

## Open questions

None blocking. Future work:

- Remembered approvals ("always allow `git status`") once we have usage
  data about what users approve repeatedly.
- Structured diff preview for Edit/Write tool inputs.
- A per-task approval-policy picker if users want to opt specific tasks
  into fully auto-accept.
