import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import {
  mockApiBridge,
  mockFetchJson,
  restoreApiBridge
} from '../test-utils'
import {
  threadKey,
  threadsKey,
  useCloseThreadMutation,
  useCreateThreadMutation,
  useSendMessageMutation,
  useThreadQuery,
  useThreadStream,
  useThreadsQuery,
  useUpdateThreadMutation,
  type Thread,
  type ThreadEvent
} from './use-thread'

type Handler = (event: { data: string }) => void

type MockEventSourceInstance = {
  url: string
  listeners: Map<string, Handler>
  onmessage: Handler | null
  closed: boolean
  emit: (typeName: string, payload: string) => void
  close: () => void
}

const installMockEventSource = () => {
  const instances: MockEventSourceInstance[] = []

  class MockEventSource {
    url: string
    listeners = new Map<string, Handler>()
    onmessage: Handler | null = null
    onerror: (() => void) | null = null
    closed = false

    constructor(url: string) {
      this.url = url
      instances.push(this as unknown as MockEventSourceInstance)
    }

    addEventListener(typeName: string, handler: Handler) {
      this.listeners.set(typeName, handler)
    }

    emit(typeName: string, payload: string) {
      const listener = this.listeners.get(typeName)

      if (listener) {
        listener({ data: payload })
      } else if (this.onmessage) {
        this.onmessage({ data: payload })
      }
    }

    close() {
      this.closed = true
    }
  }

  vi.stubGlobal('EventSource', MockEventSource)

  return instances
}

const buildThread = (overrides: Partial<Thread> = {}): Thread => ({
  id: 'thread-1',
  name: 'project',
  directoryPath: '/tmp/project',
  provider: 'claude-code',
  externalThreadId: null,
  status: 'idle',
  errorMessage: null,
  tabOrder: 0,
  closedAt: null,
  createdAt: new Date(0).toISOString(),
  lastActivityAt: new Date(0).toISOString(),
  ...overrides
})

const buildEvent = (overrides: Partial<ThreadEvent> = {}): ThreadEvent => ({
  id: 'event-1',
  threadId: 'thread-1',
  sequence: 0,
  type: 'prep',
  payload: {},
  createdAt: new Date(0).toISOString(),
  ...overrides
})

const createClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity, staleTime: 0 }
    }
  })

const wrapper = (client: QueryClient) => {
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )

  return Wrapper
}

describe('useThreadsQuery', () => {
  beforeEach(() => {
    mockApiBridge()
  })

  afterEach(() => {
    restoreApiBridge()
    vi.unstubAllGlobals()
  })

  test('fetches the list of threads', async () => {
    const threads = [buildThread({ id: 'a' }), buildThread({ id: 'b' })]

    mockFetchJson({ '/threads': { threads } })

    const client = createClient()
    const { result } = renderHook(() => useThreadsQuery(), {
      wrapper: wrapper(client)
    })

    await waitFor(() => expect(result.current.isSuccess).toEqual(true))

    expect(result.current.data).toEqual(threads)
  })
})

describe('useThreadQuery', () => {
  beforeEach(() => {
    mockApiBridge()
  })

  afterEach(() => {
    restoreApiBridge()
    vi.unstubAllGlobals()
  })

  test('is disabled when threadId is null', async () => {
    const fetchMock = vi.fn()

    vi.stubGlobal('fetch', fetchMock)

    const client = createClient()

    renderHook(() => useThreadQuery(null), { wrapper: wrapper(client) })

    expect(fetchMock).not.toHaveBeenCalled()
  })

  test('fetches the thread and events by id', async () => {
    mockFetchJson({
      '/threads/thread-1': {
        thread: buildThread(),
        events: [buildEvent({ id: 'e0', sequence: 0 })]
      }
    })

    const client = createClient()
    const { result } = renderHook(() => useThreadQuery('thread-1'), {
      wrapper: wrapper(client)
    })

    await waitFor(() => expect(result.current.isSuccess).toEqual(true))

    expect(result.current.data?.thread.id).toEqual('thread-1')
    expect(result.current.data?.events).toHaveLength(1)
  })
})

