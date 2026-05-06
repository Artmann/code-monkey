import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { mockApiBridge, mockFetchJson, restoreApiBridge } from '../test-utils'
import {
  useProviderSettingsQuery,
  useSaveProviderMutation,
  useClearProviderMutation
} from './use-provider-settings'

const createClient = () =>
  new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } }
  })

const wrapper = (client: QueryClient) => {
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )

  return Wrapper
}

describe('useProviderSettingsQuery', () => {
  beforeEach(() => {
    mockApiBridge()
  })

  afterEach(() => {
    restoreApiBridge()
    vi.unstubAllGlobals()
  })

  test('returns null when the server says the provider is not configured', async () => {
    mockFetchJson({ '/settings/provider': { provider: null } })

    const client = createClient()
    const { result } = renderHook(() => useProviderSettingsQuery(), {
      wrapper: wrapper(client)
    })

    await waitFor(() => expect(result.current.isSuccess).toEqual(true))

    expect(result.current.data).toEqual(null)
  })

  test('returns the CLI summary when one is saved', async () => {
    mockFetchJson({
      '/settings/provider': {
        provider: { mode: 'cli', binaryPath: '/usr/bin/codex' }
      }
    })

    const client = createClient()
    const { result } = renderHook(() => useProviderSettingsQuery(), {
      wrapper: wrapper(client)
    })

    await waitFor(() => expect(result.current.isSuccess).toEqual(true))

    expect(result.current.data).toEqual({
      mode: 'cli',
      binaryPath: '/usr/bin/codex'
    })
  })
})

describe('useSaveProviderMutation', () => {
  beforeEach(() => {
    mockApiBridge()
  })

  afterEach(() => {
    restoreApiBridge()
    vi.unstubAllGlobals()
  })

  test('posts to /settings/provider and invalidates the query', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()
      const path = new URL(url).pathname

      if (path === '/settings/provider') {
        return new Response(
          JSON.stringify({
            provider: { mode: 'api', hasApiKey: true }
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      }

      return new Response('not mocked', { status: 404 })
    })

    vi.stubGlobal('fetch', fetchMock)

    const client = createClient()
    const { result } = renderHook(() => useSaveProviderMutation(), {
      wrapper: wrapper(client)
    })

    await act(async () => {
      await result.current.mutateAsync({
        kind: 'codex',
        mode: 'api',
        apiKey: 'sk-secret'
      })
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)

    const [firstCall] = fetchMock.mock.calls
    const request = firstCall?.at(1) as RequestInit | undefined

    expect(request?.method).toEqual('POST')
    expect(request?.body).toEqual(
      JSON.stringify({ kind: 'codex', mode: 'api', apiKey: 'sk-secret' })
    )
  })
})

describe('useClearProviderMutation', () => {
  beforeEach(() => {
    mockApiBridge()
  })

  afterEach(() => {
    restoreApiBridge()
    vi.unstubAllGlobals()
  })

  test('DELETEs /settings/provider', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
    )

    vi.stubGlobal('fetch', fetchMock)

    const client = createClient()
    const { result } = renderHook(() => useClearProviderMutation(), {
      wrapper: wrapper(client)
    })

    await act(async () => {
      await result.current.mutateAsync()
    })

    const [firstCall] = fetchMock.mock.calls
    const request = firstCall?.at(1) as RequestInit | undefined

    expect(request?.method).toEqual('DELETE')
  })
})
