import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { clearDraftStorage } from '../hooks/use-draft'
import type { Thread, ThreadEvent } from '../hooks/use-thread'
import { Providers } from '../test-utils'
import { AgentPane } from './agent-pane'

const buildThread = (overrides: Partial<Thread> = {}): Thread => ({
  id: 'thread-test',
  workspaceId: 'workspace-default',
  name: 'project',
  directoryPath: '/tmp/project',
  provider: 'claude-code',
  externalThreadId: null,
  status: 'idle',
  errorMessage: null,
  tabOrder: 0,
  closedAt: null,
  createdAt: new Date(0).toISOString(),
  lastActivityAt: new Date(0).toISOString(),
  awaitingInput: false,
  ...overrides
})

const renderPane = (partial: Partial<Parameters<typeof AgentPane>[0]> = {}) => {
  const onSendMessage = vi.fn()
  const onStopMessage = vi.fn()
  const events: ThreadEvent[] = partial.events ?? []
  const thread = partial.thread ?? buildThread()

  const utils = render(
    <Providers>
      <AgentPane
        thread={thread}
        events={events}
        providerConfigured
        onSendMessage={onSendMessage}
        onStopMessage={onStopMessage}
        isSending={false}
        {...partial}
      />
    </Providers>
  )

  return { ...utils, onSendMessage, onStopMessage, thread }
}

const getEditor = () =>
  screen.getByRole('textbox', { name: /message composer/i }) as HTMLDivElement

const pasteImage = (editor: HTMLDivElement, file: File) => {
  const item = {
    kind: 'file' as const,
    type: file.type,
    getAsFile: () => file
  }

  fireEvent.paste(editor, {
    clipboardData: {
      items: [item] as unknown as DataTransferItemList,
      types: ['Files'],
      files: [file],
      getData: () => ''
    } as unknown as DataTransfer
  })
}

describe('AgentPane composer', () => {
  beforeEach(() => {
    clearDraftStorage('thread-test')
  })

  afterEach(() => {
    clearDraftStorage('thread-test')
  })

  it('submits typed text via the Send button', () => {
    const { onSendMessage } = renderPane()

    const editor = getEditor()

    editor.textContent = 'plan the migration'
    fireEvent.input(editor)

    const sendButton = screen.getByRole('button', { name: /send/i })

    fireEvent.click(sendButton)

    expect(onSendMessage).toHaveBeenCalledTimes(1)
    expect(onSendMessage).toHaveBeenCalledWith('plan the migration')
  })

  it('submits when pressing Enter without modifiers', () => {
    const { onSendMessage } = renderPane()

    const editor = getEditor()

    editor.textContent = 'ship it'
    fireEvent.input(editor)
    fireEvent.keyDown(editor, { key: 'Enter' })

    expect(onSendMessage).toHaveBeenCalledWith('ship it')
  })

  it('does not submit on Shift+Enter', () => {
    const { onSendMessage } = renderPane()

    const editor = getEditor()

    editor.textContent = 'first line'
    fireEvent.input(editor)
    fireEvent.keyDown(editor, { key: 'Enter', shiftKey: true })

    expect(onSendMessage).not.toHaveBeenCalled()
  })

  it('disables the Send button when the editor is empty', () => {
    renderPane()

    const sendButton = screen.getByRole('button', { name: /send/i })

    expect(sendButton).toBeDisabled()
  })

  it('does not submit empty / whitespace-only content', () => {
    const { onSendMessage } = renderPane()

    const editor = getEditor()

    editor.textContent = '   '
    fireEvent.input(editor)
    fireEvent.keyDown(editor, { key: 'Enter' })

    expect(onSendMessage).not.toHaveBeenCalled()
  })

  it('clears the editor after a successful send', () => {
    renderPane()

    const editor = getEditor()

    editor.textContent = 'hello'
    fireEvent.input(editor)
    fireEvent.keyDown(editor, { key: 'Enter' })

    expect(editor.textContent).toEqual('')
  })

  it('shows an "image attached" notice when an image is pasted', () => {
    renderPane()

    const editor = getEditor()
    const file = new File(['fake'], 'screenshot.png', { type: 'image/png' })

    pasteImage(editor, file)

    expect(screen.getByText(/1 image attached/i)).toBeInTheDocument()

    expect(editor.querySelector('img')).not.toBeNull()
  })

  it('shows pluralised notice when multiple images are pasted', () => {
    renderPane()

    const editor = getEditor()

    pasteImage(editor, new File(['a'], 'a.png', { type: 'image/png' }))
    pasteImage(editor, new File(['b'], 'b.png', { type: 'image/png' }))

    expect(screen.getByText(/2 images attached/i)).toBeInTheDocument()
  })

  it('renders Stop instead of Send while the thread is running', () => {
    const { onStopMessage } = renderPane({
      thread: buildThread({ status: 'running' })
    })

    const stopButton = screen.getByRole('button', { name: /stop/i })

    fireEvent.click(stopButton)

    expect(onStopMessage).toHaveBeenCalledTimes(1)
  })

  it('disables the editor when the provider is not configured', () => {
    render(
      <Providers>
        <AgentPane
          thread={buildThread()}
          events={[]}
          providerConfigured={false}
          onSendMessage={vi.fn()}
          isSending={false}
        />
      </Providers>
    )

    const editor = getEditor()

    expect(editor.getAttribute('contenteditable')).toEqual('false')

    // The provider-not-configured warning links to settings.
    const link = screen.getByRole('link', {
      name: /configure an agent provider/i
    })

    expect(link).toHaveAttribute('href', '/settings')
  })
})