describe('useThreadStream', () => {
  beforeEach(() => {
    mockApiBridge()
  })

  afterEach(() => {
    restoreApiBridge()
    vi.unstubAllGlobals()
  })

  test('subscribes to the right URL and appends events into the query cache', async () => {
    const instances = installMockEventSource()
    const client = createClient()

    client.setQueryData(threadKey('thread-1'), {
      thread: buildThread(),
      events: [buildEvent({ id: 'e0', sequence: 0, type: 'prep' })]
    })

    renderHook(() => useThreadStream('thread-1'), {
      wrapper: wrapper(client)
    })

    await waitFor(() => expect(instances).toHaveLength(1))

    const source = instances.at(0)

    if (!source) {
      throw new Error('EventSource was not created')
    }

    expect(source.url).toMatch(/\/threads\/thread-1\/stream$/)

    act(() => {
      source.emit(
        'item.completed',
        JSON.stringify(
          buildEvent({
            id: 'e1',
            sequence: 1,
            type: 'item.completed',
            payload: { item: { id: 'x', type: 'agent_message', text: 'hi' } }
          })
        )
      )
    })

    await waitFor(() => {
      const cached = client.getQueryData<{
        thread: Thread
        events: ThreadEvent[]
      } | null>(threadKey('thread-1'))

      expect(cached?.events.map((event) => event.sequence)).toEqual([0, 1])
    })
  })

  test('does not duplicate an event if its sequence already exists', async () => {
    const instances = installMockEventSource()
    const client = createClient()

    client.setQueryData(threadKey('thread-1'), {
      thread: buildThread(),
      events: [buildEvent({ id: 'e0', sequence: 0, type: 'prep' })]
    })

    renderHook(() => useThreadStream('thread-1'), {
      wrapper: wrapper(client)
    })

    await waitFor(() => expect(instances).toHaveLength(1))

    const source = instances.at(0)

    if (!source) {
      throw new Error('EventSource was not created')
    }

    act(() => {
      source.emit(
        'prep',
        JSON.stringify(buildEvent({ id: 'e0-dup', sequence: 0, type: 'prep' }))
      )
    })

    const cached = client.getQueryData<{
      thread: Thread
      events: ThreadEvent[]
    } | null>(threadKey('thread-1'))

    expect(cached?.events).toHaveLength(1)
  })

  test('does not subscribe when threadId is null', () => {
    const instances = installMockEventSource()
    const client = createClient()

    renderHook(() => useThreadStream(null), { wrapper: wrapper(client) })

    expect(instances).toHaveLength(0)
  })
})

describe('useCreateThreadMutation', () => {
  beforeEach(() => {
    mockApiBridge()
  })

  afterEach(() => {
    restoreApiBridge()
    vi.unstubAllGlobals()
  })

  test('POSTs to /threads and seeds the cache', async () => {
    const thread = buildThread({ id: 'new', directoryPath: '/Users/x/site' })

    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString()

        if (url.endsWith('/threads') && init?.method === 'POST') {
          return new Response(JSON.stringify({ thread }), {
            status: 201,
            headers: { 'Content-Type': 'application/json' }
          })
        }

        return new Response('nope', { status: 404 })
      }
    )

    vi.stubGlobal('fetch', fetchMock)

    const client = createClient()
    const { result } = renderHook(() => useCreateThreadMutation(), {
      wrapper: wrapper(client)
    })

    await act(async () => {
      await result.current.mutateAsync({ directoryPath: '/Users/x/site' })
    })

    expect(client.getQueryData(threadKey(thread.id))).toEqual({
      thread,
      events: []
    })
  })
})

describe('useUpdateThreadMutation', () => {
  beforeEach(() => {
    mockApiBridge()
  })

  afterEach(() => {
    restoreApiBridge()
    vi.unstubAllGlobals()
  })

  test('PATCHes /threads/:id with the patch body', async () => {
    const thread = buildThread({ name: 'renamed' })

    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ thread }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    )

    vi.stubGlobal('fetch', fetchMock)

    const client = createClient()
    const { result } = renderHook(() => useUpdateThreadMutation(), {
      wrapper: wrapper(client)
    })

    await act(async () => {
      await result.current.mutateAsync({
        threadId: 'thread-1',
        name: 'renamed'
      })
    })

    const [call] = fetchMock.mock.calls
    const url = call?.at(0) as string | undefined
    const init = call?.at(1) as RequestInit | undefined

    expect(url).toContain('/threads/thread-1')
    expect(init?.method).toEqual('PATCH')
    expect(init?.body).toEqual(JSON.stringify({ name: 'renamed' }))
  })
})

describe('useCloseThreadMutation', () => {
  beforeEach(() => {
    mockApiBridge()
  })

  afterEach(() => {
    restoreApiBridge()
    vi.unstubAllGlobals()
  })

  test('DELETEs /threads/:id and invalidates the list', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    )

    vi.stubGlobal('fetch', fetchMock)

    const client = createClient()
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries')

    const { result } = renderHook(() => useCloseThreadMutation(), {
      wrapper: wrapper(client)
    })

    await act(async () => {
      await result.current.mutateAsync('thread-1')
    })

    const [call] = fetchMock.mock.calls
    const url = call?.at(0) as string | undefined
    const init = call?.at(1) as RequestInit | undefined

    expect(url).toContain('/threads/thread-1')
    expect(init?.method).toEqual('DELETE')
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: threadsKey })
  })
})

describe('useSendMessageMutation', () => {
  beforeEach(() => {
    mockApiBridge()
  })

  afterEach(() => {
    restoreApiBridge()
    vi.unstubAllGlobals()
  })

  test('POSTs the message text to /threads/:id/messages', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 202,
        headers: { 'Content-Type': 'application/json' }
      })
    )

    vi.stubGlobal('fetch', fetchMock)

    const client = createClient()
    const { result } = renderHook(() => useSendMessageMutation(), {
      wrapper: wrapper(client)
    })

    await act(async () => {
      await result.current.mutateAsync({
        threadId: 'thread-1',
        text: 'keep going'
      })
    })

    const [call] = fetchMock.mock.calls
    const url = call?.at(0) as string | undefined
    const init = call?.at(1) as RequestInit | undefined

    expect(url).toContain('/threads/thread-1/messages')
    expect(init?.method).toEqual('POST')
    expect(init?.body).toEqual(JSON.stringify({ text: 'keep going' }))
  })
})
