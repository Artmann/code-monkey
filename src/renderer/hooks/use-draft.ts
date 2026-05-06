import { useCallback, useState } from 'react'

// Persisted composer drafts so a refresh / restart never throws away a
// half-written prompt. One slot per thread id, keyed in localStorage.
const STORAGE_PREFIX = 'code-monkey:draft:'

const draftKeyFor = (threadId: string): string => `${STORAGE_PREFIX}${threadId}`

const readDraft = (threadId: string): string => {
  try {
    return window.localStorage.getItem(draftKeyFor(threadId)) ?? ''
  } catch {
    return ''
  }
}

const writeDraft = (threadId: string, text: string): void => {
  try {
    if (text === '') {
      window.localStorage.removeItem(draftKeyFor(threadId))

      return
    }

    window.localStorage.setItem(draftKeyFor(threadId), text)
  } catch {
    // Storage quota or privacy mode — drafts are best-effort, not load-bearing.
  }
}

export const clearDraftStorage = (threadId: string): void => {
  try {
    window.localStorage.removeItem(draftKeyFor(threadId))
  } catch {
    // ignore
  }
}

export type DraftHandle = {
  /** The current draft text (lifted state). */
  text: string
  /** Replace the draft text and persist it. */
  setText: (next: string) => void
  /** Clear the draft (memory + storage). Call after a successful send. */
  clear: () => void
}

export function useDraft(threadId: string | null | undefined): DraftHandle {
  // Lazy initialiser hits localStorage exactly once per mount so the
  // textarea renders with the correct draft on the very first paint —
  // no flicker between empty and restored content.
  const [text, setTextState] = useState<string>(() =>
    threadId ? readDraft(threadId) : ''
  )
  const [trackedThreadId, setTrackedThreadId] = useState<
    string | null | undefined
  >(threadId)

  // Reset-state-on-prop-change pattern: when the active thread switches we
  // reload the matching draft during render. React discards the first render
  // and re-runs with the new state, so this is cheaper than chaining a
  // useEffect just to call setState.
  if (trackedThreadId !== threadId) {
    setTrackedThreadId(threadId)
    setTextState(threadId ? readDraft(threadId) : '')
  }

  const setText = useCallback(
    (next: string) => {
      setTextState(next)

      if (threadId) {
        writeDraft(threadId, next)
      }
    },
    [threadId]
  )

  const clear = useCallback(() => {
    setTextState('')

    if (threadId) {
      clearDraftStorage(threadId)
    }
  }, [threadId])

  return { text, setText, clear }
}
