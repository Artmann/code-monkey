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
