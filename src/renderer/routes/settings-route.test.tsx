import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import {
  mockApiBridge,
  mockFetchJson,
  renderWithProviders,
  restoreApiBridge
} from '../test-utils'
import { SettingsRoute } from './settings-route'

describe('SettingsRoute', () => {
  beforeEach(() => {
    mockApiBridge()
  })

  afterEach(() => {
    restoreApiBridge()
    vi.unstubAllGlobals()
  })

  test('tells the user when no provider is configured', async () => {
    mockFetchJson({ '/settings/provider': { provider: null } })

    renderWithProviders(<SettingsRoute />, { initialEntries: ['/settings'] })

    expect(
      await screen.findByText(/no provider configured/i)
    ).toBeInTheDocument()
  })

  test('renders the current Codex CLI configuration', async () => {
    mockFetchJson({
      '/settings/provider': {
        provider: { kind: 'codex', mode: 'cli', binaryPath: '/usr/bin/codex' }
      }
    })

    renderWithProviders(<SettingsRoute />, { initialEntries: ['/settings'] })

    await screen.findByDisplayValue('/usr/bin/codex')
    expect(screen.getByRole('radio', { name: /codex cli/i })).toBeChecked()
  })

  test('saving in API mode POSTs the key and shows the stored-key state', async () => {
    const user = userEvent.setup()

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      const path = new URL(url).pathname

      if (path === '/settings/provider' && (init?.method ?? 'GET') === 'GET') {
        return new Response(JSON.stringify({ provider: null }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      }

      if (path === '/settings/provider' && init?.method === 'POST') {
        return new Response(
          JSON.stringify({
            provider: { kind: 'codex', mode: 'api', hasApiKey: true }
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          }
        )
      }

      return new Response('nope', { status: 404 })
    })

    vi.stubGlobal('fetch', fetchMock)

    renderWithProviders(<SettingsRoute />, { initialEntries: ['/settings'] })

    await screen.findByText(/no provider configured/i)

    await user.click(screen.getByRole('radio', { name: /openai api key/i }))
    await user.type(
      screen.getByLabelText(/^api key$/i),
      'sk-secret'
    )
    await user.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            kind: 'codex',
            mode: 'api',
            apiKey: 'sk-secret'
          })
        })
      )
    })

    expect(
      await screen.findByText(/api key is stored/i)
    ).toBeInTheDocument()
  })

  test('selecting Claude Code and saving Anthropic API key POSTs the right body', async () => {
    const user = userEvent.setup()

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      const path = new URL(url).pathname

      if (path === '/settings/provider' && (init?.method ?? 'GET') === 'GET') {
        return new Response(JSON.stringify({ provider: null }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      }

      if (path === '/settings/provider' && init?.method === 'POST') {
        return new Response(
          JSON.stringify({
            provider: { kind: 'claude-code', mode: 'api', hasApiKey: true }
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          }
        )
      }

      return new Response('nope', { status: 404 })
    })

    vi.stubGlobal('fetch', fetchMock)

    renderWithProviders(<SettingsRoute />, { initialEntries: ['/settings'] })

    await screen.findByText(/no provider configured/i)

    await user.click(screen.getByRole('radio', { name: /^claude code$/i }))
    await user.click(
      screen.getByRole('radio', { name: /anthropic api key/i })
    )
    await user.type(screen.getByLabelText(/^api key$/i), 'sk-ant-secret')
    await user.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            kind: 'claude-code',
            mode: 'api',
            apiKey: 'sk-ant-secret'
          })
        })
      )
    })
  })

  test('surfaces server error messages', async () => {
    const user = userEvent.setup()

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      const path = new URL(url).pathname

      if (path === '/settings/provider' && (init?.method ?? 'GET') === 'GET') {
        return new Response(JSON.stringify({ provider: null }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      }

      if (path === '/settings/provider' && init?.method === 'POST') {
        return new Response(
          JSON.stringify({
            error: 'OS encryption is not available on this machine.'
          }),
          {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
          }
        )
      }

      return new Response('nope', { status: 404 })
    })

    vi.stubGlobal('fetch', fetchMock)

    renderWithProviders(<SettingsRoute />, { initialEntries: ['/settings'] })

    await screen.findByText(/no provider configured/i)

    await user.click(screen.getByRole('radio', { name: /openai api key/i }))
    await user.type(screen.getByLabelText(/^api key$/i), 'sk-secret')
    await user.click(screen.getByRole('button', { name: /save/i }))

    expect(
      await screen.findByText(/os encryption is not available/i)
    ).toBeInTheDocument()
  })
})
