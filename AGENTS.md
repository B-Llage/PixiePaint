# Working on Pixie Paint

This directory is the Git repository and Next.js app root. Use its `package.json` and `package-lock.json` for app commands and dependency changes. The parent directory is a local workspace wrapper, not part of this repository.

## Before changing code

- Read [ARCHITECTURE.md](./ARCHITECTURE.md) for the editor's state and rendering flow.
- Check `git status` and preserve unrelated working-tree changes.
- Stop and restart a running Next.js dev server when installing or replacing dependencies; its Turbopack modules can become stale while the process stays alive.
- Keep pixel operations that do not require React in small pure functions so their behavior can be tested directly.

## Completion rule

- Add or update a regression test with every new feature or bug fix. Test the user-visible behavior and important edge cases, not implementation details alone.
- Run `npm run check` from this directory and make it pass before marking a task complete. This runs lint, TypeScript, and the full test suite. Run `npm run build` when changing Next.js configuration or production rendering.
- Do not skip, delete, or weaken a failing test to make the gate green. Fix the behavior or the test's incorrect expectation. Report any check that could not run.
- Update [ARCHITECTURE.md](./ARCHITECTURE.md) when the state model, data flow, or subsystem boundaries change.

## Test placement

Place tests beside the behavior they cover as `*.test.ts` or `*.test.tsx`. Use Vitest for pure logic and React Testing Library for component or hook behavior. Keep canvas and browser API mocks local to tests that need them. Prefer observable behavior over snapshots.
