import type { NormalizedEvent } from '../provider'

type TextBlock = { type: 'text'; text: string }
type ThinkingBlock = {
  type: 'thinking' | 'extended_thinking'
  thinking: string
}
type ToolUseBlock = {
  type: 'tool_use'
  id: string
  name: string
  input: Record<string, unknown>
}
type AssistantContentBlock = TextBlock | ThinkingBlock | ToolUseBlock

type ToolResultBlock = {
  type: 'tool_result'
  tool_use_id: string
  content?: string | Array<{ type: string; text?: string }>
  is_error?: boolean
}
type UserContentBlock = ToolResultBlock | { type: string }

type AssistantSdkMessage = {
  type: 'assistant'
  message: {
    id?: string
    content: AssistantContentBlock[]
  }
}

type UserSdkMessage = {
  type: 'user'
  message: {
    content: string | UserContentBlock[]
  }
}

type SystemSdkMessage = {
  type: 'system'
  subtype?: string
  session_id?: string
}

type ResultSdkMessage = {
  type: 'result'
  subtype?: string
  result?: string
  usage?: unknown
  is_error?: boolean
}

export type SDKLikeMessage =
  | AssistantSdkMessage
  | UserSdkMessage
  | SystemSdkMessage
  | ResultSdkMessage
  | { type: string; [key: string]: unknown }

const fileChangeToolKinds: Record<string, string> = {
  Edit: 'edit',
  MultiEdit: 'edit',
  Write: 'create',
  NotebookEdit: 'edit'
}

const resolveToolResultText = (
  content: ToolResultBlock['content']
): string | undefined => {
  if (content == null) return undefined
  if (typeof content === 'string') return content

  const parts = content
    .map((block) => (typeof block.text === 'string' ? block.text : ''))
    .filter((text) => text.length > 0)

  return parts.length > 0 ? parts.join('\n') : undefined
}

const describeToolInvocation = (name: string, input: unknown): string => {
  if (
    typeof input === 'object' &&
    input !== null &&
    'command' in input &&
    typeof (input as { command: unknown }).command === 'string'
  ) {
    return (input as { command: string }).command
  }

  try {
    return `${name} ${JSON.stringify(input)}`
  } catch {
    return name
  }
}

type PendingTool = {
  id: string
  name: string
  input: Record<string, unknown>
  command: string
}

const mapAssistantToolUse = (
  block: ToolUseBlock
): { events: NormalizedEvent[]; pending: PendingTool | null } => {
  const command = describeToolInvocation(block.name, block.input)
  const pending: PendingTool = {
    id: block.id,
    name: block.name,
    input: block.input,
    command
  }

  if (block.name === 'TodoWrite') {
    const todos = Array.isArray((block.input as { todos?: unknown }).todos)
      ? ((block.input as { todos: unknown[] }).todos as Array<{
          content?: string
          activeForm?: string
          status?: string
        }>)
      : []

    const items = todos.map((todo) => ({
      text: todo.content ?? todo.activeForm ?? '',
      completed: todo.status === 'completed'
    }))

    return {
      events: [
        {
          type: 'item.completed',
          item: { id: block.id, type: 'todo_list', items }
        }
      ],
      pending: null
    }
  }

  if (block.name in fileChangeToolKinds) {
    const kind = fileChangeToolKinds[block.name] ?? 'edit'
    const path =
      (block.input as { file_path?: string; path?: string }).file_path ??
      (block.input as { path?: string }).path ??
      ''

    return {
      events: [
        {
          type: 'item.started',
          item: {
            id: block.id,
            type: 'file_change',
            changes: [{ path, kind }],
            status: 'running'
          }
        }
      ],
      pending
    }
  }

  return {
    events: [
      {
        type: 'item.started',
        item: {
          id: block.id,
          type: 'command_execution',
          command,
          status: 'running'
        }
      }
    ],
    pending
  }
}

