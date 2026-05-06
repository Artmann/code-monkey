import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  type ClipboardEvent,
  type KeyboardEvent,
  type Ref
} from 'react'

import { cn } from '@/lib/utils'

// A lightweight rich-text composer that lets users paste images inline.
// We use a contenteditable <div> rather than a <textarea> because textareas
// cannot render embedded media — the user wants images to appear between
// lines of text, which only works inside a contenteditable host.
//
// The component is uncontrolled: the DOM is the source of truth. The parent
// gets change notifications via `onChange` carrying a snapshot { text,
// imageCount }, and reads/clears the editor through an imperative handle.
// This keeps React out of every keystroke (controlled contenteditable is
// notoriously fragile) while still letting parents persist drafts and
// enable/disable submit based on content.

export type RichComposerSnapshot = {
  text: string
  imageCount: number
}

export type RichComposerHandle = {
  focus: () => void
  clear: () => void
  getSnapshot: () => RichComposerSnapshot
}

export type RichComposerProps = {
  ref?: Ref<RichComposerHandle>
  initialText?: string
  placeholder?: string
  disabled?: boolean
  className?: string
  ariaLabel?: string
  onChange?: (snapshot: RichComposerSnapshot) => void
  onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void
}

const PASTED_IMAGE_CLASS = 'rich-composer-image'

// Walk the editor DOM and produce a plain-text snapshot plus an image count.
// We honour <br> as newlines and treat block-level wrappers (which browsers
// may inject when the user presses Enter) as paragraph breaks. Images don't
// contribute to the text content but bump the image counter — the parent can
// use that to decide whether to show "image present" affordances.
function readSnapshot(root: HTMLElement): RichComposerSnapshot {
  let text = ''
  let imageCount = 0

  const ensureNewlineBefore = () => {
    if (text.length > 0 && !text.endsWith('\n')) {
      text += '\n'
    }
  }

  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.textContent ?? ''

      return
    }

    if (node.nodeType !== Node.ELEMENT_NODE) {
      return
    }

    const element = node as HTMLElement
    const tag = element.tagName

    if (tag === 'BR') {
      text += '\n'

      return
    }

    if (tag === 'IMG') {
      imageCount += 1

      return
    }

    const isBlock = tag === 'DIV' || tag === 'P'

    if (isBlock) {
      ensureNewlineBefore()
    }

    for (const child of Array.from(element.childNodes)) {
      walk(child)
    }
  }

  for (const child of Array.from(root.childNodes)) {
    walk(child)
  }

  return { text, imageCount }
}

// Insert a node at the current selection, replacing any selected content,
// then collapse the cursor to just after the inserted node. Falls back to
// appending at the end when the editor isn't focused (no live selection).
function insertNodeAtCursor(root: HTMLElement, node: Node) {
  const selection = window.getSelection()
  const range = selection?.rangeCount ? selection.getRangeAt(0) : null

  const isInsideEditor =
    range !== null &&
    (range.commonAncestorContainer === root ||
      root.contains(range.commonAncestorContainer))

  if (selection && range && isInsideEditor) {
    range.deleteContents()
    range.insertNode(node)
    range.setStartAfter(node)
    range.setEndAfter(node)
    selection.removeAllRanges()
    selection.addRange(range)

    return
  }

  root.appendChild(node)
}

// Extract image File objects from a clipboard payload. We deliberately accept
// only items the browser surfaces as files (`kind === 'file'`) — text-only
// pastes carry images solely as `text/html`, which would just be a remote URL
// reference and wouldn't give us a local preview anyway.
function collectImageFiles(clipboardData: DataTransfer | null): File[] {
  if (!clipboardData) {
    return []
  }

  const files: File[] = []

  for (const item of Array.from(clipboardData.items)) {
    if (item.kind !== 'file') {
      continue
    }

    if (!item.type.startsWith('image/')) {
      continue
    }

    const file = item.getAsFile()

    if (file) {
      files.push(file)
    }
  }

  return files
}

