import { randomUUID } from 'node:crypto'
import {
  integer,
  sqliteTable,
  text,
  uniqueIndex
} from 'drizzle-orm/sqlite-core'

export const taskStatusValues = ['in_progress', 'todo', 'done'] as const
export type TaskStatus = (typeof taskStatusValues)[number]

export const agentStateValues = [
  'idle',
  'waiting_for_input',
  'working',
  'done'
] as const
export type AgentState = (typeof agentStateValues)[number]

export const threadStatusValues = [
  'starting',
  'running',
  'idle',
  'done',
  'error'
] as const
export type ThreadStatus = (typeof threadStatusValues)[number]

export const projects = sqliteTable('projects', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  name: text('name').notNull(),
  directoryPath: text('directory_path').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
  deletedAt: integer('deleted_at', { mode: 'timestamp' })
})

export const tasks = sqliteTable('tasks', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  projectId: text('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  description: text('description'),
  status: text('status', { enum: taskStatusValues })
    .notNull()
    .$defaultFn(() => 'todo'),
  agentState: text('agent_state', { enum: agentStateValues })
    .notNull()
    .$defaultFn(() => 'idle'),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
  deletedAt: integer('deleted_at', { mode: 'timestamp' })
})

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date())
})

export const threads = sqliteTable('threads', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  taskId: text('task_id')
    .notNull()
    .references(() => tasks.id, { onDelete: 'cascade' }),
  codexThreadId: text('codex_thread_id'),
  worktreePath: text('worktree_path').notNull(),
  branchName: text('branch_name').notNull(),
  baseBranch: text('base_branch').notNull(),
  status: text('status', { enum: threadStatusValues })
    .notNull()
    .$defaultFn(() => 'starting'),
  errorMessage: text('error_message'),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
  lastActivityAt: integer('last_activity_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date())
})

export const threadEvents = sqliteTable(
  'thread_events',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    threadId: text('thread_id')
      .notNull()
      .references(() => threads.id, { onDelete: 'cascade' }),
    sequence: integer('sequence').notNull(),
    type: text('type').notNull(),
    payload: text('payload').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date())
  },
  (table) => [
    uniqueIndex('thread_events_thread_sequence_idx').on(
      table.threadId,
      table.sequence
    )
  ]
)

export type Project = typeof projects.$inferSelect
export type NewProject = typeof projects.$inferInsert
export type Task = typeof tasks.$inferSelect
export type NewTask = typeof tasks.$inferInsert
export type Setting = typeof settings.$inferSelect
export type NewSetting = typeof settings.$inferInsert
export type Thread = typeof threads.$inferSelect
export type NewThread = typeof threads.$inferInsert
export type ThreadEvent = typeof threadEvents.$inferSelect
export type NewThreadEvent = typeof threadEvents.$inferInsert
