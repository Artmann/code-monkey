import { describe, expect, test } from 'vitest'

import type { NormalizedEvent } from '../provider'
import {
  normalizeClaudeCodeStream,
  type SDKLikeMessage
} from './claude-code-normalize'

const toAsyncIterable = <T>(items: T[]): AsyncIterable<T> => ({
  [Symbol.asyncIterator]: async function* () {
    for (const item of items) yield item
  }
})

const collect = async (
  messages: SDKLikeMessage[],
  initialSessionId: string | null = null
): Promise<NormalizedEvent[]> => {
  const out: NormalizedEvent[] = []

  for await (const event of normalizeClaudeCodeStream(
    toAsyncIterable(messages),
    initialSessionId
  )) {
    out.push(event)
  }

  return out
}

describe('normalizeClaudeCodeStream', () => {
  test('emits thread.started on init system message', async () => {
    const events = await collect([
      { type: 'system', subtype: 'init', session_id: 'sess-1' }
    ])

    expect(events).toContainEqual({
      type: 'thread.started',
      thread_id: 'sess-1'
    })
  })

  test('suppresses a second thread.started when initial session id is known', async () => {
    const events = await collect(
      [{ type: 'system', subtype: 'init', session_id: 'sess-1' }],
      'sess-1'
    )

    expect(
      events.find((event) => event.type === 'thread.started')
    ).toBeUndefined()
  })

  test('maps assistant text blocks to agent_message item.completed events', async () => {
    const events = await collect([
      {
        type: 'assistant',
        message: {
          id: 'msg-1',
          content: [{ type: 'text', text: 'Hello there.' }]
        }
      }
    ])

    expect(events[0]).toEqual({ type: 'turn.started' })
    expect(events[1]).toMatchObject({
      type: 'item.completed',
      item: {
        id: 'msg-1:text',
        type: 'agent_message',
        text: 'Hello there.'
      }
    })
  })

  test('maps assistant thinking blocks to reasoning events', async () => {
    const events = await collect([
      {
        type: 'assistant',
        message: {
          id: 'msg-2',
          content: [{ type: 'thinking', thinking: 'Considering options…' }]
        }
      }
    ])

    expect(events).toContainEqual({
      type: 'item.completed',
      item: {
        id: 'msg-2:thinking',
        type: 'reasoning',
        text: 'Considering options…'
      }
    })
  })

  test('maps Bash tool_use + tool_result to command_execution pair', async () => {
    const events = await collect([
      {
        type: 'assistant',
        message: {
          id: 'a1',
          content: [
            {
              type: 'tool_use',
              id: 'tool-1',
              name: 'Bash',
              input: { command: 'ls -la' }
            }
          ]
        }
      },
      {
        type: 'user',
        message: {
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'tool-1',
              content: 'total 0\n'
            }
          ]
        }
      }
    ])

    expect(events).toContainEqual({
      type: 'item.started',
      item: {
        id: 'tool-1',
        type: 'command_execution',
        command: 'ls -la',
        status: 'running'
      }
    })
    expect(events).toContainEqual({
      type: 'item.completed',
      item: {
        id: 'tool-1',
        type: 'command_execution',
        command: 'ls -la',
        aggregated_output: 'total 0\n',
        exit_code: 0,
        status: 'succeeded'
      }
    })
  })

  test('marks failed tool results with exit_code 1', async () => {
    const events = await collect([
      {
        type: 'assistant',
        message: {
          id: 'a1',
          content: [
            {
              type: 'tool_use',
              id: 'tool-2',
              name: 'Bash',
              input: { command: 'false' }
            }
          ]
        }
      },
      {
        type: 'user',
        message: {
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'tool-2',
              content: 'boom',
              is_error: true
            }
          ]
        }
      }
    ])

    const completed = events.find(
      (event) =>
        event.type === 'item.completed' &&
        (event.item as { type?: string }).type === 'command_execution'
    )

    expect(completed).toMatchObject({
      item: { exit_code: 1, status: 'failed' }
    })
  })

  test('maps Edit tool_use + tool_result to file_change events', async () => {
    const events = await collect([
      {
        type: 'assistant',
        message: {
          id: 'a1',
          content: [
            {
              type: 'tool_use',
              id: 'tool-3',
              name: 'Edit',
              input: {
                file_path: '/tmp/a.ts',
                old_string: 'foo',
                new_string: 'bar'
              }
            }
          ]
        }
      },
      {
        type: 'user',
        message: {
          content: [
            { type: 'tool_result', tool_use_id: 'tool-3', content: 'ok' }
          ]
        }
      }
    ])

    expect(events).toContainEqual({
      type: 'item.started',
      item: {
        id: 'tool-3',
        type: 'file_change',
        changes: [{ path: '/tmp/a.ts', kind: 'edit' }],
        status: 'running'
      }
    })
    expect(events).toContainEqual({
      type: 'item.completed',
      item: {
        id: 'tool-3',
        type: 'file_change',
        changes: [{ path: '/tmp/a.ts', kind: 'edit' }],
        status: 'succeeded'
      }
    })
  })

  test('Write tool_use is marked as a create-kind file change', async () => {
    const events = await collect([
      {
        type: 'assistant',
        message: {
          id: 'a1',
          content: [
            {
              type: 'tool_use',
              id: 'tool-4',
              name: 'Write',
              input: { file_path: '/tmp/new.ts', content: 'x' }
            }
          ]
        }
      }
    ])

    expect(events).toContainEqual({
      type: 'item.started',
      item: {
        id: 'tool-4',
        type: 'file_change',
        changes: [{ path: '/tmp/new.ts', kind: 'create' }],
        status: 'running'
      }
    })
  })

  test('TodoWrite emits a single item.completed todo_list', async () => {
    const events = await collect([
      {
        type: 'assistant',
        message: {
          id: 'a1',
          content: [
            {
              type: 'tool_use',
              id: 'tool-5',
              name: 'TodoWrite',
              input: {
                todos: [
                  { content: 'do a', status: 'completed' },
                  { content: 'do b', status: 'in_progress' }
                ]
              }
            }
          ]
        }
      },
      {
        type: 'user',
        message: {
          content: [
            { type: 'tool_result', tool_use_id: 'tool-5', content: 'ok' }
          ]
        }
      }
    ])

    const todoEvents = events.filter(
      (event) =>
        event.type === 'item.completed' &&
        (event.item as { type?: string }).type === 'todo_list'
    )

    expect(todoEvents).toHaveLength(1)
    expect(todoEvents[0]).toMatchObject({
      item: {
        items: [
          { text: 'do a', completed: true },
          { text: 'do b', completed: false }
        ]
      }
    })
  })

  test('maps result success to turn.completed with usage', async () => {
    const events = await collect([
      {
        type: 'result',
        subtype: 'success',
        usage: { input_tokens: 10, output_tokens: 20 }
      }
    ])

    expect(events).toContainEqual({
      type: 'turn.completed',
      usage: { input_tokens: 10, output_tokens: 20 }
    })
  })

  test('maps result error to turn.failed with a message', async () => {
    const events = await collect([
      {
        type: 'result',
        subtype: 'error_max_turns',
        result: 'exceeded max turns',
        is_error: true
      }
    ])

    expect(events).toContainEqual({
      type: 'turn.failed',
      error: { message: 'exceeded max turns' }
    })
  })

  test('fallback: unknown tool becomes a command_execution', async () => {
    const events = await collect([
      {
        type: 'assistant',
        message: {
          id: 'a1',
          content: [
            {
              type: 'tool_use',
              id: 'tool-6',
              name: 'WebFetch',
              input: { url: 'https://example.com' }
            }
          ]
        }
      }
    ])

    const started = events.find((event) => event.type === 'item.started')

    expect(started).toMatchObject({
      item: {
        id: 'tool-6',
        type: 'command_execution',
        status: 'running'
      }
    })
    expect(
      (started?.item as { command?: string } | undefined)?.command
    ).toContain('WebFetch')
  })
})
