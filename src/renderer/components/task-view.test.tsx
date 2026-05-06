import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Thread } from '../hooks/use-thread'
import {
  buildTask,
  mockApiBridge,
  mockFetchJson,
  renderWithProviders,
  restoreApiBridge
} from '../test-utils'
import { TaskView } from './task-view'

type FetchInit = RequestInit | undefined

const buildThread = (overrides: Partial<Thread> = {}): Thread => ({
  id: 'thread-1',
  taskId: 'task-1',
  projectId: null,
  codexThreadId: null,
  worktreePath: '/tmp/wt',
  branchName: 'code-monkey/abc',
  baseBranch: 'main',
  status: 'running',
  errorMessage: null,
  createdAt: new Date(0).toISOString(),
  lastActivityAt: new Date(0).toISOString(),
  ...overrides
})

const installNoopEventSource = () => {
  class NoopEventSource {
    url: string
    onmessage: ((event: { data: string }) => void) | null = null
    onerror: (() => void) | null = null

    constructor(url: string) {
      this.url = url
    }

    addEventListener() {
      return undefined
    }

    close() {
      return undefined
    }
  }

  vi.stubGlobal('EventSource', NoopEventSource)
}

type RouteResolver = (init: FetchInit) => unknown

const installRouteFetch = (routes: Record<string, RouteResolver>) => {
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      const parsed = new URL(url)
      const method = init?.method ?? 'GET'
      const key = `${method} ${parsed.pathname}`

      const resolver = routes[key]

      if (!resolver) {
        return new Response(
          JSON.stringify({ error: `Not mocked: ${key}` }),
          { status: 404 }
        )
      }

      return new Response(JSON.stringify(resolver(init)), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    }
  )

  vi.stubGlobal('fetch', fetchMock)

  return fetchMock
}

