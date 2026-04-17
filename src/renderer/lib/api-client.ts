import invariant from 'tiny-invariant'
import type { CodeMonkeyBridge } from '../../preload/preload'

declare global {
  interface Window {
    codeMonkey: CodeMonkeyBridge
  }
}

function getBaseUrl(): string {
  const port = window.codeMonkey?.apiPort
  invariant(port && port > 0, 'API port not available on window.codeMonkey')

  return `http://127.0.0.1:${port}`
}

export async function apiFetch<T>(
  path: string,
  init?: RequestInit
): Promise<T> {
  const response = await fetch(`${getBaseUrl()}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers
    },
    ...init
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`API ${path} failed (${response.status}): ${text}`)
  }

  return (await response.json()) as T
}
