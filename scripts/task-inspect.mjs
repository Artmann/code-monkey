#!/usr/bin/env node
import { homedir } from 'node:os'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import Database from 'better-sqlite3'

const databasePath = join(homedir(), '.code-monkey', 'code-monkey.db')

const taskIdArgument = process.argv[2]

if (!taskIdArgument) {
  console.error('Usage: pnpm task:inspect <task-id-or-prefix>')
  process.exit(1)
}

if (!existsSync(databasePath)) {
  console.error(`Database not found at ${databasePath}`)
  process.exit(1)
}

const sqlite = new Database(databasePath, { readonly: true })

sqlite.pragma('foreign_keys = ON')

const task = sqlite
  .prepare(
    `select * from tasks where id = ? or id like ? order by created_at desc limit 1`
  )
  .get(taskIdArgument, `${taskIdArgument}%`)

if (!task) {
  console.error(`No task found matching '${taskIdArgument}'.`)
  process.exit(1)
}

const project = sqlite
  .prepare(`select * from projects where id = ?`)
  .get(task.project_id)

const threads = sqlite
  .prepare(
    `select * from threads where task_id = ? order by created_at desc`
  )
  .all(task.id)

const threadsWithEvents = threads.map((thread) => {
  const eventCount = sqlite
    .prepare(`select count(*) as count from thread_events where thread_id = ?`)
    .get(thread.id).count

  const recentEvents = sqlite
    .prepare(
      `select id, sequence, type, created_at from thread_events
       where thread_id = ? order by sequence desc limit 10`
    )
    .all(thread.id)

  return {
    ...thread,
    eventCount,
    recentEvents
  }
})

const output = {
  databasePath,
  project,
  task,
  threads: threadsWithEvents
}

console.log(JSON.stringify(output, null, 2))

sqlite.close()