describe('TaskView', () => {
  beforeEach(() => {
    mockApiBridge()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    restoreApiBridge()
  })

  it('renders the task title and agent state', () => {
    installNoopEventSource()

    installRouteFetch({
      'GET /settings/provider': () => ({
        provider: { mode: 'cli', binaryPath: null }
      }),
      'GET /tasks/task-1/threads': () => ({ threads: [] })
    })

    renderWithProviders(
      <TaskView
        task={buildTask({
          id: 'task-1',
          title: 'Build the thing',
          agentState: 'working'
        })}
      />,
      { initialEntries: ['/projects/project-1/tasks/task-1'] }
    )

    expect(screen.getByText('Build the thing')).toBeInTheDocument()
    expect(screen.getByText(/working/i)).toBeInTheDocument()
    expect(
      screen.getByRole('tab', { name: /agent/i })
    ).toHaveAttribute('data-state', 'active')
  })

  it('renders the description as markdown', () => {
    renderWithProviders(
      <TaskView
        task={buildTask({
          title: 'Docs',
          description: '# Heading\n\nSome **bold** text.'
        })}
      />,
      { initialEntries: ['/projects/project-1/tasks/task-1'] }
    )

    expect(
      screen.getByRole('heading', { level: 1, name: /heading/i })
    ).toBeInTheDocument()
    expect(screen.getByText(/bold/i).tagName).toEqual('STRONG')
  })

  it('edits the title on click and saves on Enter', async () => {
    const user = userEvent.setup()
    const fetchMock = mockFetchJson({
      '/tasks/task-1/threads': { threads: [] },
      '/tasks/task-1': {
        task: buildTask({ title: 'Updated title' })
      }
    })

    renderWithProviders(
      <TaskView task={buildTask({ id: 'task-1', title: 'Old title' })} />,
      { initialEntries: ['/projects/project-1/tasks/task-1'] }
    )

    await user.click(screen.getByRole('button', { name: /old title/i }))

    const input = screen.getByRole('textbox', { name: /task title/i })
    await user.clear(input)
    await user.type(input, 'Updated title{enter}')

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.find(
          (call) => (call[1] as RequestInit | undefined)?.method === 'PATCH'
        )
      ).toBeDefined()
    })

    const patchCall = fetchMock.mock.calls.find(
      (call) => (call[1] as RequestInit | undefined)?.method === 'PATCH'
    ) as unknown as [unknown, RequestInit]
    expect(JSON.parse(patchCall[1].body as string)).toEqual({
      title: 'Updated title'
    })
  })

  it('opens the description editor from the pen button', async () => {
    const user = userEvent.setup()
    mockFetchJson({})

    renderWithProviders(
      <TaskView
        task={buildTask({ description: 'Original description' })}
      />,
      { initialEntries: ['/projects/project-1/tasks/task-1'] }
    )

    await user.click(screen.getByRole('button', { name: /edit description/i }))

    expect(
      screen.getByRole('textbox', { name: /task description/i })
    ).toHaveValue('Original description')
  })

  it('cancels title edit on Escape without saving', async () => {
    const user = userEvent.setup()
    const fetchMock = mockFetchJson({})

    renderWithProviders(
      <TaskView task={buildTask({ title: 'Keep me' })} />,
      { initialEntries: ['/projects/project-1/tasks/task-1'] }
    )

    await user.click(screen.getByRole('button', { name: /keep me/i }))
    await user.type(
      screen.getByRole('textbox', { name: /task title/i }),
      'discard'
    )
    await user.keyboard('{Escape}')

    expect(
      screen.getByRole('button', { name: /keep me/i })
    ).toBeInTheDocument()
    expect(
      fetchMock.mock.calls.find(
        (call) => (call[1] as RequestInit | undefined)?.method === 'PATCH'
      )
    ).toBeUndefined()
  })

  it('defaults to the Agent tab when agent work is already started', () => {
    installNoopEventSource()

    installRouteFetch({
      'GET /settings/provider': () => ({
        provider: { mode: 'cli', binaryPath: null }
      }),
      'GET /tasks/task-1/threads': () => ({ threads: [] })
    })

    renderWithProviders(
      <TaskView
        task={buildTask({
          agentState: 'working',
          id: 'task-1',
          status: 'in_progress'
        })}
      />,
      { initialEntries: ['/projects/project-1/tasks/task-1'] }
    )

    expect(
      screen.getByRole('tab', { name: /agent/i })
    ).toHaveAttribute('data-state', 'active')
  })

  it('defaults to the Agent tab when task has an existing thread', async () => {
    installNoopEventSource()

    const existingThread = buildThread({
      id: 'thread-existing',
      status: 'idle'
    })

    installRouteFetch({
      'GET /settings/provider': () => ({
        provider: { mode: 'cli', binaryPath: null }
      }),
      'GET /tasks/task-1/threads': () => ({
        threads: [existingThread]
      }),
      'GET /threads/thread-existing': () => ({
        events: [],
        thread: existingThread
      })
    })

    renderWithProviders(
      <TaskView
        task={buildTask({
          agentState: 'idle',
          id: 'task-1',
          status: 'todo'
        })}
      />,
      { initialEntries: ['/projects/project-1/tasks/task-1'] }
    )

    await waitFor(() => {
      expect(
        screen.getByRole('tab', { name: /agent/i })
      ).toHaveAttribute('data-state', 'active')
    })
  })

  it('switches to the Agent tab after Start Work succeeds', async () => {
    installNoopEventSource()

    const user = userEvent.setup()
    const newThread = buildThread({ id: 'thread-new' })
    let threadsForTask: Thread[] = []

    installRouteFetch({
      'GET /settings/provider': () => ({
        provider: { mode: 'cli', binaryPath: null }
      }),
      'GET /tasks/task-1/threads': () => ({ threads: threadsForTask }),
      'POST /tasks/task-1/threads': () => {
        threadsForTask = [newThread]
        return { thread: newThread }
      },
      'GET /threads/thread-new': () => ({ thread: newThread, events: [] })
    })

    renderWithProviders(
      <TaskView task={buildTask({ id: 'task-1', status: 'todo' })} />,
      { initialEntries: ['/projects/project-1/tasks/task-1'] }
    )

    const startButton = await screen.findByRole('button', {
      name: /start work/i
    })

    await user.click(startButton)

    await waitFor(() => {
      expect(
        screen.getByRole('tab', { name: /agent/i })
      ).toHaveAttribute('data-state', 'active')
    })
  })

  it('stays on the Overview tab when Start Work fails', async () => {
    installNoopEventSource()

    const user = userEvent.setup()

    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString()
        const parsed = new URL(url)
        const method = init?.method ?? 'GET'
        const key = `${method} ${parsed.pathname}`

        if (key === 'GET /settings/provider') {
          return new Response(
            JSON.stringify({ provider: { mode: 'cli', binaryPath: null } }),
            { status: 200 }
          )
        }

        if (key === 'GET /tasks/task-1/threads') {
          return new Response(JSON.stringify({ threads: [] }), {
            status: 200
          })
        }

        if (key === 'POST /tasks/task-1/threads') {
          return new Response(
            JSON.stringify({ error: 'no provider configured' }),
            { status: 500 }
          )
        }

        return new Response(JSON.stringify({ error: 'not mocked' }), {
          status: 404
        })
      }
    )

    vi.stubGlobal('fetch', fetchMock)

    renderWithProviders(
      <TaskView task={buildTask({ id: 'task-1', status: 'todo' })} />,
      { initialEntries: ['/projects/project-1/tasks/task-1'] }
    )

    const startButton = await screen.findByRole('button', {
      name: /start work/i
    })

    await user.click(startButton)

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some((call) => {
          const init = call[1] as RequestInit | undefined
          return init?.method === 'POST'
        })
      ).toEqual(true)
    })

    expect(
      screen.getByRole('tab', { name: /overview/i })
    ).toHaveAttribute('data-state', 'active')
  })

  it('does not switch tabs when the status dropdown changes to In Progress', async () => {
    installNoopEventSource()

    const user = userEvent.setup()

    installRouteFetch({
      'GET /settings/provider': () => ({
        provider: { mode: 'cli', binaryPath: null }
      }),
      'GET /tasks/task-1/threads': () => ({ threads: [] }),
      'PATCH /tasks/task-1': () => ({
        task: buildTask({ id: 'task-1', status: 'in_progress' })
      })
    })

    renderWithProviders(
      <TaskView task={buildTask({ id: 'task-1', status: 'todo' })} />,
      { initialEntries: ['/projects/project-1/tasks/task-1'] }
    )

    const trigger = await screen.findByLabelText(/task status/i)

    await user.click(trigger)

    const option = await screen.findByRole('option', { name: /in progress/i })

    await user.click(option)

    await waitFor(() => {
      expect(
        screen.getByRole('tab', { name: /overview/i })
      ).toHaveAttribute('data-state', 'active')
    })
  })
})
