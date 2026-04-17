import type { ThreadEvent } from '../hooks/use-thread'

type AgentMessageItem = {
  id?: string
  type: 'agent_message'
  text?: string
}

type ReasoningItem = {
  id?: string
  type: 'reasoning'
  text?: string
}

type CommandExecutionItem = {
  id?: string
  type: 'command_execution'
  command?: string
  aggregated_output?: string
  exit_code?: number
  status?: string
}

type FileChangeItem = {
  id?: string
  type: 'file_change'
  changes?: Array<{ path: string; kind: string }>
  status?: string
}

type TodoListItem = {
  id?: string
  type: 'todo_list'
  items?: Array<{ text: string; completed: boolean }>
}

type KnownItem =
  | AgentMessageItem
  | ReasoningItem
  | CommandExecutionItem
  | FileChangeItem
  | TodoListItem
  | { id?: string; type: string }

const getItemFromPayload = (payload: unknown): KnownItem | null => {
  if (typeof payload !== 'object' || payload === null) return null

  const record = payload as Record<string, unknown>
  const item = record.item

  if (typeof item !== 'object' || item === null) return null

  return item as KnownItem
}

const PrepRow = ({ payload }: { payload: unknown }) => {
  const record =
    typeof payload === 'object' && payload !== null
      ? (payload as Record<string, unknown>)
      : {}
  const worktreePath = typeof record.worktreePath === 'string'
    ? record.worktreePath
    : null

  return (
    <div className='rounded-md border border-muted-foreground/10 bg-muted/40 p-3 text-xs text-muted-foreground'>
      <div className='font-medium text-foreground'>Preparing</div>
      {worktreePath && (
        <div>
          Worktree ready at{' '}
          <code className='font-mono'>{worktreePath}</code>
        </div>
      )}
    </div>
  )
}

const ItemRow = ({ item }: { item: KnownItem }) => {
  if (item.type === 'agent_message') {
    const message = item as AgentMessageItem

    return (
      <div className='rounded-md border bg-background p-3 text-sm'>
        <div className='mb-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground'>
          Agent
        </div>
        <div className='whitespace-pre-wrap'>{message.text}</div>
      </div>
    )
  }

  if (item.type === 'reasoning') {
    const reasoning = item as ReasoningItem

    return (
      <div className='rounded-md border border-dashed p-3 text-xs text-muted-foreground'>
        <div className='mb-1 font-semibold uppercase tracking-widest'>
          Reasoning
        </div>
        <div className='whitespace-pre-wrap'>{reasoning.text}</div>
      </div>
    )
  }

  if (item.type === 'command_execution') {
    const command = item as CommandExecutionItem

    return (
      <details className='rounded-md border bg-muted/20 text-xs'>
        <summary className='cursor-pointer px-3 py-2 font-mono'>
          <span className='text-muted-foreground'>$</span>{' '}
          {command.command ?? ''}
          {typeof command.exit_code === 'number' && (
            <span
              className={
                command.exit_code === 0
                  ? 'ml-2 text-emerald-600'
                  : 'ml-2 text-destructive'
              }
            >
              exit {command.exit_code}
            </span>
          )}
        </summary>
        {command.aggregated_output && (
          <pre className='overflow-x-auto border-t bg-background/60 p-3 font-mono text-[11px]'>
            {command.aggregated_output}
          </pre>
        )}
      </details>
    )
  }

  if (item.type === 'file_change') {
    const patch = item as FileChangeItem

    return (
      <div className='rounded-md border p-3 text-xs'>
        <div className='mb-1 font-semibold'>
          File changes {patch.status ? `(${patch.status})` : ''}
        </div>
        <ul className='space-y-0.5 font-mono'>
          {(patch.changes ?? []).map((change) => (
            <li key={change.path}>
              <span className='text-muted-foreground'>{change.kind}</span>{' '}
              {change.path}
            </li>
          ))}
        </ul>
      </div>
    )
  }

  if (item.type === 'todo_list') {
    const todoList = item as TodoListItem

    return (
      <ul className='rounded-md border p-3 text-xs'>
        {(todoList.items ?? []).map((todo, index) => (
          <li
            key={`${todo.text}-${index}`}
            className='flex gap-2'
          >
            <span>{todo.completed ? '☑' : '☐'}</span>
            <span
              className={todo.completed ? 'line-through opacity-60' : ''}
            >
              {todo.text}
            </span>
          </li>
        ))}
      </ul>
    )
  }

  return (
    <div className='rounded-md border border-dashed p-2 text-[11px] text-muted-foreground'>
      {item.type}
    </div>
  )
}

const UsageRow = ({ payload }: { payload: unknown }) => {
  const record =
    typeof payload === 'object' && payload !== null
      ? (payload as { usage?: { input_tokens?: number; output_tokens?: number } })
      : {}
  const usage = record.usage

  return (
    <div className='text-[10px] uppercase tracking-widest text-muted-foreground'>
      Turn finished
      {usage && typeof usage.input_tokens === 'number' && (
        <> · {usage.input_tokens + (usage.output_tokens ?? 0)} tokens</>
      )}
    </div>
  )
}

const ErrorRow = ({ payload }: { payload: unknown }) => {
  const record =
    typeof payload === 'object' && payload !== null
      ? (payload as { message?: string; error?: { message?: string } })
      : {}
  const message =
    record.message ?? record.error?.message ?? 'Unknown agent error'

  return (
    <div
      role='alert'
      className='rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive'
    >
      {message}
    </div>
  )
}

export function AgentTranscript({ events }: { events: ThreadEvent[] }) {
  if (events.length === 0) {
    return (
      <div className='text-xs text-muted-foreground'>No output yet.</div>
    )
  }

  return (
    <div className='space-y-2'>
      {events.map((event) => {
        if (event.type === 'prep') {
          return (
            <PrepRow
              key={event.id}
              payload={event.payload}
            />
          )
        }

        if (
          event.type === 'item.completed' ||
          event.type === 'item.started' ||
          event.type === 'item.updated'
        ) {
          const item = getItemFromPayload(event.payload)

          if (!item) return null

          return (
            <ItemRow
              key={event.id}
              item={item}
            />
          )
        }

        if (event.type === 'turn.completed') {
          return (
            <UsageRow
              key={event.id}
              payload={event.payload}
            />
          )
        }

        if (event.type === 'error' || event.type === 'turn.failed') {
          return (
            <ErrorRow
              key={event.id}
              payload={event.payload}
            />
          )
        }

        return null
      })}
    </div>
  )
}
