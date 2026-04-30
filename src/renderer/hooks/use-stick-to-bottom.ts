import { useCallback, useEffect, useRef, useState } from 'react'
import invariant from 'tiny-invariant'

const PIN_THRESHOLD_PIXELS = 32

export type UseStickToBottomResult = {
  hasNewContent: boolean
  isPinned: boolean
  scrollRef: (node: HTMLDivElement | null) => void
  scrollToBottom: (behavior?: ScrollBehavior) => void
}

const isAtBottom = (element: HTMLElement) => {
  const distance =
    element.scrollHeight - element.scrollTop - element.clientHeight

  return distance <= PIN_THRESHOLD_PIXELS
}

export function useStickToBottom(dependency: unknown): UseStickToBottomResult {
  const [element, setElement] = useState<HTMLDivElement | null>(null)

  const isPinnedRef = useRef(true)
  const [isPinned, setIsPinned] = useState(true)
  const [hasNewContent, setHasNewContent] = useState(false)

  const updatePinned = useCallback((pinned: boolean) => {
    isPinnedRef.current = pinned
    setIsPinned(pinned)
  }, [])

  const scrollRef = useCallback((node: HTMLDivElement | null) => {
    setElement(node)
  }, [])

  const scrollToBottom = useCallback(
    (behavior: ScrollBehavior = 'auto') => {
      invariant(element, 'scrollRef must be attached before scrollToBottom')

      element.scrollTo({ top: element.scrollHeight, behavior })

      updatePinned(true)
      setHasNewContent(false)
    },
    [element, updatePinned]
  )

  useEffect(() => {
    if (!element) {
      return
    }

    const handleScroll = () => {
      const pinned = isAtBottom(element)

      if (pinned === isPinnedRef.current) {
        if (pinned) {
          setHasNewContent(false)
        }

        return
      }

      updatePinned(pinned)

      if (pinned) {
        setHasNewContent(false)
      }
    }

    element.addEventListener('scroll', handleScroll, { passive: true })

    return () => {
      element.removeEventListener('scroll', handleScroll)
    }
  }, [element, updatePinned])

  useEffect(() => {
    if (!element) {
      return
    }

    if (isPinnedRef.current) {
      element.scrollTo({ top: element.scrollHeight, behavior: 'auto' })

      return
    }

    setHasNewContent(true)
  }, [dependency, element])

  return { hasNewContent, isPinned, scrollRef, scrollToBottom }
}
