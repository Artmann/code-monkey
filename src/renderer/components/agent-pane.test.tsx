import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'

import type { Thread } from '../hooks/use-thread'
import { buildTask, renderWithProviders } from '../test-utils'
import { AgentPane } from './agent-pane'

const buildThread = (overrides: Partial<Thread> = {}): Thread => ({
  id: 'thread-1',
  taskId: 'task-1',
  projectId: null,
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
  test('shows an empty-state message and provider hint when there is no thread and provider is not configured', () => {
    renderWithProviders(
      <AgentPane
        task={buildTask({ status: 'todo' })}
        thread={null}
        events={[]}
        providerConfigured={false}
        onSendMessage={() => undefined}
        isSending={false}
      />
    )

    expect(screen.getByText(/no agent thread yet/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /configure codex/i })).toBeInTheDocument()
  })

  test('omits the provider hint when provider is configured', () => {
    renderWithProviders(
      <AgentPane
        task={buildTask({ status: 'todo' })}
        thread={null}
        events={[]}
        providerConfigured={true}
        onSendMessage={() => undefined}
        isSending={false}
      />
    )

    expect(
      screen.queryByRole('link', { name: /configure codex/i })
    ).not.toBeInTheDocument()
  })

  test('shows a done-state message when there is no thread and the task is done', () => {
    renderWithProviders(
      <AgentPane
        task={buildTask({ status: 'done' })}
        thread={null}
        events={[]}
        providerConfigured={true}
        onSendMessage={() => undefined}
        isSending={false}
      />
    )

    expect(
      screen.getByText(/this task is marked as done/i)
    ).toBeInTheDocument()
  })

  test('keeps the composer enabled while the thread is running so follow-ups can be queued', () => {
    renderWithProviders(
      <AgentPane
        task={buildTask({ status: 'in_progress' })}
        thread={buildThread({ status: 'running' })}
        events={[]}
        providerConfigured={true}
        onSendMessage={() => undefined}
        isSending={false}
      />
    )

    expect(
      screen.getByPlaceholderText(/type a follow-up/i)
    ).not.toBeDisabled()
  })

  test('sends a follow-up through the composer when the thread is idle', async () => {
    const onSendMessage = vi.fn()
    const user = userEvent.setup()

    renderWithProviders(
      <AgentPane
        task={buildTask({ status: 'in_progress' })}
        thread={buildThread({ status: 'idle' })}
        events={[]}
        providerConfigured={true}
        onSendMessage={onSendMessage}
        isSending={false}
      />
    )

    const textbox = screen.getByPlaceholderText(/type a follow-up/i)

    await user.type(textbox, 'what next?')
    await user.click(screen.getByRole('button', { name: /send/i }))

    expect(onSendMessage).toHaveBeenCalledWith('what next?')
  })

  test('surfaces the thread error message as an alert', () => {
    renderWithProviders(
      <AgentPane
        task={buildTask({ status: 'in_progress' })}
        thread={buildThread({ status: 'error', errorMessage: 'boom' })}
        events={[]}
        providerConfigured={true}
        onSendMessage={() => undefined}
        isSending={false}
      />
    )

    expect(screen.getByRole('alert')).toHaveTextContent('boom')
  })

  test('surfaces the merge error as an alert when provided', () => {
    renderWithProviders(
      <AgentPane
        task={buildTask({ status: 'in_progress' })}
        thread={buildThread({ status: 'idle' })}
        events={[]}
        providerConfigured={true}
        onSendMessage={() => undefined}
        isSending={false}
        mergeError='merge conflict'
      />
    )

    expect(screen.getByRole('alert')).toHaveTextContent('merge conflict')
  })
})
