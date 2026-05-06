import { AnimatePresence, motion } from 'framer-motion'
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  FileEdit,
  FilePlus,
  FileText,
  Loader2,
  Terminal
} from 'lucide-react'
import { createContext, useContext, useState, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

import type { Thread, ThreadEvent } from '../hooks/use-thread'
import { cn } from '../lib/utils'
import { AgentMessageCard } from './agent-message-card'
import { ApprovalCard } from './approval-card'
import { UserInputCard, type UserInputQuestion } from './user-input-card'

export type ApprovalDecisionShape =
  | { decision: 'approve' }
  | { decision: 'reject'; reason?: string }

type ApprovalActionsHandler = (
  requestId: string,
  decision: ApprovalDecisionShape
) => void

type UserInputActionsHandler = (
  requestId: string,
  answers: Record<string, string>
) => void

const ApprovalActionsContext = createContext<ApprovalActionsHandler | null>(
  null
)

const UserInputActionsContext = createContext<UserInputActionsHandler | null>(
  null
)

export const ApprovalActionsProvider = ApprovalActionsContext.Provider
export const UserInputActionsProvider = UserInputActionsContext.Provider

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

type PrepPayload = {
  workingDirectory?: string
  worktreePath?: string
  branchName?: string
  scope?: string
}

function getItem(payload: unknown): KnownItem | null {
  if (typeof payload !== 'object' || payload === null) return null
  const record = payload as Record<string, unknown>
  const item = record.item

  if (typeof item !== 'object' || item === null) return null

  return item as KnownItem
}

function formatTimestamp(iso: string): string {
  const date = new Date(iso)

  if (Number.isNaN(date.getTime())) return ''

  return date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  })
}

type ToolStep = {
  key: string
  tool: 'shell' | 'file' | 'reasoning' | 'unknown'
  label: string
  detail?: string
  ok: boolean
}

type RenderNode =
  | { kind: 'prep'; id: string; payload: PrepPayload }
  | {
      kind: 'user'
      id: string
      text: string
      timestamp: string | null
    }
  | {
      kind: 'agent'
      id: string
      text: string
      timestamp: string | null
      streaming: boolean
    }
  | {
      kind: 'activity'
      id: string
      steps: ToolStep[]
      running: boolean
    }
  | { kind: 'todo'; id: string; items: Array<{ text: string; completed: boolean }> }
  | { kind: 'error'; id: string; message: string }
  | { kind: 'merge'; id: string; baseBranch?: string; branchName?: string }
  | { kind: 'turn-complete'; id: string }
  | {
      kind: 'approval'
      id: string
      requestId: string
      tool: string
      summary: string
      resolved: null | { decision: 'approve' | 'reject'; reason?: string }
    }
  | {
      kind: 'user-input'
      id: string
      requestId: string
      questions: UserInputQuestion[]
      resolved:
        | null
        | { answers: Record<string, string>; error?: string }
    }
  | {
      kind: 'plan-proposed'
      id: string
      plan: string
    }

function stepForItem(
  item: KnownItem,
  ok: boolean,
  key: string
): ToolStep | null {
  if (item.type === 'command_execution') {
    const cmd = item as CommandExecutionItem
    const exitOk =
      ok && (typeof cmd.exit_code !== 'number' || cmd.exit_code === 0)
    return {
      key,
      tool: 'shell',
      label: cmd.command?.trim() || 'command',
      detail:
        typeof cmd.exit_code === 'number' ? `exit ${cmd.exit_code}` : undefined,
      ok: exitOk
    }
  }

  if (item.type === 'file_change') {
    const change = item as FileChangeItem
    const first = change.changes?.[0]
    const count = change.changes?.length ?? 0
    const label =
      count > 1
        ? `${count} files · ${first?.path ?? ''}`
        : first?.path ?? 'file change'
    return { key, tool: 'file', label, detail: first?.kind, ok }
  }

  if (item.type === 'reasoning') {
    const reasoning = item as ReasoningItem
    const summary = (reasoning.text ?? '').split('\n')[0]?.slice(0, 120)
    return {
      key,
      tool: 'reasoning',
      label: summary || 'reasoning',
      ok: true
    }
  }

  return null
}

