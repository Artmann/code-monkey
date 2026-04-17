import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'

import type { Thread, ThreadEvent } from '../hooks/use-thread'
import { buildTask, renderWithProviders } from '../test-utils'
import { AgentPane } from './agent-pane'

const buildThread = (overrides: Partial<Thread> = {}): Thread => ({
  id: 'thread-1',
  taskId: 'task-1',
  codexThreadId: null,
  worktreePath: '/tmp/wt',
  branchName: 'code-monkey/t',
  baseBranch: 'main',
  status: 'running',
  errorMessage: null,
  createdAt: new Date(0).toISOString(),
  lastActivityAt: new Date(0).toISOString(),
  ...overrides
})

describe('AgentPane', () => {
  test('shows Start Work, disabled, when provider is not configured', () => {
    renderWithProviders(
      <AgentPane
        task={buildTask({ status: 'todo' })}
        thread={null}
        events={[]}
        providerConfigured={false}
        onStartWork={() => undefined}
        onSendMessage={() => undefined}
        isStarting={false}
        isSending={false}
      />
    )

    const button = screen.getByRole('button', { name: /start work/i })

    expect(button).toBeDisabled()
    expect(
      screen.getByText(/configure codex/i)
    ).toBeInTheDocument()
  })

  test('enables Start Work when provider is configured', async () => {
    const onStartWork = vi.fn()
    const user = userEvent.setup()

    renderWithProviders(
      <AgentPane
        task={buildTask({ status: 'todo' })}
        thread={null}
        events={[]}
        providerConfigured={true}
        onStartWork={onStartWork}
        onSendMessage={() => undefined}
        isStarting={false}
        isSending={false}
      />
    )

    const button = screen.getByRole('button', { name: /start work/i })

    expect(button).toBeEnabled()

    await user.click(button)

    expect(onStartWork).toHaveBeenCalledTimes(1)
  })

  test('renders the transcript and a composer once a thread exists', () => {
    const events: ThreadEvent[] = [
      {
        id: 'e0',
        threadId: 'thread-1',
        sequence: 0,
        type: 'prep',
        payload: { message: 'preparing' },
        createdAt: new Date(0).toISOString()
      },
      {
        id: 'e1',
        threadId: 'thread-1',
        sequence: 1,
        type: 'item.completed',
        payload: {
          item: { id: 'm1', type: 'agent_message', text: 'hello world' }
        },
        createdAt: new Date(0).toISOString()
      }
    ]

    renderWithProviders(
      <AgentPane
        task={buildTask({ status: 'in_progress' })}
        thread={buildThread({ status: 'idle' })}
        events={events}
        providerConfigured={true}
        onStartWork={() => undefined}
        onSendMessage={() => undefined}
        isStarting={false}
        isSending={false}
      />
    )

    expect(screen.getByText('hello world')).toBeInTheDocument()
    expect(
      screen.getByPlaceholderText(/type a follow-up/i)
    ).toBeInTheDocument()
  })

  test('disables the composer while the thread is running', () => {
    renderWithProviders(
      <AgentPane
        task={buildTask({ status: 'in_progress' })}
        thread={buildThread({ status: 'running' })}
        events={[]}
        providerConfigured={true}
        onStartWork={() => undefined}
        onSendMessage={() => undefined}
        isStarting={false}
        isSending={false}
      />
    )

    expect(
      screen.getByPlaceholderText(/type a follow-up/i)
    ).toBeDisabled()
    expect(screen.getByRole('button', { name: /send/i })).toBeDisabled()
  })

  test('sends the composer text on submit', async () => {
    const onSendMessage = vi.fn()
    const user = userEvent.setup()

    renderWithProviders(
      <AgentPane
        task={buildTask({ status: 'in_progress' })}
        thread={buildThread({ status: 'idle' })}
        events={[]}
        providerConfigured={true}
        onStartWork={() => undefined}
        onSendMessage={onSendMessage}
        isStarting={false}
        isSending={false}
      />
    )

    await user.type(
      screen.getByPlaceholderText(/type a follow-up/i),
      'keep going'
    )
    await user.click(screen.getByRole('button', { name: /send/i }))

    expect(onSendMessage).toHaveBeenCalledWith('keep going')
  })

  test('shows the thread error message when the thread is in error', () => {
    renderWithProviders(
      <AgentPane
        task={buildTask({ status: 'in_progress' })}
        thread={buildThread({
          status: 'error',
          errorMessage: 'Interrupted by app exit'
        })}
        events={[]}
        providerConfigured={true}
        onStartWork={() => undefined}
        onSendMessage={() => undefined}
        isStarting={false}
        isSending={false}
      />
    )

    expect(
      screen.getByText(/interrupted by app exit/i)
    ).toBeInTheDocument()
  })
})
