import { randomUUID } from 'node:crypto'
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const taskStatusValues = ['in_progress', 'todo', 'done'] as const
export type TaskStatus = (typeof taskStatusValues)[number]

export const agentStateValues = [
  'idle',
  'waiting_for_input',
  'working',
  'done'
] as const
export type AgentState = (typeof agentStateValues)[number]

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

export type Project = typeof projects.$inferSelect
export type NewProject = typeof projects.$inferInsert
export type Task = typeof tasks.$inferSelect
export type NewTask = typeof tasks.$inferInsert
