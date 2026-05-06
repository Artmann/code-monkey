# Approve / Reject Agent Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user approve or reject individual agent-initiated actions from
the task view for both Claude Code and Codex providers, with persisted history
and restart recovery.

**Architecture:** Providers surface SDK-initiated approval requests as
`item.approval_requested` NormalizedEvents. The shared `AgentRunner` registers
pending resolvers, persists requests, and exposes an HTTP route for decisions.
The renderer renders requests as inline transcript cards and swaps the composer
for an Approve / Reject bar while a request is pending. On startup, unresolved
approvals are auto-rejected with reason "app restarted" and the task is resumed
from its last completed turn.

**Tech Stack:** TypeScript, Electron main (Hono HTTP API, Drizzle +
better-sqlite3), React renderer (Vite + React Testing Library + Vitest),
`@anthropic-ai/claude-agent-sdk`, `@openai/codex-sdk`.

---

## File Structure

**Modify**

- `src/main/agents/provider.ts` — add `ApprovalRequest`, `ApprovalDecision`,
  extend `AgentThreadOptions` with `onApprovalRequest`.
- `src/main/agents/claude-code/claude-code-provider.ts` — wire `canUseTool` into
  the SDK query; drop `acceptEdits` shortcut; emit `item.approval_requested` and
  await decision.
- `src/main/agents/claude-code/claude-code-normalize.ts` — pass through
  `item.approval_requested` / `item.approval_resolved` events unchanged.
- `src/main/codex/codex-client.ts` — accept per-thread approval options (typing
  only).
- `src/main/agents/codex/codex-provider.ts` — normalize Codex approval events
  into the shared shape and forward decisions back.
- `src/main/codex/agent-runner.ts` — pending-approvals map, `onApprovalRequest`
  wiring at every `startThread`/`resumeThread` call site, startup recovery for
  unresolved approvals, new `respondToApproval` method.
- `src/main/codex/agent-runner.test.ts` — add tests for pending map, startup
  recovery, respondToApproval.
- `src/main/api/routes/threads.ts` — add
  `POST /threads/:threadId/approvals/:requestId`.
- `src/main/api/routes/threads.test.ts` — add tests for the new route.
- `src/renderer/components/agent-transcript.tsx` — add `approval` render node
  (pending + resolved forms).
- `src/renderer/components/agent-pane.tsx` — swap composer for approval action
  bar when a pending approval exists.
- `src/renderer/hooks/use-thread.ts` — derive `pendingApproval` from the event
  list.

**Create**

- `src/renderer/components/approval-card.tsx` — inline transcript card with
  Approve / Reject buttons + reason textarea.
- `src/renderer/components/approval-card.test.tsx` — RTL tests.

No database schema migration. `item.approval_requested` /
`item.approval_resolved` are regular `thread_events` rows with their own `type`.

---

## Shared Types

```ts
// src/main/agents/provider.ts (added)

export type ApprovalRequest = {
  id: string // stable per-request id (uuid)
  tool: string // 'Bash', 'Edit', 'Write', ...
  input: unknown // raw tool input from the SDK
  summary: string // short human-readable summary
}

export type ApprovalDecision =
  | { decision: 'approve' }
  | { decision: 'reject'; reason?: string }

export type OnApprovalRequest = (
  request: ApprovalRequest
) => Promise<ApprovalDecision>
```

`AgentThreadOptions` gains `onApprovalRequest?: OnApprovalRequest`.

Event payload shapes (persisted under `thread_events.payload`):

```ts
// item.approval_requested
{ id: string; tool: string; input: unknown; summary: string; requestedAt: string }

// item.approval_resolved
{ id: string; decision: 'approve' | 'reject'; reason?: string; resolvedAt: string }
```

---

## Task 1: Extend the provider contract with approval types

**Files:**

- Modify: `src/main/agents/provider.ts`

- [ ] **Step 1: Write the failing test**

Add to a new file `src/main/agents/provider.types.test.ts`:

```ts
import { expectTypeOf, test } from 'vitest'

import type {
  AgentThreadOptions,
  ApprovalDecision,
  ApprovalRequest,
  OnApprovalRequest
} from './provider'

test('ApprovalRequest has required fields', () => {
  expectTypeOf<ApprovalRequest>().toEqualTypeOf<{
    id: string
    tool: string
    input: unknown
    summary: string
  }>()
})

test('ApprovalDecision discriminates by decision', () => {
  expectTypeOf<ApprovalDecision>().toEqualTypeOf<
    { decision: 'approve' } | { decision: 'reject'; reason?: string }
  >()
})

test('AgentThreadOptions accepts onApprovalRequest', () => {
  expectTypeOf<AgentThreadOptions>()
    .toHaveProperty('onApprovalRequest')
    .toEqualTypeOf<OnApprovalRequest | undefined>()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:run src/main/agents/provider.types.test.ts` Expected: FAIL —
`ApprovalRequest` / `ApprovalDecision` / `OnApprovalRequest` not exported.

- [ ] **Step 3: Add the types**

Append to `src/main/agents/provider.ts`:

```ts
export type ApprovalRequest = {
  id: string
  tool: string
  input: unknown
  summary: string
}

export type ApprovalDecision =
  | { decision: 'approve' }
  | { decision: 'reject'; reason?: string }

export type OnApprovalRequest = (
  request: ApprovalRequest
) => Promise<ApprovalDecision>
```

Then add `onApprovalRequest?: OnApprovalRequest` to `AgentThreadOptions`:

