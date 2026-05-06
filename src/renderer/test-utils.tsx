import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, type RenderOptions } from '@testing-library/react'
import type { ReactElement, ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'

export function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false }
    }
  })
}

interface ProvidersProps {
  client?: QueryClient
  initialEntries?: string[]
  children: ReactNode
}

export function Providers({
  client,
  initialEntries = ['/'],
  children
}: ProvidersProps) {
  const queryClient = client ?? createTestQueryClient()

  return (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={initialEntries}>{children}</MemoryRouter>
    </QueryClientProvider>
  )
}

interface RenderWithProvidersOptions extends RenderOptions {
  queryClient?: QueryClient
  initialEntries?: string[]
}

export function renderWithProviders(
  ui: ReactElement,
  options: RenderWithProvidersOptions = {}
) {
  const { queryClient, initialEntries, ...renderOptions } = options

  return render(ui, {
    wrapper: ({ children }) => (
      <Providers
        client={queryClient}
        initialEntries={initialEntries}
      >
        {children}
      </Providers>
    ),
    ...renderOptions
  })
}

type FetchMock = ReturnType<typeof vi.fn>

export function mockApiBridge(port = 55_555) {
  const target = window as unknown as {
    codeMonkey: {
      apiPort: number
      selectFolder: FetchMock
      onNewTabRequested: FetchMock
    }
  }

  target.codeMonkey = {
    apiPort: port,
    selectFolder: vi.fn(),
    onNewTabRequested: vi.fn(() => {
      return () => {
        // no-op
      }
    })
  }
}

export function restoreApiBridge() {
  delete (window as unknown as { codeMonkey?: unknown }).codeMonkey
}

export function mockFetchJson(responses: Record<string, unknown>) {
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      const path = new URL(url).pathname + new URL(url).search
      const responseKey = Object.keys(responses).find((key) =>
        path.startsWith(key)
      )

      if (!responseKey) {
        return new Response(JSON.stringify({ error: 'Not mocked' }), {
          status: 404
        })
      }

      return new Response(JSON.stringify(responses[responseKey]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    }
  )

  vi.stubGlobal('fetch', fetchMock)

  return fetchMock
}
