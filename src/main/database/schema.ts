import { randomUUID } from 'node:crypto'
import {
  integer,
  sqliteTable,
  text,
  uniqueIndex
} from 'drizzle-orm/sqlite-core'

export const threadStatusValues = [
  'starting',
  'running',
  'idle',
  'done',
  'error'
] as const
export type ThreadStatus = (typeof threadStatusValues)[number]

export const providerKindValues = ['codex', 'claude-code'] as const
export type ProviderKind = (typeof providerKindValues)[number]

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
  name: text('name').notNull(),
  directoryPath: text('directory_path').notNull(),
  provider: text('provider', { enum: providerKindValues }),
  externalThreadId: text('external_thread_id'),
  status: text('status', { enum: threadStatusValues })
    .notNull()
    .$defaultFn(() => 'starting'),
  errorMessage: text('error_message'),
  tabOrder: integer('tab_order').notNull().default(0),
  closedAt: integer('closed_at', { mode: 'timestamp' }),
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

export type Setting = typeof settings.$inferSelect
export type NewSetting = typeof settings.$inferInsert
export type Thread = typeof threads.$inferSelect
export type NewThread = typeof threads.$inferInsert
export type ThreadEvent = typeof threadEvents.$inferSelect
export type NewThreadEvent = typeof threadEvents.$inferInsert