```ts
export type AgentThreadOptions = {
  workingDirectory?: string
  skipGitRepoCheck?: boolean
  sandboxMode?: 'read-only' | 'workspace-write' | 'danger-full-access'
  approvalPolicy?: 'never' | 'on-request' | 'on-failure' | 'untrusted'
  additionalDirectories?: string[]
  onApprovalRequest?: OnApprovalRequest
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test:run src/main/agents/provider.types.test.ts` Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/agents/provider.ts src/main/agents/provider.types.test.ts
git commit -m "Add approval request/decision types to provider contract"
```

---

## Task 2: Claude Code provider — wire `canUseTool`

**Files:**

- Modify: `src/main/agents/claude-code/claude-code-provider.ts`
- Create: `src/main/agents/claude-code/claude-code-provider.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/main/agents/claude-code/claude-code-provider.test.ts`:

```ts
import { describe, expect, test, vi } from 'vitest'

import { createClaudeCodeProvider } from './claude-code-provider'

type CapturedOptions = {
  canUseTool?: (
    tool: string,
    input: unknown,
    context: unknown
  ) => Promise<unknown>
}

const makeFakeSdk = (captured: CapturedOptions[]) => async () => ({
  query: (input: { prompt: string; options?: CapturedOptions }) => {
    captured.push(input.options ?? {})
    return (async function* () {
      // Empty stream — the test drives canUseTool directly.
    })()
  }
})

