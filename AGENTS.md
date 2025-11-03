# Repository Guidelines

## Project Structure & Module Organization
- Cloudflare Worker source: `src/index.ts` (Hono router, scraping engine, API, cron scheduler, OpenAPI builders).
- Frontend SPA: `public/index.html` (React + Mantine dashboard served via the `ASSETS` static binding).
- Configuration: `wrangler.toml` (Worker entry, compatibility flags, bindings, cron schedule, and asset directory).
- Database migrations: `migrations/` (D1 schema managed via Wrangler migrations).
- Legacy Node script retained as reference: `index.js`.
- Tests and utilities: `test.js`, `scripts/`, `analyze_payload.py`.

## Build, Test, and Development Commands
- `npm install` — install dependencies for local tooling and Wrangler bundling.
- `npm test` — run unit tests in `test.js` (legacy coverage).
- `wrangler dev` — run the Worker locally with bound D1 and asset serving.
- `wrangler d1 migrations apply linkedin-scraper` — apply the latest schema to the D1 database.

## Coding Style & Naming Conventions
- Worker authored in modern TypeScript (ES modules). Maintain 2-space indentation.
- Prefer descriptive async function names (`runScrape`, `logAction`).
- Keep Worker logic stateless; rely on bindings instead of globals where possible.
- Frontend relies on Mantine components; keep JSX concise and declarative.

## Cloudflare Worker Notes
- Always log API and cron events via `action_logs` (INSERT with structured metadata).
- Use Cloudflare Cache API (`caches.default`) for LinkedIn fetches (1-hour TTL).
- D1 queries must use prepared statements with bound parameters for safety.
- When adding bindings update `wrangler.toml` and reflect the change here.
- Static assets are served through `env.ASSETS.fetch`, falling back to `/index.html` for SPA routing.

## Frontend Notes
- SPA is bundled inside `public/index.html` using UMD builds of React/Mantine and Babel runtime.
- Keep network calls pointing to `/api/*` to leverage same-origin Worker routes.
- Ensure interactive components gracefully handle loading/error states.

## Testing Guidelines
- End-to-end checks via `wrangler dev` with mock data recommended.
- When modifying scraper parsing, add fixtures or describe verification steps in PRs.
- **Before submitting any pull request, you must run `npm test` (and any other relevant checks) and include the results in the PR summary.**

## Commit & Pull Request Guidelines
- Commits: present tense, concise scope (e.g., `feat: add logs endpoint`).
- PRs: include summary, motivation, screenshots/logs for parsing changes, and steps to verify.
- Link related issues and note breaking changes.
- Update README examples if the API contract shifts.

## Security & Configuration Tips
- Do not hardcode credentials. Configure D1 binding via Wrangler secrets/bindings.
- Respect LinkedIn rate limits; scheduled cron runs sequential scrapes intentionally.
- Sanitize and validate incoming API payloads.

## Architecture Overview
- `runScrape` composes LinkedIn guest search URLs (ported from `index.js` Query logic).
- Responses cached via Cache API, parsed with Cheerio, deduped into `job_postings`.
- API exposes profile CRUD, ad-hoc/profile scrapes, job listings, logs, and OpenAPI spec.
- Cron handler fetches active profiles and scrapes sequentially to avoid rate limits.
- Frontend dashboard provides management UI backed by Worker APIs.
