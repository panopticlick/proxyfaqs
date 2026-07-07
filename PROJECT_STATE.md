# ProxyFAQs Project State

Last updated: 2026-07-07 16:02 +0800

## Production Truth

- Public site: `https://proxyfaqs.com`
- Platform: Cloudflare Pages
- Pages project: `proxyfaqs`
- Latest verified manual production override: `https://f32ce37f.proxyfaqs-909.pages.dev`
- Controlled runtime/build host: OpenClaw
- OpenClaw workspace: `/Users/openclaw/test-workspace/proxyfaqs`
- Canonical manual deploy path: build on OpenClaw, then `wrangler pages deploy dist --project-name proxyfaqs --branch main --commit-dirty=true`

## Verified Production Status

Verified on 2026-07-07 against the live production domain:

- Homepage returns `200` and renders data-backed cards
- Questions index returns `200` and renders `Browse 50 popular questions`
- Category index returns `200` and renders `Explore 10 categories with 2,807+ questions`
- Providers index returns `200` and renders provider cards
- `GET /api/health?verbose=true` returns `200` with database status `ok`
- `GET /api/search?q=proxy&limit=3` returns `200` with real results
- `POST /api/chat` returns `200` with a live model answer, not the fallback apology response
- `POST /api/view/` returns `200`

## Current Runtime Notes

- Static collection pages now fail production builds if critical data fetches return empty results.
- Chat runtime now reads AI settings from Cloudflare runtime env (`locals.runtime.env`) instead of relying on build-time baked values.
- OpenRouter production runtime should have:
  - `OPENROUTER_API_KEY`
  - `OPENROUTER_MODEL`
  - `OPENROUTER_FALLBACK_MODELS`
- Public Supabase runtime/build config should have:
  - `PUBLIC_SUPABASE_URL`
  - `PUBLIC_SUPABASE_ANON_KEY`

## Operational Notes

- `local.env.txt` in this repo is operator-authored notes, not a machine-readable env file.
- The actual project runtime values used during this recovery came from the existing project `.env` plus Cloudflare Pages secrets.
- `PROJECT_STATE.md`, `ops/current-state.json`, and `ops/deploy-ledger.jsonl` are the current runbook truth for future production checks.
- The canonical write endpoint for question view tracking is `POST /api/view/`.

## Remaining Repo State

- Repair commit line:
  - `35598fa fix: restore workers API endpoints`
  - `d8df43f fix: restore production data and runtime chat`
  - `d54b722 docs: record production state and normalize view API`
- Pre-existing worktree drift intentionally left untouched:
  - `D QUICK_DEPLOY.md`
  - `?? _archive/`