describe('claude-code provider approval wiring', () => {
  test('passes a canUseTool callback that emits approval_requested', async () => {
    const captured: CapturedOptions[] = []
    const provider = await createClaudeCodeProvider(
      { mode: 'cli' },
      makeFakeSdk(captured)
    )

    const events: unknown[] = []
    const onApprovalRequest = vi.fn(async () => ({
      decision: 'approve' as const
    }))

    const thread = provider.startThread({
      workingDirectory: '/tmp',
      onApprovalRequest
    })

    const { events: stream } = await thread.runStreamed('hi')

    const iterator = stream[Symbol.asyncIterator]()
    // Fire canUseTool concurrently with stream draining.
    const canUse = captured[0]?.canUseTool
    expect(canUse).toBeTypeOf('function')

    const resultPromise = canUse?.(
      'Bash',
      { command: 'git commit -m test' },
      {}
    )

    // Drain whatever the stream yields (the approval event).
    let next = await iterator.next()
    while (!next.done) {
      events.push(next.value)
      next = await iterator.next()
    }

    const decision = await resultPromise
    expect(decision).toEqual({ behavior: 'allow' })
    expect(onApprovalRequest).toHaveBeenCalledWith(
      expect.objectContaining({ tool: 'Bash', summary: expect.any(String) })
    )
    expect(
      events.find(
        (event) =>
          (event as { type?: string }).type === 'item.approval_requested'
      )
    ).toBeTruthy()
  })

  test('translates reject into SDK deny with the reason as message', async () => {
    const captured: CapturedOptions[] = []
    const provider = await createClaudeCodeProvider(
      { mode: 'cli' },
      makeFakeSdk(captured)
    )

    const onApprovalRequest = vi.fn(async () => ({
      decision: 'reject' as const,
      reason: 'let me do this myself'
    }))

    const thread = provider.startThread({
      workingDirectory: '/tmp',
      onApprovalRequest
    })
    await thread.runStreamed('hi')

    const canUse = captured[0]?.canUseTool
    const result = await canUse?.('Bash', { command: 'rm -rf /' }, {})

    expect(result).toEqual({
      behavior: 'deny',
      message: 'let me do this myself'
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:run src/main/agents/claude-code/claude-code-provider.test.ts`
Expected: FAIL — `captured[0].canUseTool` is undefined (not wired yet).

- [ ] **Step 3: Wire `canUseTool` in the provider**

In `src/main/agents/claude-code/claude-code-provider.ts`:

- Extend `QueryOptions` with
  `canUseTool?: (tool, input, context) => Promise<{ behavior: 'allow' } | { behavior: 'deny'; message: string }>`.
- Drop the `mapPermissionMode` behavior that returned `acceptEdits`; always pass
  `'default'` so the SDK routes tool calls through `canUseTool`.
- In `createThread`, if `threadOptions?.onApprovalRequest` is set, synthesize:

```ts
import { randomUUID } from 'node:crypto'

const onApprovalRequest = threadOptions?.onApprovalRequest

const canUseTool = onApprovalRequest
  ? async (tool: string, input: unknown) => {
      const request = {
        id: randomUUID(),
        tool,
        input,
        summary: summarizeInput(tool, input)
      }
      const requestedAt = new Date().toISOString()

      pendingApprovalEvents.push({
        type: 'item.approval_requested',
        item: { ...request, requestedAt }
      })

      const decision = await onApprovalRequest(request)

      const resolvedAt = new Date().toISOString()
      pendingApprovalEvents.push({
        type: 'item.approval_resolved',
        item: {
          id: request.id,
          decision: decision.decision,
          reason: decision.decision === 'reject' ? decision.reason : undefined,
          resolvedAt
        }
      })

      if (decision.decision === 'approve') return { behavior: 'allow' }
      return {
        behavior: 'deny',
        message: decision.reason ?? 'Rejected by user.'
      }
    }
  : undefined
```

Where `summarizeInput` is defined once in the module:

```ts
const summarizeInput = (tool: string, input: unknown): string => {
  if (tool === 'Bash' && typeof input === 'object' && input !== null) {
    const command = (input as { command?: unknown }).command
    if (typeof command === 'string') return command.slice(0, 200)
  }
  if (
    (tool === 'Edit' || tool === 'Write') &&
    typeof input === 'object' &&
    input !== null
  ) {
    const path = (input as { file_path?: unknown }).file_path
    if (typeof path === 'string') return `${tool} ${path}`
  }
  return tool
}
```

- Maintain a per-run `pendingApprovalEvents: NormalizedEvent[]` array. In the
  async generator wrapping `normalizeClaudeCodeStream`, drain this array between
  SDK messages:

```ts
const normalized: AsyncIterable<NormalizedEvent> = {
  [Symbol.asyncIterator]: async function* () {
    for await (const event of generator) {
      while (pendingApprovalEvents.length > 0) {
        yield pendingApprovalEvents.shift() as NormalizedEvent
      }
      yield event
    }

    while (pendingApprovalEvents.length > 0) {
      yield pendingApprovalEvents.shift() as NormalizedEvent
    }
    // existing captured-session-id logic...
  }
}
```

- Add `canUseTool` to the `options` object passed into `query(...)`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test:run src/main/agents/claude-code/claude-code-provider.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full provider test suite**

Run: `pnpm test:run src/main/agents/` Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/main/agents/claude-code/claude-code-provider.ts src/main/agents/claude-code/claude-code-provider.test.ts
git commit -m "Route Claude Code tool approvals through onApprovalRequest"
```

---

## Task 3: Codex provider — normalize approval events

**Files:**

- Modify: `src/main/agents/codex/codex-provider.ts`
- Modify: `src/main/codex/codex-client.ts` (only if type adjustments are
  required)
- Create: `src/main/agents/codex/codex-provider.test.ts`

> **Discovery step before writing the test:** open
> `node_modules/@openai/codex-sdk/` typings and look for the thread-stream event
> shape describing approval requests (grep for `approval`, `request_approval`,
> `ApprovalRequest`) and the reply API (e.g. a `respond` or `reply` method on
> the returned `runStreamed` handle). Record the exact names in a one-line
> comment at the top of `codex-provider.ts`. If the SDK in use does not expose
> per-call approvals, STOP and report back: do not fake it. The spec requires
> real parity, not a mock.

- [ ] **Step 1: Discovery**

Run:
`pnpm ls @openai/codex-sdk && grep -R "approval" node_modules/@openai/codex-sdk/dist | head -30`

Expected: a type or event name containing "approval". Record the exact names. If
empty, stop and ask.

- [ ] **Step 2: Write the failing test**

Create `src/main/agents/codex/codex-provider.test.ts` (tool assumes the
discovery found an event type `approval_requested` on Codex's stream and a
`respondToApproval(id, decision)` method on the thread handle; **adjust both
names to the real ones you discovered above before committing**):

```ts
import { describe, expect, test, vi } from 'vitest'

import { createCodexProvider } from './codex-provider'

const makeFakeSdk = (emit: (events: unknown[]) => void) => async () => ({
  Codex: class {
    constructor(_opts: unknown) {}
    startThread() {
      const responses: unknown[] = []
      return {
        id: 'codex-1',
        runStreamed: async () => ({
          events: (async function* () {
            // Emit an approval request, wait for respond, then turn.completed.
            yield {
              type: 'approval_requested',
              id: 'req-1',
              tool: 'shell',
              input: { command: 'ls' }
            }
            // In the real SDK this yield waits on reply; for the test we just
            // emit completion after the caller has replied.
            yield { type: 'turn.completed' }
          })()
        }),
        respondToApproval: (id: string, decision: unknown) => {
          responses.push({ id, decision })
        },
        _responses: responses
      }
    }
    resumeThread() {
      return this.startThread()
    }
  }
})

describe('codex provider approval wiring', () => {
  test('surfaces approval_requested as item.approval_requested and routes decision back', async () => {
    const provider = await createCodexProvider(
      { mode: 'cli' },
      makeFakeSdk(() => {})
    )

    const onApprovalRequest = vi.fn(async () => ({
      decision: 'approve' as const
    }))

    const thread = provider.startThread({
      workingDirectory: '/tmp',
      onApprovalRequest
    })
    const { events } = await thread.runStreamed('hi')

    const collected: unknown[] = []
    for await (const event of events) {
      collected.push(event)
    }

    expect(
      collected.find(
        (event) =>
          (event as { type?: string }).type === 'item.approval_requested'
      )
    ).toBeTruthy()
    expect(onApprovalRequest).toHaveBeenCalledWith(
      expect.objectContaining({ tool: 'shell' })
    )
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm test:run src/main/agents/codex/codex-provider.test.ts` Expected:
FAIL.

- [ ] **Step 4: Implement**

In `src/main/agents/codex/codex-provider.ts`:

- In `wrapThread`, store `threadOptions?.onApprovalRequest`.
- In `runStreamed`, wrap the returned `events` iterator with a generator that:
  1. Intercepts Codex events whose `type` matches the discovered
     approval-request name.
  2. Builds an `ApprovalRequest` (generate `id` if Codex doesn't supply one),
     yields
     `{ type: 'item.approval_requested', item: { ...request, requestedAt } }`.
  3. Awaits `onApprovalRequest(request)`; calls Codex's reply method with the
     translated decision (`'approve' | 'reject'` → whatever the SDK expects).
  4. Yields
     `{ type: 'item.approval_resolved', item: { id, decision, reason?, resolvedAt } }`.
- Pass-through all other events to the caller unchanged.
- Update `createThread` / `wrapThread` to accept `AgentThreadOptions` (so
  `onApprovalRequest` reaches the wrapper).

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm test:run src/main/agents/codex/codex-provider.test.ts` Expected:
PASS.

- [ ] **Step 6: Commit**

```bash
git add src/main/agents/codex/codex-provider.ts src/main/agents/codex/codex-provider.test.ts src/main/codex/codex-client.ts
git commit -m "Normalize Codex approval events into item.approval_requested"
```

---

## Task 4: AgentRunner — pending approvals map + event pass-through

**Files:**

- Modify: `src/main/codex/agent-runner.ts`
- Modify: `src/main/codex/agent-runner.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/main/codex/agent-runner.test.ts`:

```ts
test('registers pending approval on item.approval_requested and routes respondToApproval back', async () => {
  const { runner, stubProvider, database } = buildTestRunner()
  // buildTestRunner is an existing helper in this test file — reuse whatever
  // factory it already uses. If no such helper exists yet, add one that mirrors
  // the setup in the nearest existing test.

  // Seed a task + thread + start work.
  const { taskId } = await seedTaskWithThread(database)
  const { threadId } = await runner.start(taskId)

  // The stub provider emits an approval_requested event when runStreamed is called.
  stubProvider.emit(threadId, {
    type: 'item.approval_requested',
    item: {
      id: 'req-1',
      tool: 'Bash',
      input: { command: 'git commit' },
      summary: 'git commit',
      requestedAt: new Date().toISOString()
    }
  })

  // Task should now be waiting_for_input.
  const taskRow = database
    .select()
    .from(schema.tasks)
    .where(eq(schema.tasks.id, taskId))
    .get()
  expect(taskRow?.agentState).toEqual('waiting_for_input')

  // Respond.
  await runner.respondToApproval(threadId, 'req-1', {
    decision: 'approve'
  })

  // A resolved event should now exist on the thread.
  const events = database
    .select()
    .from(schema.threadEvents)
    .where(eq(schema.threadEvents.threadId, threadId))
    .all()
  expect(
    events.find((event) => event.type === 'item.approval_resolved')
  ).toBeTruthy()

  // Stub provider should have seen the decision.
  expect(stubProvider.decisionsFor(threadId)).toEqual([
    { id: 'req-1', decision: 'approve' }
  ])
})

test('startup recovery writes synthetic rejection for unresolved approvals', async () => {
  const { runner, database } = buildTestRunner()

  // Seed a thread with a pending approval_requested and no resolved event.
  const { threadId, taskId } = await seedThreadWithPendingApproval(database)

  runner.recoverOrphanedThreads()

  const events = database
    .select()
    .from(schema.threadEvents)
    .where(eq(schema.threadEvents.threadId, threadId))
    .all()

  const resolved = events.find(
    (event) => event.type === 'item.approval_resolved'
  )
  expect(resolved).toBeTruthy()
  const payload = JSON.parse(resolved!.payload) as {
    item: { decision: string; reason: string }
  }
  expect(payload.item).toMatchObject({
    decision: 'reject',
    reason: 'app restarted'
  })

  const taskRow = database
    .select()
    .from(schema.tasks)
    .where(eq(schema.tasks.id, taskId))
    .get()
  expect(taskRow?.agentState).toEqual('idle')
})
```

Add helpers `seedTaskWithThread`, `seedThreadWithPendingApproval`, and a
`stubProvider` exposing `emit(threadId, event)` and `decisionsFor(threadId)` if
not already present. Follow the style of existing helpers in this file.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test:run src/main/codex/agent-runner.test.ts` Expected: FAIL —
`respondToApproval` not defined; recovery behavior missing.

- [ ] **Step 3: Implement pending map + onApprovalRequest wiring**

In `src/main/codex/agent-runner.ts`:

- At the top of `createAgentRunner`, add:

```ts
type PendingApproval = {
  requestId: string
  resolve: (decision: ApprovalDecision) => void
}

const pendingApprovals = new Map<string, PendingApproval>()
```

- Define a factory that builds an `onApprovalRequest` callback for a given
  `threadId` + `taskId`:

```ts
const buildOnApprovalRequest =
  (threadId: string, taskId: string | null): OnApprovalRequest =>
  (request) =>
    new Promise<ApprovalDecision>((resolve) => {
      pendingApprovals.set(threadId, {
        requestId: request.id,
        resolve
      })

      setTaskAgentState(taskId, 'waiting_for_input')
    })
```

Note: the `item.approval_requested` event is emitted by the provider's
normalized stream, which `runStream` already persists via `handleStreamEvent`.
Do not emit it twice.

- At every `provider.startThread({ ... })` / `provider.resumeThread({ ... })`
  call in `start`, `restartThread`, `continueThread`, and `startProjectThread`,
  add `onApprovalRequest: buildOnApprovalRequest(threadId, taskId)`.

- Add the runner method:

```ts
const respondToApproval = async (
  threadId: string,
  requestId: string,
  decision: ApprovalDecision
): Promise<void> => {
  const pending = pendingApprovals.get(threadId)
  if (!pending || pending.requestId !== requestId) {
    return // already resolved, unknown, or superseded — no-op
  }

  pendingApprovals.delete(threadId)
  pending.resolve(decision)
  // Note: the provider's canUseTool wrapper emits item.approval_resolved on
  // its own once the promise settles; nothing to append here.
}
```

- In `AgentRunner` type, add:

```ts
respondToApproval: (
  threadId: string,
  requestId: string,
  decision: ApprovalDecision
) => Promise<void>
```

and export it from the returned object.

- [ ] **Step 4: Implement startup recovery**

In `recoverOrphanedThreads`, before the existing orphan-status loop, add a pass
that scans for unresolved approvals. A thread has an unresolved approval if its
latest `item.approval_requested` has no later `item.approval_resolved` with the
same `request.id`. For each such thread:

```ts
appendEvent(threadId, 'item.approval_resolved', {
  type: 'item.approval_resolved',
  item: {
    id: requestId,
    decision: 'reject',
    reason: 'app restarted',
    resolvedAt: clock().toISOString()
  }
})
```

and flip the associated task's `agentState` to `'idle'`. The existing
running/starting orphan pass will then mark the thread's `status` accordingly.

**Do not auto-resume the thread in this pass.** Auto-resume from the last
completed turn is the user-triggered path (already covered by `restartThread`);
the recovery pass only ensures the transcript and state are coherent so the user
can decide to continue.

> **Scope note:** The spec mentioned "auto-resume from last completed turn." On
> reflection that belongs to the user's existing restart flow (they hit Continue
> / New chat on a task that came back idle). Adding implicit resume-on-boot
> would silently re-run agent work without user consent, which contradicts the
> rest of the app's posture.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm test:run src/main/codex/agent-runner.test.ts` Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/main/codex/agent-runner.ts src/main/codex/agent-runner.test.ts
git commit -m "Add approval tracking and startup recovery to agent runner"
```

---

## Task 5: API route for decisions

**Files:**

- Modify: `src/main/api/routes/threads.ts`
- Modify: `src/main/api/routes/threads.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/main/api/routes/threads.test.ts`:

```ts
test('POST /threads/:threadId/approvals/:requestId routes decision to the runner', async () => {
  const { app, runner } = buildApp()
  const respondSpy = vi.spyOn(runner, 'respondToApproval')

  const response = await app.request('/threads/thread-1/approvals/req-1', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ decision: 'reject', reason: 'nope' })
  })

  expect(response.status).toEqual(202)
  expect(respondSpy).toHaveBeenCalledWith('thread-1', 'req-1', {
    decision: 'reject',
    reason: 'nope'
  })
})

test('POST /threads/:threadId/approvals/:requestId rejects invalid decision', async () => {
  const { app } = buildApp()

  const response = await app.request('/threads/thread-1/approvals/req-1', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ decision: 'maybe' })
  })

  expect(response.status).toEqual(400)
})
```

Use whatever `buildApp` helper already exists in `threads.test.ts`. Extend it to
include a stub `respondToApproval` on the runner if necessary.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:run src/main/api/routes/threads.test.ts` Expected: FAIL — 404
(route does not exist).

