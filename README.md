# Pixie Paint

A browser-based pixel art editor built with Next.js and React.

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the editor's design and [AGENTS.md](./AGENTS.md) for contribution and testing rules.

Run `npm run check` before considering a change complete. It runs lint, TypeScript, and the test suite. Use `npm run test:watch` while developing.

## Releases

Changelog entries live in [app/changelog.json](./app/changelog.json). The in-app changelog and the GitHub Release notes are both generated from it, and a test checks that the newest entry matches the version in `package.json`.

To release:

1. Bump the version with `npm version x.y.z --no-git-tag-version` (updates `package.json` and `package-lock.json`).
2. Add a matching entry at the top of `app/changelog.json`.
3. Merge to `main`. The workflow runs the checks, then creates the `vx.y.z` tag and a GitHub Release with that entry's notes if the tag does not exist yet. Preview the notes with `node scripts/release-notes.mjs x.y.z`.

## Getting Started

Install dependencies and start the development server:

```bash
npm ci
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Run `npm run build` to verify a production build.
