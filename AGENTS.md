- Use pnpm in this project.
- Use invariant from tiny-invariant to fail on invalid states.
- Use dayjs for dates and time.
- Use underscores as thousand separators in numeric literals (e.g. 3_000).
- Always fix all errors and warnings, even preexisting ones. Don't introduce new
  ones. We always want to leave the codebase in a better state than we found it.

## Code Style

- Don't use CONSTANT_CASE. This is not JAVA.
- Always use bracers for control flows, even if they are one-liners.
- Use entire words as variable names. This is not Go. For example `request`
  instead of `req`.
- Use punctuation.
- Use whitespace to break up code to make it easier to read. Put a blank line
  after const groups and control flows and before return statements.
- Order things in alphabetical order by default. If applicable order by
  accessiblity level first, then alphabetical order.
- No any: Use proper types or unknown
- No Non-null Assertions: Avoid ! operator
- Prefer Nullish Coalescing: Use ?? over ||
- No Floating Promises: Always await or handle promises
- Single quotes
- No semicolons

Use blank lines to separate logical groups within a function body. Separate
declarations, side effects, and return statements from each other.

```ts
// Bad
const formData = await request.formData()
await processForm(formData)
return redirect('/dashboard')

// Good
const formData = await request.formData()

await processForm(formData)

return redirect('/dashboard')
```

Group related declarations together, then separate from the next logical step:

```ts
// Bad
const user = await getUser(request)
const org = await getOrg(user.orgId)
await trackEvent(user, org)
const data = await loadData(org)
return json(data)

// Good
const user = await getUser(request)
const org = await getOrg(user.orgId)

await trackEvent(user, org)

const data = await loadData(org)

return json(data)
```

## Database

- Always use Drizzle migrations when changing the schema. Never edit the
  database schema manually or write ad-hoc SQL migrations.
- Run `pnpm db:generate` after editing `src/main/database/schema.ts`, review the
  generated SQL in `src/main/database/migrations/`, and commit it alongside the
  schema change.
- Migrations are applied automatically on app startup from
  `src/main/database/migrate.ts`. Don't run them manually.

## Tooling

- Run `pnpm lint` and `pnpm typecheck` before declaring work complete.
- Run `pnpm test:run` to execute the test suite once (use `pnpm test` for watch
  mode).
- Run `pnpm task:inspect <task-id-or-prefix>` to dump a task and its threads
  from the local SQLite database (`~/.code-monkey/code-monkey.db`). Useful for
  diagnosing stuck or blocked tasks. Accepts either a full task id or a unique
  prefix and prints the project, task, threads, event counts, and the 10 most
  recent thread events as JSON. Requires better-sqlite3 to be built for the
  Node ABI (re-run after a Node version change).

## Testing

- Put test files next to the implementation.
- Prefer `toEqual` over `toBe`
- Compare entire objects instead of single properties.
  `expect(product).toEqual({ id: 1, name: 'Cup' })`
- UI tests use Vitest + React Testing Library. The renderer-side Vitest setup
  lives in `src/renderer/test-setup.ts`.