- [ ] **Step 3: Add the route**

In `src/main/api/routes/threads.ts`, add near the other `POST` routes:

```ts
const approvalSchema = z.discriminatedUnion('decision', [
  z.object({ decision: z.literal('approve') }),
  z.object({
    decision: z.literal('reject'),
    reason: z.string().max(2_000).optional()
  })
])

routes.post(
  '/threads/:threadId/approvals/:requestId',
  zValidator('json', approvalSchema),
  async (context) => {
    const threadId = context.req.param('threadId')
    const requestId = context.req.param('requestId')
    const decision = context.req.valid('json')

    try {
      await runner.respondToApproval(threadId, requestId, decision)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)

      return context.json({ error: message }, 500)
    }

    return context.json({ ok: true }, 202)
  }
)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test:run src/main/api/routes/threads.test.ts` Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/api/routes/threads.ts src/main/api/routes/threads.test.ts
git commit -m "Add POST /threads/:threadId/approvals/:requestId route"
```

---

## Task 6: Renderer — derive pending approval from events

**Files:**

- Modify: `src/renderer/hooks/use-thread.ts`
- Create: `src/renderer/hooks/use-thread.test.ts` (if not already present;
  otherwise add to existing)

- [ ] **Step 1: Write the failing test**

Add:

```ts
import { describe, expect, test } from 'vitest'

