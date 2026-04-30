import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Project } from '../hooks/use-projects'
import type { Thread } from '../hooks/use-thread'
import { buildProject, renderWithProviders } from '../test-utils'
import { ProjectChatPane } from './project-chat-pane'

let projectThreads: Thread[] = []
let threadData: { thread: Thread; events: [] } | null = null

const startProjectThreadMutate = vi.fn(
  (
    _variables: { projectId: string; text: string },
    options?: { onSuccess?: (thread: { id: string }) => void }
  ) => {
    options?.onSuccess?.({ id: 'thread-created' })
  }
)

vi.mock('../hooks/use-provider-settings', () => ({
  useProviderSettingsQuery: () => ({
    data: {
      provider: 'codex'
    }
  })
}))

vi.mock('../hooks/use-thread', () => ({
  useProjectThreadsQuery: () => ({ data: projectThreads }),
  useSendMessageMutation: () => ({
    mutate: vi.fn(),
    isPending: false
  }),
  useStartProjectThreadMutation: () => ({
    error: null,
    isPending: false,
    mutate: startProjectThreadMutate
  }),
  useThreadQuery: () => ({ data: threadData }),
  useThreadStream: () => undefined
}))

vi.mock('./agent-pane', () => ({
  AgentPane: ({
    onSendMessage
  }: {
    onSendMessage: (text: string) => void
  }) => (
    <button
      type='button'
      onClick={() => onSendMessage('keep selected task')}
    >
      Send test message
    </button>
  )
}))

function buildThread(overrides: Partial<Thread> = {}): Thread {
  const now = new Date(0).toISOString()

  return {
    id: overrides.id ?? 'thread-1',
    taskId: overrides.taskId ?? null,
    projectId: overrides.projectId ?? 'project-1',
    codexThreadId: overrides.codexThreadId ?? null,
    worktreePath: overrides.worktreePath ?? null,
    branchName: overrides.branchName ?? null,
    baseBranch: overrides.baseBranch ?? null,
    status: overrides.status ?? 'idle',
    errorMessage: overrides.errorMessage ?? null,
    createdAt: overrides.createdAt ?? now,
    lastActivityAt: overrides.lastActivityAt ?? now
  }
}

function LocationProbe() {
  const location = useLocation()

  return (
    <output data-testid='location'>{`${location.pathname}${location.search}`}</output>
  )
}

function renderPane({
  initialEntry,
  project,
  threadId
}: {
  initialEntry: string
  project: Project
  threadId: string | null
}) {
  return renderWithProviders(
    <>
      <ProjectChatPane
        project={project}
        threadId={threadId}
      />
      <LocationProbe />
    </>,
    {
      initialEntries: [initialEntry]
    }
  )
}

describe('ProjectChatPane', () => {
  beforeEach(() => {
    projectThreads = []
    threadData = null
    startProjectThreadMutate.mockClear()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('preserves the selected task search parameter when creating a thread', async () => {
    const user = userEvent.setup()

    renderPane({
      initialEntry: '/projects/project-1/agent?task=task-1',
      project: buildProject({ id: 'project-1' }),
      threadId: null
    })

    await user.click(screen.getByRole('button', { name: /send test message/i }))

    expect(startProjectThreadMutate).toHaveBeenCalledTimes(1)
    expect(startProjectThreadMutate.mock.calls[0]?.[0]).toEqual({
      projectId: 'project-1',
      text: 'keep selected task'
    })
    expect(screen.getByTestId('location').textContent).toEqual(
      '/projects/project-1/agent/threads/thread-created?task=task-1'
    )
  })

  it('preserves the selected task search parameter when starting a new thread', async () => {
    const user = userEvent.setup()

    projectThreads = [buildThread({ id: 'thread-1' })]
    threadData = { thread: buildThread({ id: 'thread-1' }), events: [] }

    renderPane({
      initialEntry: '/projects/project-1/agent/threads/thread-1?task=task-1',
      project: buildProject({ id: 'project-1' }),
      threadId: 'thread-1'
    })

    await user.click(screen.getByRole('button', { name: /new thread/i }))

    expect(startProjectThreadMutate).not.toHaveBeenCalled()
    expect(screen.getByTestId('location').textContent).toEqual(
      '/projects/project-1/agent?task=task-1'
    )
  })
})
