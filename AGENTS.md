# Instructions for coding agents

Read `docs/ARCHITECTURE.md` before writing code. These rules are not optional.

## Stack
- Node 20.12, TypeScript 5.9 strict, ESM (`"type": "module"`). Relative imports **must** end in `.js`, for example `import { ok } from '../shared/envelope.js'`.
- Hono 4 (HTTP), zod 4 (validation), better-sqlite3 12 (DB), Vitest 3 (tests).
- **Do not add, remove or upgrade dependencies.** `node_modules` is shared and read-only for you. If something seems missing, use what's installed or the Node standard library.

## Gates (all must pass)
`npm run typecheck` · `npm run lint` · `npm run test:coverage` (80% lines, functions and statements; 75% branches)

## Conventions
- Throw `AppError` from `src/shared/errors.ts` for expected failures. Never return error objects ad hoc, and never leak internal details in messages.
- JSON responses use `ok()` / `fail()` from `src/shared/envelope.ts`. Hono apps use `createErrorHandler()` from `src/shared/http.ts`.
- Validate every untrusted input with zod (`parseInput` / `parseJsonBody`).
- Immutability: return new objects and never mutate inputs. Exported types use `readonly` fields.
- Add explicit parameter and return types on exported functions. Never use `any`; use `unknown` and narrow it.
- Child processes: `execFile` / `spawn` with an argument array. **Never** `shell: true`, never string interpolation into a command. Validate refs and paths from users (reject a leading `-`, `..` segments, NUL, and control characters).
- No `console.log`. Log through injected loggers (`console.error` / `console.warn` only inside default logger implementations).
- Time comes from an injected `Clock` (`src/shared/clock.ts`). IDs come from `newId(prefix)` (`src/shared/ids.ts`).
- Keep files small (aim for under 400 lines) and functions under 50 lines.
- Tests go next to the code as `*.test.ts`. Use real temporary directories (`fs.mkdtemp` under `os.tmpdir()`) and real `git` for git-related tests, and clean up in `afterEach`/`afterAll`. Tests must also pass on Windows: use `path.join` and don't assume `/` paths or POSIX shells.
- Only touch the files your task owns. If you need something from another module, code against its documented contract.