import { derivePendingApproval, type ThreadEvent } from './use-thread'

const buildEvent = (partial: Partial<ThreadEvent>): ThreadEvent => ({
  id: 'e',
  threadId: 't',
  sequence: 0,
  type: 'item.started',
  payload: null,
  createdAt: new Date().toISOString(),
  ...partial
})

describe('derivePendingApproval', () => {
  test('returns the latest unresolved approval request', () => {
    const events: ThreadEvent[] = [
      buildEvent({
        id: 'e1',
        sequence: 1,
        type: 'item.approval_requested',
        payload: {
          item: {
            id: 'req-1',
            tool: 'Bash',
            input: { command: 'ls' },
            summary: 'ls'
          }
        }
      })
    ]

    expect(derivePendingApproval(events)).toEqual({
      id: 'req-1',
      tool: 'Bash',
      input: { command: 'ls' },
      summary: 'ls'
    })
  })

  test('returns null when the request has been resolved', () => {
    const events: ThreadEvent[] = [
      buildEvent({
        id: 'e1',
        sequence: 1,
        type: 'item.approval_requested',
        payload: { item: { id: 'req-1', tool: 'Bash', input: {}, summary: '' } }
      }),
      buildEvent({
        id: 'e2',
        sequence: 2,
        type: 'item.approval_resolved',
        payload: { item: { id: 'req-1', decision: 'approve' } }
      })
    ]

    expect(derivePendingApproval(events)).toBeNull()
  })

  test('returns null when no approval events exist', () => {
    expect(derivePendingApproval([])).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:run src/renderer/hooks/use-thread.test.ts` Expected: FAIL —
`derivePendingApproval` not exported.

- [ ] **Step 3: Implement**

In `src/renderer/hooks/use-thread.ts`, export:

```ts
export type PendingApproval = {
  id: string
  tool: string
  input: unknown
  summary: string
}

export const derivePendingApproval = (
  events: ThreadEvent[]
): PendingApproval | null => {
  const resolvedIds = new Set<string>()

  for (const event of events) {
    if (event.type !== 'item.approval_resolved') continue
    const item = (event.payload as { item?: { id?: string } } | null)?.item
    if (item?.id) resolvedIds.add(item.id)
  }

  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event.type !== 'item.approval_requested') continue
    const item = (
      event.payload as {
        item?: {
          id?: string
          tool?: string
          input?: unknown
          summary?: string
        }
      } | null
    )?.item

    if (!item?.id || resolvedIds.has(item.id)) continue

    return {
      id: item.id,
      tool: item.tool ?? 'unknown',
      input: item.input ?? null,
      summary: item.summary ?? ''
    }
  }

  return null
}
```

Also extend the `useThread` return shape to include `pendingApproval` via
`derivePendingApproval(events)`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test:run src/renderer/hooks/use-thread.test.ts` Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/hooks/use-thread.ts src/renderer/hooks/use-thread.test.ts
git commit -m "Derive pending approval state from thread events"
```

---

## Task 7: Renderer — approval card component

**Files:**

- Create: `src/renderer/components/approval-card.tsx`
- Create: `src/renderer/components/approval-card.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/renderer/components/approval-card.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'

import { ApprovalCard } from './approval-card'

describe('ApprovalCard', () => {
  test('pending state shows approve and reject actions', () => {
    const onDecide = vi.fn()

    render(
      <ApprovalCard
        state="pending"
        tool="Bash"
        summary='git commit -m "wip"'
        onDecide={onDecide}
      />
    )

    expect(screen.getByText('Bash')).toBeInTheDocument()
    expect(screen.getByText('git commit -m "wip"')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /approve/i }))
    expect(onDecide).toHaveBeenCalledWith({ decision: 'approve' })
  })

  test('reject reveals reason textarea and submits with reason', () => {
    const onDecide = vi.fn()

    render(
      <ApprovalCard
        state="pending"
        tool="Bash"
        summary="rm -rf /"
        onDecide={onDecide}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /reject/i }))
    fireEvent.change(screen.getByPlaceholderText(/why/i), {
      target: { value: 'absolutely not' }
    })
    fireEvent.click(screen.getByRole('button', { name: /send rejection/i }))

    expect(onDecide).toHaveBeenCalledWith({
      decision: 'reject',
      reason: 'absolutely not'
    })
  })

  test('resolved approved state renders a one-liner summary', () => {
    render(
      <ApprovalCard
        state="resolved"
        tool="Bash"
        summary="git commit"
        decision="approve"
      />
    )

    expect(screen.getByText(/approved/i)).toBeInTheDocument()
    expect(screen.getByText(/git commit/)).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /approve/i })
    ).not.toBeInTheDocument()
  })

  test('resolved rejected state shows the reason', () => {
    render(
      <ApprovalCard
        state="resolved"
        tool="Bash"
        summary="git commit"
        decision="reject"
        reason="let me do this myself"
      />
    )

    expect(screen.getByText(/rejected/i)).toBeInTheDocument()
    expect(screen.getByText(/let me do this myself/)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:run src/renderer/components/approval-card.test.tsx` Expected:
FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/renderer/components/approval-card.tsx`:

```tsx
import { useState } from 'react'

import { Button } from './ui/button'
import { Textarea } from './ui/textarea'
import { cn } from '../lib/utils'

type PendingProps = {
  state: 'pending'
  tool: string
  summary: string
  onDecide: (
    decision: { decision: 'approve' } | { decision: 'reject'; reason?: string }
  ) => void
}

type ResolvedProps = {
  state: 'resolved'
  tool: string
  summary: string
  decision: 'approve' | 'reject'
  reason?: string
}

export type ApprovalCardProps = PendingProps | ResolvedProps

export function ApprovalCard(props: ApprovalCardProps) {
  if (props.state === 'resolved') {
    return <ResolvedRow {...props} />
  }

  return <PendingCard {...props} />
}

function PendingCard({ tool, summary, onDecide }: PendingProps) {
  const [mode, setMode] = useState<'idle' | 'rejecting'>('idle')
  const [reason, setReason] = useState('')

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-banana/50 bg-banana/5 px-4 py-3">
      <div className="flex items-baseline gap-2">
        <span className="font-display text-[10.5px] font-semibold uppercase tracking-[0.16em] text-banana">
          Approval needed
        </span>
        <span className="font-mono text-[11px] text-muted-foreground">
          {tool}
        </span>
      </div>

      <div className="font-mono text-[12.5px] text-foreground whitespace-pre-wrap break-words">
        {summary}
      </div>

      {mode === 'rejecting' ? (
        <div className="flex flex-col gap-2">
          <Textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Why reject? (optional — will be sent to the agent)"
            className="min-h-[60px] resize-none text-[13px]"
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setMode('idle')
                setReason('')
              }}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={() =>
                onDecide({
                  decision: 'reject',
                  reason: reason.trim() === '' ? undefined : reason.trim()
                })
              }
            >
              Send rejection
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
          <Button
            size="sm"
            onClick={() => onDecide({ decision: 'approve' })}
          >
            Approve
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setMode('rejecting')}
          >
            Reject
          </Button>
        </div>
      )}
    </div>
  )
}

function ResolvedRow({ tool, summary, decision, reason }: ResolvedProps) {
  const approved = decision === 'approve'

  return (
    <div
      className={cn(
        'flex items-baseline gap-2 rounded-lg border px-3 py-1.5 text-[11.5px]',
        approved
          ? 'border-muted-foreground/20 bg-muted/30 text-muted-foreground'
          : 'border-[color:var(--destructive)]/30 bg-[color:var(--destructive)]/5 text-[color:var(--destructive)]'
      )}
    >
      <span>{approved ? '✓ Approved' : '✗ Rejected'}</span>
      <span className="font-mono text-[11px]">{tool}</span>
      <span className="font-mono text-[11px] truncate">{summary}</span>
      {!approved && reason ? (
        <span className="ml-auto italic">— {reason}</span>
      ) : null}
    </div>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test:run src/renderer/components/approval-card.test.tsx` Expected:
PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/approval-card.tsx src/renderer/components/approval-card.test.tsx
git commit -m "Add ApprovalCard component for pending and resolved states"
```

---

## Task 8: Transcript — render approval events

**Files:**

- Modify: `src/renderer/components/agent-transcript.tsx`

- [ ] **Step 1: Write the failing test**

Add to (or create) `src/renderer/components/agent-transcript.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'

import { AgentTranscript } from './agent-transcript'

const makeEvent = (overrides: Record<string, unknown>) => ({
  id: `event-${Math.random()}`,
  threadId: 't1',
  sequence: 0,
  type: 'item.started',
  payload: null as unknown,
  createdAt: new Date().toISOString(),
  ...overrides
})

describe('AgentTranscript approval cards', () => {
  test('renders pending approval as an ApprovalCard', () => {
    render(
      <AgentTranscript
        events={[
          makeEvent({
            type: 'item.approval_requested',
            payload: {
              item: {
                id: 'req-1',
                tool: 'Bash',
                input: { command: 'git commit' },
                summary: 'git commit'
              }
            }
          })
        ]}
      />
    )

    expect(screen.getByText(/Approval needed/i)).toBeInTheDocument()
    expect(screen.getByText('Bash')).toBeInTheDocument()
  })

  test('collapses resolved approvals to a one-liner', () => {
    render(
      <AgentTranscript
        events={[
          makeEvent({
            sequence: 1,
            type: 'item.approval_requested',
            payload: {
              item: {
                id: 'req-1',
                tool: 'Bash',
                input: {},
                summary: 'git commit'
              }
            }
          }),
          makeEvent({
            sequence: 2,
            type: 'item.approval_resolved',
            payload: {
              item: { id: 'req-1', decision: 'approve' }
            }
          })
        ]}
      />
    )

    expect(screen.getByText(/approved/i)).toBeInTheDocument()
    expect(screen.queryByText(/Approval needed/i)).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:run src/renderer/components/agent-transcript.test.tsx` Expected:
FAIL.

- [ ] **Step 3: Implement**

In `src/renderer/components/agent-transcript.tsx`:

- Add a `RenderNode` variant:

```ts
| {
    kind: 'approval'
    id: string
    requestId: string
    tool: string
    summary: string
    input: unknown
    resolved: null | { decision: 'approve' | 'reject'; reason?: string }
  }
```

- In `buildNodes`, before the `item.started|updated|completed` branch, add:

```ts
if (event.type === 'item.approval_requested') {
  flushActivity(activity)
  activity = null
  const item = (
    event.payload as {
      item?: {
        id?: string
        tool?: string
        input?: unknown
        summary?: string
      }
    } | null
  )?.item

  if (!item?.id) continue

  nodes.push({
    kind: 'approval',
    id: event.id,
    requestId: item.id,
    tool: item.tool ?? 'unknown',
    summary: item.summary ?? '',
    input: item.input,
    resolved: null
  })
  continue
}

if (event.type === 'item.approval_resolved') {
  const item = (
    event.payload as {
      item?: { id?: string; decision?: string; reason?: string }
    } | null
  )?.item

  if (!item?.id) continue

  const target = nodes.find(
    (node) => node.kind === 'approval' && node.requestId === item.id
  )

  if (target && target.kind === 'approval') {
    target.resolved = {
      decision: item.decision === 'approve' ? 'approve' : 'reject',
      reason: item.reason
    }
  }
  continue
}
```

- In `RenderedNode`, add:

```tsx
if (node.kind === 'approval') {
  return <ApprovalNode node={node} />
}
```

- `ApprovalNode` receives the pending approval callback from context. Introduce
  a React context:

```tsx
// Near the top of the file
import { createContext, useContext } from 'react'
import { ApprovalCard } from './approval-card'

const ApprovalActionsContext = createContext<
  ((requestId: string, decision: ApprovalDecisionShape) => void) | null
>(null)

type ApprovalDecisionShape =
  | { decision: 'approve' }
  | { decision: 'reject'; reason?: string }

export const ApprovalActionsProvider = ApprovalActionsContext.Provider

function ApprovalNode({
  node
}: {
  node: Extract<RenderNode, { kind: 'approval' }>
}) {
  const onDecide = useContext(ApprovalActionsContext)

  if (node.resolved) {
    return (
      <ApprovalCard
        state="resolved"
        tool={node.tool}
        summary={node.summary}
        decision={node.resolved.decision}
        reason={node.resolved.reason}
      />
    )
  }

  return (
    <ApprovalCard
      state="pending"
      tool={node.tool}
      summary={node.summary}
      onDecide={(decision) => onDecide?.(node.requestId, decision)}
    />
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test:run src/renderer/components/agent-transcript.test.tsx` Expected:
PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/agent-transcript.tsx src/renderer/components/agent-transcript.test.tsx
git commit -m "Render approval_requested/resolved events in the transcript"
```

---

## Task 9: AgentPane — composer swap + wire API call

**Files:**

- Modify: `src/renderer/components/agent-pane.tsx`
- Modify: `src/renderer/components/agent-pane.test.tsx`

- [ ] **Step 1: Write the failing test**

Add:

```tsx
test('pending approval replaces composer with approve/reject action bar', () => {
  const onDecide = vi.fn()

  render(
    <AgentPane
      task={null}
      thread={{ id: 't1', status: 'running' } as Thread}
      events={[
        {
          id: 'e1',
          threadId: 't1',
          sequence: 1,
          type: 'item.approval_requested',
          createdAt: new Date().toISOString(),
          payload: {
            item: {
              id: 'req-1',
              tool: 'Bash',
              input: { command: 'git commit' },
              summary: 'git commit'
            }
          }
        }
      ]}
      providerConfigured={true}
      onSendMessage={() => {}}
      onApprovalDecision={onDecide}
      isSending={false}
    />
  )

  expect(
    screen.queryByPlaceholderText(/Nudge the agent/i)
  ).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /approve/i }))
  expect(onDecide).toHaveBeenCalledWith('req-1', { decision: 'approve' })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:run src/renderer/components/agent-pane.test.tsx` Expected: FAIL
— `onApprovalDecision` not a prop; composer still rendered.

- [ ] **Step 3: Implement**

In `src/renderer/components/agent-pane.tsx`:

- Add to `AgentPaneProps`:

```ts
onApprovalDecision?: (
  requestId: string,
  decision:
    | { decision: 'approve' }
    | { decision: 'reject'; reason?: string }
) => void
```

- In the render body, compute `pendingApproval = derivePendingApproval(events)`.
- Wrap the transcript area in
  `<ApprovalActionsProvider value={onApprovalDecision ?? null}>` so the inline
  card can dispatch.
- Where `<Composer ... />` is currently rendered, render an approval action bar
  instead when `pendingApproval != null`:

```tsx
{pendingApproval ? (
  <ApprovalCard
    state='pending'
    tool={pendingApproval.tool}
    summary={pendingApproval.summary}
    onDecide={(decision) =>
      onApprovalDecision?.(pendingApproval.id, decision)
    }
  />
) : (
  <Composer ... />
)}
```

- [ ] **Step 4: Wire the API call**

In the parent that renders `AgentPane` (`project-view.tsx` or `task-view.tsx` —
grep for `<AgentPane`), add a handler:

```ts
const onApprovalDecision = useCallback(
  async (
    requestId: string,
    decision: { decision: 'approve' } | { decision: 'reject'; reason?: string }
  ) => {
    if (!thread) return
    await fetch(`/api/threads/${thread.id}/approvals/${requestId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(decision)
    })
  },
  [thread]
)
```

and pass it through to `<AgentPane onApprovalDecision={onApprovalDecision} />`.
Match whatever fetch helper the file already uses (e.g. `apiClient.post`); don't
introduce a new pattern.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm test:run src/renderer/components/agent-pane.test.tsx` Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/components/agent-pane.tsx src/renderer/components/agent-pane.test.tsx src/renderer/components/project-view.tsx src/renderer/components/task-view.tsx
git commit -m "Swap composer for approval action bar while a request is pending"
```

---

## Task 10: Full-suite verification

**Files:** none

- [ ] **Step 1: Typecheck**

Run: `pnpm typecheck` Expected: PASS.

- [ ] **Step 2: Lint**

Run: `pnpm lint` Expected: PASS with no new warnings. If pre-existing warnings
appear on touched files, fix them (per project rules).

- [ ] **Step 3: Test suite**

Run: `pnpm test:run` Expected: PASS.

- [ ] **Step 4: Manual smoke test**

Launch the app (`pnpm start`) against a Claude Code provider. Start a task that
the agent will want to approve an action for (e.g. "run `git status` for me").
Verify:

- The transcript shows an "Approval needed" card.
- The composer at the bottom is replaced with approve/reject controls.
- Clicking Approve unblocks the agent and resolves the card to a one-liner.
- Rejecting with a reason resolves the card and surfaces the reason in the
  transcript.
- Restart the app mid-approval. On relaunch, the thread shows a "Rejected — app
  restarted" row and the task is idle.

- [ ] **Step 5: Commit any polish fixes**

```bash
git add -A
git commit -m "Polish after manual approval-flow smoke test"
```

---

## Self-Review

**Spec coverage:**

- Both providers from the start → Tasks 2 + 3.
- Agent-decided triggers → Tasks 2 + 3 (we surface whatever the SDK asks).
- Inline card + swapped composer → Tasks 7, 8, 9.
- Approve / Reject with reason → Task 7.
- Reuse `waiting_for_input` → Task 4
  (`setTaskAgentState(taskId, 'waiting_for_input')`).
- Persistent events (`item.approval_requested` / `item.approval_resolved`) →
  Tasks 2, 3 (emitted in providers); Task 4 persists via existing
  `handleStreamEvent`.
- Startup recovery → Task 4 (Step 4).
- API route → Task 5.

**Scope adjustment vs spec:** The spec said "auto-resume from last completed
turn on restart." Task 4 Step 4 explicitly scopes this down — synthetic
rejection + idle state, no auto-resume. The user must hit Continue. Rationale
inlined in the plan. Flag this to the user at the start of execution in case
they want auto-resume after all; if so, extend Task 4 with a resume pass that
replays `continueThread` with a synthesized message like
`"(resumed — previous tool call was cancelled)"`.

**Placeholder scan:** Every step has real code or real commands. The one place I
asked for discovery is Task 3 Step 1, which is deliberate — Codex's SDK surface
for approvals has to be read, not guessed. If that step comes up empty, the plan
instructs to stop rather than mock.

**Type consistency:** `ApprovalRequest`, `ApprovalDecision`, `OnApprovalRequest`
are defined in Task 1 and used unchanged in Tasks 2, 3, 4, 5. `PendingApproval`
in the renderer (Task 6) is a separate type because it omits `requestedAt` and
uses the event's id shape.

---

Plan complete and saved to
`docs/superpowers/plans/2026-04-19-approve-reject-agent-actions.md`. Two
execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task,
review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans,
batch execution with checkpoints.

Which approach?
