import { fireEvent, render } from '@testing-library/react'
import { createRef } from 'react'
import { describe, expect, it, vi } from 'vitest'

import {
  RichComposer,
  type RichComposerHandle,
  type RichComposerSnapshot
} from './rich-composer'

const lastSnapshot = (
  fn: ReturnType<typeof vi.fn>
): RichComposerSnapshot | null => {
  const calls = fn.mock.calls

  const lastCall = calls[calls.length - 1]

  if (!lastCall) {
    return null
  }

  return lastCall[0] as RichComposerSnapshot
}

const createImageClipboardEvent = (file: File) => {
  // jsdom doesn't ship a working DataTransfer, so synthesize the minimal
  // shape our component reads (kind/type/getAsFile + an iterable items list).
  const item = {
    kind: 'file' as const,
    type: file.type,
    getAsFile: () => file
  }

  const items = [item] as unknown as DataTransferItemList

  return {
    clipboardData: {
      items,
      types: ['Files'],
      files: [file],
      getData: () => ''
    } as unknown as DataTransfer
  }
}

describe('RichComposer', () => {
  it('renders the placeholder while empty', () => {
    const { container } = render(
      <RichComposer placeholder="Tell the agent what to do…" />
    )

    const editor = container.querySelector('.rich-composer')

    expect(editor).not.toBeNull()
    expect(editor?.getAttribute('data-empty')).toEqual('true')
    expect(editor?.getAttribute('data-placeholder')).toEqual(
      'Tell the agent what to do…'
    )
  })

  it('hydrates with initialText on mount', () => {
    const { container } = render(<RichComposer initialText="hello world" />)

    const editor = container.querySelector('.rich-composer')

    expect(editor?.textContent).toEqual('hello world')
    expect(editor?.getAttribute('data-empty')).toEqual('false')
  })

  it('emits onChange snapshots reflecting text content on input', () => {
    const handleChange = vi.fn<(snapshot: RichComposerSnapshot) => void>()

    const { container } = render(<RichComposer onChange={handleChange} />)

    const editor = container.querySelector('.rich-composer') as HTMLDivElement

    editor.textContent = 'plan the migration'
    fireEvent.input(editor)

    expect(lastSnapshot(handleChange)).toEqual({
      text: 'plan the migration',
      imageCount: 0
    })
  })

  it('inserts an inline <img> when an image is pasted', () => {
    const handleChange = vi.fn<(snapshot: RichComposerSnapshot) => void>()

    const { container } = render(<RichComposer onChange={handleChange} />)

    const editor = container.querySelector('.rich-composer') as HTMLDivElement

    editor.focus()

    const file = new File(['fake'], 'screenshot.png', { type: 'image/png' })

    fireEvent.paste(editor, createImageClipboardEvent(file))

    const image = editor.querySelector('img')

    expect(image).not.toBeNull()
    expect(image?.classList.contains('rich-composer-image')).toBe(true)
    expect(image?.dataset.mimeType).toEqual('image/png')
    expect(lastSnapshot(handleChange)?.imageCount).toEqual(1)
  })

  it('counts BR tags as newlines and block wrappers as paragraph breaks', () => {
    const handleChange = vi.fn<(snapshot: RichComposerSnapshot) => void>()

    const { container } = render(<RichComposer onChange={handleChange} />)

    const editor = container.querySelector('.rich-composer') as HTMLDivElement

    editor.innerHTML = 'first line<br>second<div>third</div>'
    fireEvent.input(editor)

    expect(lastSnapshot(handleChange)?.text).toEqual(
      'first line\nsecond\nthird'
    )
  })

  it('clear() empties the editor and notifies via onChange', () => {
    const handleChange = vi.fn<(snapshot: RichComposerSnapshot) => void>()
    const ref = createRef<RichComposerHandle>()

    const { container } = render(
      <RichComposer
        ref={ref}
        initialText="draft text"
        onChange={handleChange}
      />
    )

    const editor = container.querySelector('.rich-composer') as HTMLDivElement

    expect(editor.textContent).toEqual('draft text')

    ref.current?.clear()

    expect(editor.textContent).toEqual('')
    expect(lastSnapshot(handleChange)).toEqual({ text: '', imageCount: 0 })
  })

  it('getSnapshot() reflects the current text and image count', () => {
    const ref = createRef<RichComposerHandle>()

    const { container } = render(
      <RichComposer
        ref={ref}
        initialText="hello"
      />
    )

    const editor = container.querySelector('.rich-composer') as HTMLDivElement

    expect(ref.current?.getSnapshot()).toEqual({ text: 'hello', imageCount: 0 })

    const image = document.createElement('img')
    image.src = 'data:image/png;base64,'
    image.className = 'rich-composer-image'
    editor.appendChild(image)

    expect(ref.current?.getSnapshot()).toEqual({ text: 'hello', imageCount: 1 })
  })

  it('forwards keydown events to the parent', () => {
    const handleKeyDown = vi.fn()

    const { container } = render(<RichComposer onKeyDown={handleKeyDown} />)

    const editor = container.querySelector('.rich-composer') as HTMLDivElement

    fireEvent.keyDown(editor, { key: 'Enter' })

    expect(handleKeyDown).toHaveBeenCalled()
  })

  it('disables editing when disabled is true', () => {
    const { container } = render(<RichComposer disabled />)

    const editor = container.querySelector('.rich-composer') as HTMLDivElement

    expect(editor.getAttribute('contenteditable')).toEqual('false')
  })
})
