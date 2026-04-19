import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'

import type { ThreadEvent } from '../hooks/use-thread'

import { AgentTranscript } from './agent-transcript'

let counter = 0

const makeEvent = (overrides: Partial<ThreadEvent>): ThreadEvent => ({
  id: `event-${counter++}`,
  threadId: 't1',
  sequence: 0,
  type: 'item.started',
  payload: null,
  createdAt: new Date().toISOString(),
  ...overrides
})

describe('AgentTranscript approval cards', () => {
  test('renders pending approval as an ApprovalCard', () => {
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
            payload: { item: { id: 'req-1', decision: 'approve' } }
          })
        ]}
      />
    )

    expect(screen.getByText(/approved/i)).toBeInTheDocument()
    expect(screen.queryByText(/Approval needed/i)).not.toBeInTheDocument()
  })
})
