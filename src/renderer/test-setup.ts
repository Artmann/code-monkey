import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, vi } from 'vitest'

if (typeof window !== 'undefined') {
  if (!window.matchMedia) {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn()
    }))
  }

  if (!('ResizeObserver' in window)) {
    class ResizeObserverMock {
      observe() {
        return undefined
      }
      unobserve() {
        return undefined
      }
      disconnect() {
        return undefined
      }
    }

    (window as unknown as { ResizeObserver: typeof ResizeObserverMock }).ResizeObserver =
      ResizeObserverMock
    ;(globalThis as unknown as { ResizeObserver: typeof ResizeObserverMock }).ResizeObserver =
      ResizeObserverMock
  }

  if (!window.HTMLElement.prototype.hasPointerCapture) {
    window.HTMLElement.prototype.hasPointerCapture = () => false
  }

  if (!window.HTMLElement.prototype.releasePointerCapture) {
    window.HTMLElement.prototype.releasePointerCapture = () => undefined
  }

  if (!window.HTMLElement.prototype.scrollIntoView) {
    window.HTMLElement.prototype.scrollIntoView = () => undefined
  }

  // jsdom doesn't ship EventSource. Components subscribing to SSE during a
  // test only need it to construct without throwing — no events are pushed.
  if (!('EventSource' in window)) {
    class EventSourceMock {
      readyState = 0
      url = ''
      withCredentials = false
      onopen: ((event: Event) => unknown) | null = null
      onmessage: ((event: MessageEvent) => unknown) | null = null
      onerror: ((event: Event) => unknown) | null = null

      constructor(url: string) {
        this.url = url
      }

      addEventListener() {
        return undefined
      }
      removeEventListener() {
        return undefined
      }
      dispatchEvent() {
        return false
      }
      close() {
        return undefined
      }
    }

    const target = window as unknown as { EventSource: typeof EventSourceMock }
    const globalTarget = globalThis as unknown as {
      EventSource: typeof EventSourceMock
    }

    target.EventSource = EventSourceMock
    globalTarget.EventSource = EventSourceMock
  }
}

afterEach(() => {
  cleanup()
})