function buildNodes(events: ThreadEvent[]): RenderNode[] {
  const completedItemIds = new Set<string>()
  for (const event of events) {
    if (event.type === 'item.completed') {
      const item = getItem(event.payload)
      if (item?.id) completedItemIds.add(item.id)
    }
  }

  const nodes: RenderNode[] = []

  const flushActivity = (activity: RenderNode | null) => {
    if (activity && activity.kind === 'activity' && activity.steps.length > 0) {
      nodes.push(activity)
    }
  }

  let activity:
    | (RenderNode & { kind: 'activity' })
    | null = null
  let nextActivityCounter = 0

  for (const event of events) {
    if (event.type === 'prep') {
      flushActivity(activity)
      activity = null
      nodes.push({
        kind: 'prep',
        id: event.id,
        payload:
          (event.payload as PrepPayload | null | undefined) ?? ({} as PrepPayload)
      })
      continue
    }

    if (event.type === 'user_message') {
      flushActivity(activity)
      activity = null
      const record =
        typeof event.payload === 'object' && event.payload !== null
          ? (event.payload as { text?: string })
          : {}
      const text = record.text ?? ''

      if (text.trim() === '') continue

      nodes.push({
        kind: 'user',
        id: event.id,
        text,
        timestamp: formatTimestamp(event.createdAt)
      })
      continue
    }

    if (event.type === 'error' || event.type === 'turn.failed') {
      flushActivity(activity)
      activity = null
      const record =
        typeof event.payload === 'object' && event.payload !== null
          ? (event.payload as {
              message?: string
              error?: { message?: string }
            })
          : {}
      const message =
        record.message ?? record.error?.message ?? 'Unknown agent error'
      nodes.push({ kind: 'error', id: event.id, message })
      continue
    }

    if (event.type === 'merge.completed') {
      flushActivity(activity)
      activity = null
      const record =
        typeof event.payload === 'object' && event.payload !== null
          ? (event.payload as { baseBranch?: string; branchName?: string })
          : {}
      nodes.push({
        kind: 'merge',
        id: event.id,
        baseBranch: record.baseBranch,
        branchName: record.branchName
      })
      continue
    }

    if (event.type === 'turn.completed') {
      flushActivity(activity)
      activity = null
      continue
    }

    if (event.type === 'thread.started') {
      continue
    }

    if (event.type === 'item.approval_requested') {
      flushActivity(activity)
      activity = null

      const item = (event.payload as {
        item?: {
          id?: string
          tool?: string
          input?: unknown
          summary?: string
        }
      } | null)?.item

      if (!item?.id) continue

      nodes.push({
        kind: 'approval',
        id: event.id,
        requestId: item.id,
        tool: item.tool ?? 'unknown',
        summary: item.summary ?? '',
        resolved: null
      })
      continue
    }

    if (event.type === 'item.approval_resolved') {
      const item = (event.payload as {
        item?: { id?: string; decision?: string; reason?: string }
      } | null)?.item

      if (!item?.id) continue

      const target = nodes.find(
        (node) => node.kind === 'approval' && node.requestId === item.id
      )

      if (target && target.kind === 'approval') {
        target.resolved = {
          decision: item.decision === 'approve' ? 'approve' : 'reject',
          reason: item.reason
        }
      }
      continue
    }

    if (event.type === 'item.user_input_requested') {
      flushActivity(activity)
      activity = null

      const item = (event.payload as {
        item?: {
          id?: string
          questions?: UserInputQuestion[]
        }
      } | null)?.item

      if (!item?.id) continue

      nodes.push({
        kind: 'user-input',
        id: event.id,
        requestId: item.id,
        questions: Array.isArray(item.questions) ? item.questions : [],
        resolved: null
      })
      continue
    }

    if (event.type === 'item.user_input_resolved') {
      const item = (event.payload as {
        item?: {
          id?: string
          answers?: Record<string, string>
          error?: string
        }
      } | null)?.item

      if (!item?.id) continue

      const target = nodes.find(
        (node) => node.kind === 'user-input' && node.requestId === item.id
      )

      if (target && target.kind === 'user-input') {
        target.resolved = {
          answers: item.answers ?? {},
          error: item.error
        }
      }
      continue
    }

    if (event.type === 'item.plan_proposed') {
      flushActivity(activity)
      activity = null

      const item = (event.payload as {
        item?: { id?: string; plan?: string }
      } | null)?.item

      const plan = typeof item?.plan === 'string' ? item.plan : ''

      nodes.push({
        kind: 'plan-proposed',
        id: event.id,
        plan
      })
      continue
    }

    if (
      event.type === 'item.started' ||
      event.type === 'item.updated' ||
      event.type === 'item.completed'
    ) {
      const item = getItem(event.payload)
      if (!item) continue

      // Agent messages: render finalized as card; render in-flight (only if no
      // completion exists) as a streaming card.
      if (item.type === 'agent_message') {
        const text = (item as AgentMessageItem).text ?? ''

        if (event.type === 'item.completed') {
          flushActivity(activity)
          activity = null
          nodes.push({
            kind: 'agent',
            id: event.id,
            text,
            timestamp: formatTimestamp(event.createdAt),
            streaming: false
          })
          continue
        }

        const itemId = item.id
        if (!itemId || completedItemIds.has(itemId)) continue

        // In-flight message — only render the *last* update per item id.
        const existingIndex = nodes.findIndex(
          (n) => n.kind === 'agent' && n.id === `streaming:${itemId}`
        )
        const streamingNode: RenderNode = {
          kind: 'agent',
          id: `streaming:${itemId}`,
          text,
          timestamp: formatTimestamp(event.createdAt),
          streaming: true
        }

        if (existingIndex >= 0) {
          nodes[existingIndex] = streamingNode
        } else {
          flushActivity(activity)
          activity = null
          nodes.push(streamingNode)
        }
        continue
      }

      // Todo lists render independently (not grouped into activity).
      if (item.type === 'todo_list') {
        if (event.type !== 'item.completed') continue
        flushActivity(activity)
        activity = null
        const todoList = item as TodoListItem
        nodes.push({
          kind: 'todo',
          id: event.id,
          items: todoList.items ?? []
        })
        continue
      }

      // Tool calls are grouped into activity runs.
      const step = stepForItem(
        item,
        event.type === 'item.completed' ? true : true,
        `${event.id}:${event.type}`
      )

      if (!step) continue

      const itemId = item.id ?? step.key
      const isLive =
        event.type !== 'item.completed' &&
        (!item.id || !completedItemIds.has(item.id))

      if (event.type === 'item.completed' || isLive) {
        if (!activity) {
          activity = {
            kind: 'activity',
            id: `activity-${nextActivityCounter++}`,
            steps: [],
            running: false
          }
        }

        // Dedupe by item.id when possible so item.started+item.completed for
        // the same command don't show twice.
        const existingIdx = activity.steps.findIndex((s) =>
          s.key.startsWith(`item:${itemId}:`)
        )
        const normalizedStep = {
          ...step,
          key: item.id
            ? `item:${itemId}:${event.type}`
            : `${step.key}:${activity.steps.length}`
        }
        if (existingIdx >= 0) {
          activity.steps[existingIdx] = normalizedStep
        } else {
          activity.steps.push(normalizedStep)
        }

        if (isLive) activity.running = true
      }
    }
  }

  flushActivity(activity)

  return nodes
}

