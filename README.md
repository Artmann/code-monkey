# Code Monkey

_Apes strong together. 🦍_

Code Monkey is a desktop coding-agent workbench built around **tasks** and
**agents**. Each task owns its own agent thread that runs in an isolated git
worktree; there is also a project-level chat that runs the agent against your
main branch.

It is a local Electron app — your project files, credentials, and agent
transcripts never leave the machine.

## Features

- **Task board.** Drag-and-drop columns for Todo / In Progress / Done with
  markdown descriptions.
- **Per-task agent.** "Start Work" checks out a `code-monkey/<task-id>` branch
  in a sandboxed worktree, hands it to the agent, and streams every message,
  tool call, and file change back into the app. "Merge to Main" auto-commits
  the result when you approve.
- **Project agent.** A separate chat in the project's working directory for
  conversations that don't belong to any one task. Multiple threads per
  project with a history dropdown.
- **Agent view.** Grouped activity strips (no more terminal-log noise),
  markdown-rendered agent messages with a streaming cursor, and a state pill
  (Idle / Thinking / Running / Waiting / Blocked / Done).
- **Providers.** Uses your local `codex` CLI credentials or an OpenAI API key
  stored in the OS keychain via Electron `safeStorage`.
- **Theming.** Light / Dark / System, backed by the
  [Catppuccin](https://catppuccin.com) palette (Latte and Macchiato).

## Requirements

- [Bun](https://bun.com/) (recommended) or [pnpm](https://pnpm.io/) with
  Node.js **22** or **24**
- Git on your `PATH`
- One of:
  - [OpenAI Codex CLI](https://github.com/openai/codex) logged in (the app
    re-uses `~/.codex`), or
  - An OpenAI API key

## Installation

```sh
bun install
```

(or `pnpm install` if you prefer pnpm)

## Running the app

```sh
bun run start
```

On first launch, open **Settings** and configure the Codex provider (CLI
re-use or API key). Then create a project pointing at a git repository on
disk.

## Scripts

| Script              | What it does                                   |
| ------------------- | ---------------------------------------------- |
| `bun run start`     | Launch the Electron dev build via electron-forge |
| `bun run test`      | Run vitest in watch mode                       |
| `bun run test:run`  | Run the full test suite once                   |
| `bun run lint`      | Run ESLint across `src/`                       |
| `bun run typecheck` | Run `tsc --noEmit`                             |
| `bun run db:generate` | Generate a drizzle migration from `schema.ts` |
| `bun run package`   | Produce an unpacked Electron app               |
| `bun run make`      | Produce platform installers                    |
| `bun run publish`   | Publish releases via electron-forge            |

## Data locations

- App database: `~/.code-monkey/code-monkey.db` (SQLite via better-sqlite3)
- Per-task worktrees: `~/.code-monkey/worktrees/<repo>/<branch>`

Uninstalling by deleting the above directory is safe.

## Keyboard shortcuts

- **C** — create a task (in the Tasks tab)
- **Enter** — send a message in the agent composer; **Shift+Enter** for a
  newline

## License

[MIT](./LICENSE)
