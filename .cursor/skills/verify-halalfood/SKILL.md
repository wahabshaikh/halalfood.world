---
name: verify-halalfood
description: Verify the halalfood.world web app (the @halalfood/web Cloudflare Worker UI at apps/web) in a browser. Use when checking Explore, search, cities, the map, or the community leaderboard against a locally running dev server.
---

# Verify halalfood.world

The primary surface is the web UI served by the `@halalfood/web` Worker. The same process also exposes JSON under `/api/*`. There is no user-facing CLI. Ops backfill scripts in `apps/web/scripts/` talk to remote D1 and are out of scope here.

Two dev servers cannot run side by side. `vinext dev` writes `apps/web/.vinext/dev/lock.json` and refuses a second start in `apps/web`, including `PORT=3001 npm run dev --workspace=@halalfood/web`. Both would also share the local D1 file under `apps/web/.wrangler/state`. Do not start another instance, and do not kill a server this skill did not start.

`tests/browser-smoke.mjs` still uses `.explore-hero`, `.place-row`, `.rating-marker`, and `.map-selected`. Those classes are not in the current UI. Drive with the roles in `features/`.

## Launch

From the repo root, with Node 22:

```sh
npm ci
.cursor/skills/verify-halalfood/scripts/launch.sh
```

`npm ci` is once per checkout. The launch script applies local D1 migrations (`npm run db:migrate:local`), starts `npm run dev` (Turborepo runs `vinext dev` in `apps/web`), and records that process-group pid in `.cursor/skills/verify-halalfood/.run/pid`.

Ready means `GET http://localhost:3000/` returns 200, the body contains `Search halal places or cities`, and it is not the Vite overlay (`<title>Error</title>`). The log line `Local: http://localhost:3000/` is earlier than ready: the first compile can 500 while Vite reloads. The script waits up to 180 seconds. Vite listens on IPv6 `::1` only, so `http://127.0.0.1:3000/` is connection refused. Use `http://localhost:3000`.

No `.dev.vars` is required for this public launch. Google Places, Resend, and Turnstile are optional and fail closed. A fresh local database has zero places; that is the real directory until data is imported, not a failed boot.

Teardown is `scripts/cleanup.sh`. It signals the recorded process group and deletes `.run/`. It leaves `evidence/` and the local D1 database in place.

## Doctor

Run this before driving, and again whenever a page looks wrong:

```sh
.cursor/skills/verify-halalfood/scripts/doctor.sh
```

Exit 0 means the instance is worth driving. The script is read-only. It checks:

- `apps/web/.vinext/dev/lock.json` names a live pid whose cwd is `apps/web`, on port 3000, at `http://localhost:3000`.
- That pid is the process we launched, or a descendant of `.run/pid`.
- Port 3000's listening socket belongs to that process tree.
- `GET /` is the explore shell (search label present, not the Vite error title, title text identifies halalfood.world).
- `GET /api/places?bbox=-180,-90,180,90&limit=1` returns JSON with `places`, `total`, and `limit: 1`, which means this Worker's D1 binding answered.

Anonymous public pages are a valid session. If `apps/web/.dev.vars` does not define `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `TURNSTILE_SITE_KEY`, and `TURNSTILE_SECRET_KEY`, doctor still passes and prints that login, save, and add are not worth driving. Do not print those values.

## Drive

Harness is Playwright, already a dependency of `@halalfood/web`. Chromium is whatever `PLAYWRIGHT_CHROMIUM_PATH` points at, otherwise `/opt/google/chrome/chrome` or `/usr/bin/google-chrome`. The recording needs Playwright's ffmpeg once: `npx playwright install ffmpeg`.

Feature files in `features/` are the selector map. To prove search end to end:

```sh
node .cursor/skills/verify-halalfood/scripts/drive-search.mjs
```

That opens `/`, fills the searchbox named `Search halal places or cities` with `london`, clicks the button named `Search`, and waits for `/search?q=london` and the heading `Halal places matching “london”`. It then reads `GET /api/places/search?q=london&limit=48` and checks the page against `total`.

## Evidence

The drive script writes only under `.cursor/skills/verify-halalfood/evidence/`:

- `search-filled.png` — the query in the box, before submit
- `search-results.png` — the results page after navigation
- `search-drive.webm` — the same path as a short recording
- `search-api.json` — status and body of the search API
- `search-transcript.txt` — the action, the result URL, the heading, and whether the API total matches the page

Proof standard for this app:

- Use the header form and the routes in `features/`. Do not call a test-only endpoint or set React state directly.
- Keep the before screenshot and the after screenshot. The transcript has to name the action, not only the final screen.
- Search is a GET. Confirm the document request was `GET /search?q=london`, that the API `total` agrees with the copy (`No places found yet` when `total` is 0, otherwise at least one `/place/` link), and that the drive issued no POST to this origin and no `places.googleapis.com` call. Google is a production boundary used by add-a-place, not by search.
- Do not mock D1, the Worker, or the search handler.

This directory is gitignored. Cleanup must not delete it.

## Cleanup

```sh
.cursor/skills/verify-halalfood/scripts/cleanup.sh
```

The script reads `.run/pid` and signals that process group (`SIGTERM`, then `SIGKILL` if it is still alive after ten seconds). It does not scan the process table by name. It removes `.run/` (pid file and `dev.log`) and leaves `evidence/` and `apps/web/.wrangler/` alone. After it returns, list `evidence/` and confirm the proof files are still there.

If launch exited 2, a server is running that this skill did not start. Leave it up.

## Helpers

All four are executable from the repo root:

| Script | Invoke |
| --- | --- |
| `scripts/launch.sh` | `.cursor/skills/verify-halalfood/scripts/launch.sh` |
| `scripts/doctor.sh` | `.cursor/skills/verify-halalfood/scripts/doctor.sh` |
| `scripts/drive-search.mjs` | `node .cursor/skills/verify-halalfood/scripts/drive-search.mjs` |
| `scripts/cleanup.sh` | `.cursor/skills/verify-halalfood/scripts/cleanup.sh` |

`drive-search.mjs` is the only one that writes evidence. `doctor.sh` and `cleanup.sh` never start a server.