export function AgentTranscript({
  events,
  thread = null,
  cancelRequested = false
}: {
  events: ThreadEvent[]
  thread?: Thread | null
  cancelRequested?: boolean
}) {
  if (events.length === 0) {
    return (
      <div className='flex h-full items-center justify-center py-10'>
        <p className='text-xs text-muted-foreground'>
          No output yet. The agent hasn&apos;t said anything.
        </p>
      </div>
    )
  }

  const nodes = buildNodes(events)
  const serverRunning =
    thread?.status === 'running' || thread?.status === 'starting'
  const running = serverRunning && !cancelRequested

  return (
    <div className='flex flex-col gap-2.5'>
      <AnimatePresence initial={false}>
        {nodes.map((node) => (
          <RenderedNode
            key={node.id}
            node={node}
          />
        ))}
      </AnimatePresence>

      {running ? <RunningRow /> : null}
    </div>
  )
}

function RenderedNode({ node }: { node: RenderNode }) {
  if (node.kind === 'prep') return <PrepRow payload={node.payload} />
  if (node.kind === 'user') {
    return (
      <UserMessageCard
        text={node.text}
        timestamp={node.timestamp}
      />
    )
  }
  if (node.kind === 'agent') {
    return (
      <AgentMessageCard
        text={node.text}
        timestamp={node.timestamp}
        streaming={node.streaming}
      />
    )
  }
  if (node.kind === 'activity')
    return (
      <ActivityStrip
        steps={node.steps}
        running={node.running}
      />
    )
  if (node.kind === 'todo') return <TodoRow items={node.items} />
  if (node.kind === 'error') return <ErrorRow message={node.message} />
  if (node.kind === 'merge')
    return (
      <SystemRow>
        Merged <span className='font-mono'>{node.branchName ?? 'branch'}</span>{' '}
        into <span className='font-mono'>{node.baseBranch ?? 'main'}</span>.
      </SystemRow>
    )
  if (node.kind === 'turn-complete') return null
  if (node.kind === 'approval') return <ApprovalNode node={node} />
  if (node.kind === 'user-input') return <UserInputNode node={node} />
  if (node.kind === 'plan-proposed') return <PlanProposedRow plan={node.plan} />

  return null
}

