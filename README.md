# Pixie Paint

A browser-based pixel art editor built with Next.js and React.

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the editor's design and [AGENTS.md](./AGENTS.md) for contribution and testing rules.

Run `npm run check` before considering a change complete. It runs lint, TypeScript, and the test suite. Use `npm run test:watch` while developing.

## Releases

The current release notes are in [RELEASE_NOTES.md](./RELEASE_NOTES.md), and the in-app changelog is in `app/components/PixelPencil/Settings/ChangelogModal.tsx`. Keep both aligned with the version in `package.json` and `package-lock.json`.

The GitHub workflow runs checks before releasing from `main`. If the package version has been prepared ahead of time and has no matching tag, it tags that version without bumping it again. Otherwise, commits starting with `major:`, `feature:`, or `patch:` trigger the corresponding automatic version bump.

## Getting Started

Install dependencies and start the development server:

```bash
npm ci
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Run `npm run build` to verify a production build.
