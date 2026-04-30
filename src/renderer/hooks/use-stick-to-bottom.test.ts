import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { useStickToBottom } from './use-stick-to-bottom'

type ScrollableMetrics = {
  clientHeight: number
  scrollHeight: number
  scrollTop: number
}

const attachScrollable = (
  element: HTMLDivElement,
  metrics: ScrollableMetrics
) => {
  Object.defineProperty(element, 'scrollHeight', {
    configurable: true,
    get: () => metrics.scrollHeight
  })

  Object.defineProperty(element, 'clientHeight', {
    configurable: true,
    get: () => metrics.clientHeight
  })

  Object.defineProperty(element, 'scrollTop', {
    configurable: true,
    get: () => metrics.scrollTop,
    set: (value: number) => {
      metrics.scrollTop = value
    }
  })

  element.scrollTo = (options?: ScrollToOptions | number) => {
    if (typeof options === 'object' && options && 'top' in options) {
      metrics.scrollTop = options.top ?? metrics.scrollTop
    }
  }
}

const fireScroll = (element: HTMLElement) => {
  element.dispatchEvent(new Event('scroll'))
}

const setUp = (initialMetrics: ScrollableMetrics) => {
  const element = document.createElement('div')

  attachScrollable(element, initialMetrics)

  const { result, rerender } = renderHook(
    ({ value }: { value: number }) => useStickToBottom(value),
    { initialProps: { value: 0 } }
  )

  act(() => {
    result.current.scrollRef(element)
  })

  return { element, metrics: initialMetrics, rerender, result }
}

describe('useStickToBottom', () => {
  it('starts pinned with no new content', () => {
    const { result } = renderHook(({ value }) => useStickToBottom(value), {
      initialProps: { value: 0 }
    })

    expect(result.current.isPinned).toBe(true)
    expect(result.current.hasNewContent).toBe(false)
  })

  it('scrolls to bottom when dependency changes while pinned', () => {
    const { metrics, rerender, result } = setUp({
      clientHeight: 100,
      scrollHeight: 200,
      scrollTop: 100
    })

    metrics.scrollHeight = 500

    rerender({ value: 1 })

    expect(metrics.scrollTop).toBe(500)
    expect(result.current.isPinned).toBe(true)
    expect(result.current.hasNewContent).toBe(false)
  })

  it('flips to unpinned when the user scrolls up', () => {
    const { element, metrics, result } = setUp({
      clientHeight: 100,
      scrollHeight: 1000,
      scrollTop: 1000
    })

    act(() => {
      metrics.scrollTop = 100
      fireScroll(element)
    })

    expect(result.current.isPinned).toBe(false)
  })

  it('marks new content when dependency changes while unpinned', () => {
    const { element, metrics, rerender, result } = setUp({
      clientHeight: 100,
      scrollHeight: 1000,
      scrollTop: 1000
    })

    act(() => {
      metrics.scrollTop = 100
      fireScroll(element)
    })

    expect(result.current.isPinned).toBe(false)

    rerender({ value: 1 })

    expect(result.current.hasNewContent).toBe(true)
    expect(metrics.scrollTop).toBe(100)
  })

  it('scrollToBottom re-pins and clears the new-content flag', () => {
    const { element, metrics, rerender, result } = setUp({
      clientHeight: 100,
      scrollHeight: 1000,
      scrollTop: 1000
    })

    act(() => {
      metrics.scrollTop = 100
      fireScroll(element)
    })

    rerender({ value: 1 })

    expect(result.current.hasNewContent).toBe(true)

    act(() => {
      result.current.scrollToBottom('auto')
    })

    expect(metrics.scrollTop).toBe(1000)
    expect(result.current.isPinned).toBe(true)
    expect(result.current.hasNewContent).toBe(false)
  })

  it('re-pins when the user scrolls back near the bottom', () => {
    const { element, metrics, result } = setUp({
      clientHeight: 100,
      scrollHeight: 1000,
      scrollTop: 1000
    })

    act(() => {
      metrics.scrollTop = 100
      fireScroll(element)
    })

    expect(result.current.isPinned).toBe(false)

    act(() => {
      metrics.scrollTop = 900
      fireScroll(element)
    })

    expect(result.current.isPinned).toBe(true)
    expect(result.current.hasNewContent).toBe(false)
  })
})