export function RichComposer({
  ref,
  initialText,
  placeholder,
  disabled,
  className,
  ariaLabel,
  onChange,
  onKeyDown
}: RichComposerProps) {
  const editorRef = useRef<HTMLDivElement>(null)
  const objectUrlsRef = useRef<string[]>([])

  // Hydrate the editor with the initial text exactly once on mount. We avoid
  // re-syncing on every render because mutating innerText/innerHTML on a
  // focused contenteditable destroys the user's caret position.
  useEffect(() => {
    const element = editorRef.current

    if (!element) {
      return
    }

    if (initialText && initialText.length > 0) {
      element.textContent = initialText
    }

    updateEmptyState(element)

    // We intentionally only run on mount — initialText is a hydration seed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Revoke any object URLs we minted for inline previews when the editor
  // unmounts, so we don't leak memory on long-running sessions.
  useEffect(() => {
    const urls = objectUrlsRef.current

    return () => {
      for (const url of urls) {
        URL.revokeObjectURL(url)
      }
    }
  }, [])

  const emitChange = useCallback(() => {
    const element = editorRef.current

    if (!element) {
      return
    }

    updateEmptyState(element)

    if (onChange) {
      onChange(readSnapshot(element))
    }
  }, [onChange])

  const insertImageFromFile = useCallback((file: File) => {
    const element = editorRef.current

    if (!element) {
      return
    }

    const url = URL.createObjectURL(file)
    objectUrlsRef.current.push(url)

    const image = document.createElement('img')
    image.src = url
    image.alt = file.name || 'Pasted image'
    image.className = PASTED_IMAGE_CLASS
    image.dataset.mimeType = file.type
    image.draggable = false

    insertNodeAtCursor(element, image)
  }, [])

  const handlePaste = useCallback(
    (event: ClipboardEvent<HTMLDivElement>) => {
      const imageFiles = collectImageFiles(event.clipboardData)

      if (imageFiles.length === 0) {
        // Let the browser handle plain-text paste — we don't want to
        // re-implement clipboard plain-text semantics.
        return
      }

      event.preventDefault()

      for (const file of imageFiles) {
        insertImageFromFile(file)
      }

      emitChange()
    },
    [emitChange, insertImageFromFile]
  )

  const handleInput = useCallback(() => {
    emitChange()
  }, [emitChange])

  useImperativeHandle(
    ref,
    () => ({
      focus: () => {
        const element = editorRef.current

        if (!element) {
          return
        }

        element.focus()

        // Move the caret to the end so a restored draft doesn't trap the
        // user typing in the middle of their previous prompt.
        const range = document.createRange()
        range.selectNodeContents(element)
        range.collapse(false)

        const selection = window.getSelection()

        if (selection) {
          selection.removeAllRanges()
          selection.addRange(range)
        }
      },
      clear: () => {
        const element = editorRef.current

        if (!element) {
          return
        }

        element.innerHTML = ''

        for (const url of objectUrlsRef.current) {
          URL.revokeObjectURL(url)
        }

        objectUrlsRef.current = []

        emitChange()
      },
      getSnapshot: () => {
        const element = editorRef.current

        if (!element) {
          return { text: '', imageCount: 0 }
        }

        return readSnapshot(element)
      }
    }),
    [emitChange]
  )

  return (
    <div
      ref={editorRef}
      role="textbox"
      aria-label={ariaLabel}
      aria-multiline="true"
      contentEditable={!disabled}
      suppressContentEditableWarning
      data-placeholder={placeholder}
      data-empty="true"
      onInput={handleInput}
      onPaste={handlePaste}
      onKeyDown={onKeyDown}
      spellCheck
      className={cn('rich-composer', className)}
    />
  )
}

function updateEmptyState(element: HTMLElement) {
  const snapshot = readSnapshot(element)
  const isEmpty = snapshot.text.trim().length === 0 && snapshot.imageCount === 0

  element.dataset.empty = isEmpty ? 'true' : 'false'
}
