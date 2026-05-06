# Contributing

Thanks for helping out. This document is for people who want to change the code.
If you're just trying to use the app, read [README.md](./README.md) instead.

## Stack

- **Electron** shell, split into `src/main` (Node.js side) and `src/renderer`
  (React / Vite side).
- **React 19** + **React Router** + **TanStack Query** for the renderer.
- **Tailwind CSS 4** + **shadcn/ui** (Radix under the hood) for styling.
- **framer-motion** for motion, **react-markdown** + `@tailwindcss/typography`
  for agent messages.
- **Hono** HTTP server inside the main process, talking to the renderer over
  `http://127.0.0.1:<port>` + Server-Sent Events.
- **better-sqlite3** + **drizzle-orm** for persistence.
- **OpenAI Codex SDK** for agent execution.
- **Vitest** + **@testing-library/react** for tests.

## Setup

Install **pnpm** on Node 22+, then:

```sh
pnpm install
pnpm start       # launches electron-forge in dev mode
```

better-sqlite3 is a native module. It must be compiled against Electron's Node
ABI for the app to run and against the host Node ABI for Vitest. If tests fail
with `NODE_MODULE_VERSION ...` mismatch, rebuild:

```sh
rm -rf node_modules/better-sqlite3/build
pnpm rebuild better-sqlite3
```

## Project layout

```
src/
  main/                      Electron main process
    api/                     Hono routes (REST + SSE)
    codex/                   Agent runner, worktree, merge, codex client
    database/                Drizzle schema, migrations, runtime client
    index.ts                 Electron entry
  renderer/                  Electron renderer (React)
    components/              React components (and their *.test.tsx)
      ui/                    shadcn primitives (button, tabs, dropdown-menu…)
    hooks/                   React Query hooks, theme hook
    lib/                     Small utilities (agent-state, theme, api-client)
    routes/                  Top-level routes (home, project, settings)
    styles/                  globals.css (Catppuccin + tailwind layers)
    App.tsx                  Route table
    index.tsx                Renderer entry
```

## Running the checks

Run these before opening a PR:

```sh
pnpm typecheck
pnpm lint
pnpm test:run
```

All three must be clean. CI runs the same checks on Node 22 and Node 24; see
[`.github/workflows/ci.yml`](.github/workflows/ci.yml).

## Coding conventions

Most conventions live in [`AGENTS.md`](./AGENTS.md). Highlights:

- Single quotes, no semicolons, no `CONSTANT_CASE`.
- Whole-word identifier names (`request`, not `req`).
- `??` over `||`. No `!` non-null assertions. No `any`.
- Always use braces for control flow, even for one-liners.
- Blank lines between const groups, control flows, and return statements.
- `invariant` (tiny-invariant) for impossible states.
- `dayjs` for dates.
- Comments explain **why**, not **what**.

## Database changes

Never write ad-hoc SQL. The flow is:

1. Edit `src/main/database/schema.ts`.
2. Run `pnpm db:generate` — drizzle-kit emits
   `src/main/database/migrations/NNNN_<tag>.sql` and a meta snapshot.
3. Read the generated SQL. SQLite can't drop `NOT NULL` in place, so drizzle
   emits a `__new_table` rebuild; verify its
   `INSERT INTO __new_table SELECT ... FROM table` clause for any new nullable
   columns (existing rows need `NULL` in them).
4. Commit the schema, migration, and snapshot together.

Migrations run automatically at startup via `src/main/database/migrate.ts`.

## Tests

- Tests live next to the implementation (`foo.tsx` → `foo.test.tsx`).
- Renderer tests use Vitest + jsdom + `@testing-library/react`; setup is in
  `src/renderer/test-setup.ts`.
- Main-process tests hit an in-memory SQLite database and apply the real
  migrations via `drizzle-orm/better-sqlite3/migrator`.
- Prefer `toEqual` over `toBe`, and compare whole objects rather than picking a
  single property.

## Publishing

Two independent release paths:

- **Installers** via electron-forge (GitHub Releases):

  ```sh
  pnpm release
  ```

  Runs `pnpm build` (typecheck + lint + tests + `electron-forge make`) then
  `electron-forge publish` to upload `.exe` / `.dmg` / `.deb` / `.rpm`
  artifacts.

- **npm tarball** (so users can `npx @artmann/codemonkey`):

  ```sh
  pnpm publish
  ```

  pnpm's built-in `publish` fires the `prepack` hook, which runs
  `scripts/build-npm.mjs` to populate `dist/`. The published tarball contains
  only `bin/`, `dist/`, `scripts/postinstall.mjs`, `README.md`, and `LICENSE`.
  On install, `scripts/postinstall.mjs` rebuilds `better-sqlite3` against the
  user's Electron.

Verify the tarball contents locally before pushing a real release:

```sh
pnpm pack --dry-run
```

## Commits

- Short, imperative subject ("Add X", "Fix Y").
- No `Co-Authored-By` lines.
- One change per commit when reasonable; bundle genuinely intertwined work
  together with a descriptive body.

## Design handoffs

UI work sometimes starts from a design bundle exported from Claude Design. The
bundle is fetched over HTTPS, extracted, and read as plain HTML/CSS/JS — the
final app implements the visuals in React + Tailwind rather than copying the
prototype's structure. See `src/renderer/components/agent-*.tsx`,
`state-pill.tsx`, and `globals.css` for an example of the Balanced-variant
implementation.

## License

By contributing you agree your contributions will be licensed under the
[MIT License](./LICENSE).