function UserInputNode({
  node
}: {
  node: Extract<RenderNode, { kind: 'user-input' }>
}) {
  const onAnswer = useContext(UserInputActionsContext)

  return (
    <UserInputCard
      questions={node.questions}
      resolved={node.resolved}
      onSubmit={(answers) => onAnswer?.(node.requestId, answers)}
    />
  )
}

function PlanProposedRow({ plan }: { plan: string }) {
  return (
    <div className='flex flex-col gap-2 rounded-xl border border-banana/40 bg-banana/5 px-4 py-3'>
      <div className='font-display text-[10.5px] font-semibold uppercase tracking-[0.16em] text-banana'>
        Plan proposed
      </div>
      {plan.trim() === '' ? (
        <div className='font-mono text-[11.5px] text-muted-foreground'>
          (empty plan)
        </div>
      ) : (
        <div className='prose prose-sm max-w-none whitespace-pre-wrap break-words font-mono text-[12.5px]'>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{plan}</ReactMarkdown>
        </div>
      )}
    </div>
  )
}

function ApprovalNode({
  node
}: {
  node: Extract<RenderNode, { kind: 'approval' }>
}) {
  const onDecide = useContext(ApprovalActionsContext)

  if (node.resolved) {
    return (
      <ApprovalCard
        state='resolved'
        tool={node.tool}
        summary={node.summary}
        decision={node.resolved.decision}
        reason={node.resolved.reason}
      />
    )
  }

  return (
    <ApprovalCard
      state='pending'
      tool={node.tool}
      summary={node.summary}
      onDecide={(decision) => onDecide?.(node.requestId, decision)}
    />
  )
}

function UserMessageCard({
  text
}: {
  text: string
  timestamp: string | null
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className='flex justify-end'
    >
      <div className='max-w-[78%] rounded-[14px] rounded-br-[4px] bg-[color:var(--bg-3)] px-3 py-2'>
        <div className='prose prose-sm max-w-none text-[13.5px] leading-[1.5] text-[color:var(--fg)] dark:prose-invert'>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
        </div>
      </div>
    </motion.div>
  )
}

function SystemRow({ children }: { children: ReactNode }) {
  return (
    <div className='px-1 py-1 font-mono text-[11px] text-muted-foreground/80'>
      <span className='mr-2 text-muted-foreground/40'>⎯</span>
      {children}
    </div>
  )
}

function PrepRow({ payload }: { payload: PrepPayload }) {
  const scope = payload.scope
  const where = payload.workingDirectory ?? payload.worktreePath
  const branch = payload.branchName

  return (
    <SystemRow>
      {scope === 'project' ? 'Project agent ready in ' : 'Worktree ready at '}
      {where ? <code className='font-mono'>{where}</code> : null}
      {branch ? (
        <>
          {' on '}
          <code className='font-mono'>{branch}</code>
        </>
      ) : null}
    </SystemRow>
  )
}

function toolIconFor(tool: ToolStep['tool']) {
  if (tool === 'shell') return Terminal
  if (tool === 'file') return FileEdit
  if (tool === 'reasoning') return FileText
  return FilePlus
}