const mapToolResult = (
  block: ToolResultBlock,
  pending: PendingTool | undefined
): NormalizedEvent[] => {
  if (!pending) return []

  const succeeded = block.is_error !== true
  const status = succeeded ? 'succeeded' : 'failed'
  const output = resolveToolResultText(block.content)

  if (pending.name === 'TodoWrite') {
    // TodoWrite is emitted as item.completed at the tool_use stage; ignore
    // the result.
    return []
  }

  if (pending.name in fileChangeToolKinds) {
    const kind = fileChangeToolKinds[pending.name] ?? 'edit'
    const path =
      (pending.input as { file_path?: string; path?: string }).file_path ??
      (pending.input as { path?: string }).path ??
      ''

    return [
      {
        type: 'item.completed',
        item: {
          id: pending.id,
          type: 'file_change',
          changes: [{ path, kind }],
          status
        }
      }
    ]
  }

  return [
    {
      type: 'item.completed',
      item: {
        id: pending.id,
        type: 'command_execution',
        command: pending.command,
        aggregated_output: output,
        exit_code: succeeded ? 0 : 1,
        status
      }
    }
  ]
}

export async function* normalizeClaudeCodeStream(
  messages: AsyncIterable<SDKLikeMessage>,
  initialSessionId: string | null = null
): AsyncGenerator<NormalizedEvent> {
  let sessionEmitted = initialSessionId != null
  let turnStarted = false
  const pending = new Map<string, PendingTool>()

  for await (const raw of messages) {
    if (raw.type === 'system') {
      const msg = raw as SystemSdkMessage

      if (
        msg.subtype === 'init' &&
        typeof msg.session_id === 'string' &&
        !sessionEmitted
      ) {
        sessionEmitted = true
        yield { type: 'thread.started', thread_id: msg.session_id }
      }

      continue
    }

    if (raw.type === 'assistant') {
      const msg = raw as AssistantSdkMessage
      const blocks = Array.isArray(msg.message?.content)
        ? msg.message.content
        : []

      if (!turnStarted) {
        turnStarted = true
        yield { type: 'turn.started' }
      }

      for (const block of blocks) {
        if (block.type === 'text') {
          const text = block.text ?? ''

          if (text.trim() === '') continue

          yield {
            type: 'item.completed',
            item: {
              id: msg.message?.id ? `${msg.message.id}:text` : undefined,
              type: 'agent_message',
              text
            }
          }

          continue
        }

        if (block.type === 'thinking' || block.type === 'extended_thinking') {
          const text = block.thinking ?? ''

          if (text.trim() === '') continue

          yield {
            type: 'item.completed',
            item: {
              id: msg.message?.id ? `${msg.message.id}:thinking` : undefined,
              type: 'reasoning',
              text
            }
          }

          continue
        }

        if (block.type === 'tool_use') {
          const { events, pending: next } = mapAssistantToolUse(block)

          if (next) pending.set(next.id, next)

          for (const event of events) yield event
        }
      }

      continue
    }

    if (raw.type === 'user') {
      const msg = raw as UserSdkMessage
      const content = msg.message?.content

      if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type !== 'tool_result') continue

          const toolResult = block as ToolResultBlock
          const spec = pending.get(toolResult.tool_use_id)

          for (const event of mapToolResult(toolResult, spec)) yield event

          pending.delete(toolResult.tool_use_id)
        }
      }

      continue
    }

    if (raw.type === 'result') {
      const msg = raw as ResultSdkMessage

      if (msg.subtype === 'success') {
        yield { type: 'turn.completed', usage: msg.usage }

        turnStarted = false

        continue
      }

      const errorText =
        typeof msg.result === 'string' && msg.result.trim() !== ''
          ? msg.result
          : (msg.subtype ?? 'Claude Code reported an error')

      yield { type: 'turn.failed', error: { message: errorText } }

      turnStarted = false
    }
  }
}
