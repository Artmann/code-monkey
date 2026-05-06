import { describe, expect, test } from 'vitest'

import {
  applyStatusFromEvent,
  derivePendingApproval,
  type Thread,
  type ThreadEvent
} from './use-thread'

const buildThread = (partial: Partial<Thread> = {}): Thread => ({
  id: 't',
  name: 'thread',
  directoryPath: '/tmp/repo',
  provider: null,
  externalThreadId: null,
  status: 'running',
  errorMessage: null,
  tabOrder: 0,
  closedAt: null,
  createdAt: new Date().toISOString(),
  lastActivityAt: new Date().toISOString(),
  awaitingInput: false,
  ...partial
})

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
        payload: {
          item: { id: 'req-1', tool: 'Bash', input: {}, summary: '' }
        }
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

  test('returns the most recent unresolved request when multiple exist', () => {
    const events: ThreadEvent[] = [
      buildEvent({
        id: 'e1',
        sequence: 1,
        type: 'item.approval_requested',
        payload: {
          item: { id: 'req-1', tool: 'Bash', input: {}, summary: 'first' }
        }
      }),
      buildEvent({
        id: 'e2',
        sequence: 2,
        type: 'item.approval_resolved',
        payload: { item: { id: 'req-1', decision: 'approve' } }
      }),
      buildEvent({
        id: 'e3',
        sequence: 3,
        type: 'item.approval_requested',
        payload: {
          item: { id: 'req-2', tool: 'Edit', input: {}, summary: 'second' }
        }
      })
    ]

    expect(derivePendingApproval(events)?.id).toEqual('req-2')
  })
})

describe('applyStatusFromEvent', () => {
  test('flips a running thread to idle on turn.completed', () => {
    const thread = buildThread({ status: 'running' })
    const event = buildEvent({ type: 'turn.completed' })

    expect(applyStatusFromEvent(thread, event).status).toEqual('idle')
  })

  test('flips a running thread to idle on turn.cancelled', () => {
    const thread = buildThread({ status: 'running' })
    const event = buildEvent({ type: 'turn.cancelled' })

    expect(applyStatusFromEvent(thread, event).status).toEqual('idle')
  })

  test('captures the error message on turn.failed', () => {
    const thread = buildThread({ status: 'running' })
    const event = buildEvent({
      type: 'turn.failed',
      payload: { message: 'boom' }
    })

    const next = applyStatusFromEvent(thread, event)

    expect(next.status).toEqual('error')
    expect(next.errorMessage).toEqual('boom')
  })

  test('captures the error.message on error events', () => {
    const thread = buildThread({ status: 'running' })
    const event = buildEvent({
      type: 'error',
      payload: { error: { message: 'kaboom' } }
    })

    const next = applyStatusFromEvent(thread, event)

    expect(next.status).toEqual('error')
    expect(next.errorMessage).toEqual('kaboom')
  })

  test('falls back to a generic message when none is provided', () => {
    const thread = buildThread({ status: 'running' })
    const event = buildEvent({ type: 'turn.failed', payload: null })

    expect(applyStatusFromEvent(thread, event).errorMessage).toEqual(
      'Unknown agent error'
    )
  })

  test('leaves an idle thread alone on non-terminal events', () => {
    const thread = buildThread({ status: 'idle' })
    const event = buildEvent({ type: 'item.started' })

    expect(applyStatusFromEvent(thread, event)).toBe(thread)
  })
})
