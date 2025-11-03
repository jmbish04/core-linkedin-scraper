# Repository Guidelines

## Project Structure & Module Organization
- Source: `index.js` (core query, parsing, caching)
- Tests: `test.js`
- Package metadata: `package.json`, lockfile
- Docs: `README.md`

## Build, Test, and Development Commands
- `npm install` — install dependencies
- `npm test` — run unit tests in `test.js`
- `node test.js` — ad-hoc local run for manual checks
- `npm pack` — create local tarball for testing installs

## Coding Style & Naming Conventions
- JavaScript (Node 18+). Use 2-space indentation.
- Prefer descriptive names (`queryOptions`, `fetchJobBatch`).
- Functions: `camelCase`; constants: `UPPER_SNAKE_CASE`.
- Keep modules small; avoid side effects at import time.
- Formatting: follow existing style; run a formatter if configured.

## Testing Guidelines
- Framework: Node assert-style tests in `test.js`.
- Add tests alongside modifications; cover parsing, URL building, and rate-limit behavior.
- Name tests after feature: `query-url.spec`, `parser.spec` (if split later).
- Run with `npm test`; aim to keep tests deterministic and offline.

## Commit & Pull Request Guidelines
- Commits: present tense, concise scope (e.g., `feat: add salary filter`, `fix: handle 429 backoff`).
- PRs: include summary, motivation, screenshots/logs for parsing changes, and steps to verify.
- Link related issues and note breaking changes.
- Keep diffs minimal; update README examples if behavior or parameters change.

## Security & Configuration Tips
- Network calls target LinkedIn guest endpoints; respect robots/ToS in your jurisdiction.
- Do not hardcode tokens or PII. Use environment variables for host overrides.
- Avoid aggressive concurrency; keep polite delays to reduce 429s.

## Architecture Overview
- Query builder composes URL params from options.
- Fetch layer uses Axios with randomized `User-Agent` and backoff.
- Parser uses Cheerio to extract fields; cache stores recent results with TTL.