function ActivityStrip({
  steps,
  running
}: {
  steps: ToolStep[]
  running: boolean
}) {
  const [open, setOpen] = useState(false)
  const failed = steps.filter((step) => !step.ok).length

  const counts = steps.reduce<Record<string, number>>((acc, step) => {
    acc[step.tool] = (acc[step.tool] ?? 0) + 1
    return acc
  }, {})
  const labels: Record<string, string> = {
    shell: 'command',
    file: 'file edit',
    reasoning: 'thought'
  }
  const summary = Object.entries(counts)
    .map(([tool, n]) => `${n} ${labels[tool] ?? tool}${n > 1 ? 's' : ''}`)
    .join(' · ')

  const latestStep = steps.at(-1) ?? null
  const latestPreview = latestStep
    ? [latestStep.label, latestStep.detail].filter(Boolean).join(' ')
    : ''

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
    >
      <button
        type='button'
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'group flex w-full items-center gap-2 rounded-md border border-[color:var(--line)] bg-[color:var(--bg-2)] px-2.5 py-1.5 text-left text-[12px] text-[color:var(--fg-2)] transition-colors',
          'self-start hover:bg-[color:var(--bg-3)]'
        )}
      >
        <span
          aria-hidden='true'
          className={cn(
            'h-3.5 w-[2px] shrink-0 rounded-[1px] bg-[color:var(--accent)]',
            running && 'animate-attention-pulse'
          )}
        />

        <span className='font-mono text-[11.5px] text-[color:var(--fg)]'>
          {running ? 'Working' : 'Activity'}
        </span>
        <span className='text-[color:var(--fg-4)]'>·</span>
        <span className='shrink-0 text-[color:var(--fg-3)]'>
          {summary}
          {failed > 0 ? (
            <span className='ml-1 text-[color:var(--destructive)]'>
              · {failed} failed
            </span>
          ) : null}
        </span>
        {latestPreview ? (
          <>
            <span className='text-[color:var(--fg-4)]'>·</span>
            <span
              className='min-w-0 flex-1 truncate font-mono text-[11.5px] text-[color:var(--fg-3)]'
              title={latestPreview}
            >
              {latestPreview}
            </span>
          </>
        ) : (
          <span className='min-w-0 flex-1' />
        )}

        <span className='ml-2 inline-flex items-center gap-1'>
          {steps.slice(0, 6).map((step) => {
            const Icon = toolIconFor(step.tool)
            return (
              <span
                key={step.key}
                className={cn(
                  'inline-grid size-[18px] place-items-center rounded-[4px] border border-[color:var(--line)] bg-[color:var(--bg)] text-[color:var(--fg-3)]',
                  !step.ok &&
                    'border-[color:var(--destructive)]/40 bg-[color:var(--destructive)]/10 text-[color:var(--destructive)]'
                )}
              >
                <Icon
                  aria-hidden='true'
                  className='size-3'
                />
              </span>
            )
          })}
        </span>

        {open ? (
          <ChevronDown
            aria-hidden='true'
            className='size-3 shrink-0 text-[color:var(--fg-3)]'
          />
        ) : (
          <ChevronRight
            aria-hidden='true'
            className='size-3 shrink-0 text-[color:var(--fg-3)]'
          />
        )}
      </button>

      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.18 }}
            className='mt-1 overflow-hidden'
          >
            <div className='grid gap-1 rounded-lg border bg-card px-3.5 py-2.5'>
              {steps.map((step) => {
                const Icon = toolIconFor(step.tool)
                return (
                  <div
                    key={step.key}
                    className={cn(
                      'grid grid-cols-[16px_1fr_auto] items-center gap-3 text-xs',
                      !step.ok && 'text-muted-foreground'
                    )}
                  >
                    <Icon
                      aria-hidden='true'
                      className={cn(
                        'size-3',
                        !step.ok && 'text-[color:var(--destructive)]'
                      )}
                    />
                    <span
                      className={cn(
                        'truncate font-mono text-[11.5px] text-foreground',
                        !step.ok &&
                          'text-muted-foreground line-through decoration-muted-foreground/40'
                      )}
                    >
                      {step.label}
                    </span>
                    {step.detail ? (
                      <span className='font-mono text-[11px] text-muted-foreground'>
                        {step.detail}
                      </span>
                    ) : null}
                  </div>
                )
              })}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </motion.div>
  )
}

function TodoRow({
  items
}: {
  items: Array<{ text: string; completed: boolean }>
}) {
  return (
    <motion.ul
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      className='rounded-lg border bg-card px-3.5 py-2.5 text-xs'
    >
      {items.map((todo, index) => (
        <li
          key={`${todo.text}-${index}`}
          className='flex gap-2 py-0.5'
        >
          <span aria-hidden='true'>{todo.completed ? '☑' : '☐'}</span>
          <span className={todo.completed ? 'line-through opacity-60' : ''}>
            {todo.text}
          </span>
        </li>
      ))}
    </motion.ul>
  )
}

function ErrorRow({ message }: { message: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      role='alert'
      className='flex items-start gap-2 rounded-lg border border-[color:var(--destructive)]/30 bg-[color:var(--destructive)]/5 px-3.5 py-2.5 text-xs text-[color:var(--destructive)]'
    >
      <AlertTriangle
        aria-hidden='true'
        className='mt-0.5 size-3.5 shrink-0'
      />
      <span className='whitespace-pre-wrap'>{message}</span>
    </motion.div>
  )
}

function RunningRow() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className='flex items-center gap-3 rounded-lg border bg-card px-3.5 py-2.5'
    >
      <Loader2
        aria-hidden='true'
        className='size-3.5 animate-spin text-banana'
      />
      <span className='text-sm font-medium'>Working…</span>
      <span className='ml-auto font-mono text-[11px] text-muted-foreground'>
        live
      </span>
    </motion.div>
  )
}
