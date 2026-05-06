import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import { clearDraftStorage, useDraft } from './use-draft'

const STORAGE_PREFIX = 'code-monkey:draft:'

describe('useDraft', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  afterEach(() => {
    window.localStorage.clear()
  })

  test('starts empty when no draft is stored', () => {
    const { result } = renderHook(() => useDraft('thread-a'))

    expect(result.current.text).toEqual('')
  })

  test('hydrates from localStorage on mount', () => {
    window.localStorage.setItem(`${STORAGE_PREFIX}thread-a`, 'hello world')

    const { result } = renderHook(() => useDraft('thread-a'))

    expect(result.current.text).toEqual('hello world')
  })

  test('persists subsequent edits to localStorage', () => {
    const { result } = renderHook(() => useDraft('thread-a'))

    act(() => {
      result.current.setText('typing…')
    })

    expect(result.current.text).toEqual('typing…')
    expect(window.localStorage.getItem(`${STORAGE_PREFIX}thread-a`)).toEqual(
      'typing…'
    )
  })

  test('clearing wipes both memory and storage', () => {
    window.localStorage.setItem(`${STORAGE_PREFIX}thread-a`, 'half written')

    const { result } = renderHook(() => useDraft('thread-a'))

    act(() => {
      result.current.clear()
    })

    expect(result.current.text).toEqual('')
    expect(
      window.localStorage.getItem(`${STORAGE_PREFIX}thread-a`)
    ).toBeNull()
  })

  test('switching threads loads the matching draft', () => {
    window.localStorage.setItem(`${STORAGE_PREFIX}thread-a`, 'draft A')
    window.localStorage.setItem(`${STORAGE_PREFIX}thread-b`, 'draft B')

    const { result, rerender } = renderHook(
      ({ id }: { id: string }) => useDraft(id),
      { initialProps: { id: 'thread-a' } }
    )

    expect(result.current.text).toEqual('draft A')

    rerender({ id: 'thread-b' })

    expect(result.current.text).toEqual('draft B')
  })

  test('drafts for different threads do not collide', () => {
    const { result: a } = renderHook(() => useDraft('thread-a'))
    const { result: b } = renderHook(() => useDraft('thread-b'))

    act(() => {
      a.current.setText('alpha')
      b.current.setText('beta')
    })

    expect(window.localStorage.getItem(`${STORAGE_PREFIX}thread-a`)).toEqual(
      'alpha'
    )
    expect(window.localStorage.getItem(`${STORAGE_PREFIX}thread-b`)).toEqual(
      'beta'
    )
  })

  test('setting an empty string removes the storage entry', () => {
    window.localStorage.setItem(`${STORAGE_PREFIX}thread-a`, 'something')

    const { result } = renderHook(() => useDraft('thread-a'))

    act(() => {
      result.current.setText('')
    })

    expect(
      window.localStorage.getItem(`${STORAGE_PREFIX}thread-a`)
    ).toBeNull()
  })
})

describe('clearDraftStorage', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  test('removes the draft for the given threadId', () => {
    window.localStorage.setItem(`${STORAGE_PREFIX}thread-a`, 'draft A')
    window.localStorage.setItem(`${STORAGE_PREFIX}thread-b`, 'draft B')

    clearDraftStorage('thread-a')

    expect(
      window.localStorage.getItem(`${STORAGE_PREFIX}thread-a`)
    ).toBeNull()
    expect(window.localStorage.getItem(`${STORAGE_PREFIX}thread-b`)).toEqual(
      'draft B'
    )
  })
})
