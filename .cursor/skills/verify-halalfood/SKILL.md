---
name: verify-halalfood
description: Verify the halalfood.world web app (the @halalfood/web Cloudflare Worker UI at apps/web) in a browser against an isolated seeded local database. Use when checking Explore, search, cities, the map, or the community leaderboard.
---

# Verify halalfood.world

The primary surface is the web UI served by the `@halalfood/web` Worker. The same process also exposes JSON under `/api/*`. There is no user-facing CLI. Ops backfill scripts in `apps/web/scripts/` talk to remote D1 and are out of scope here.

Launch creates a private local D1 under `.cursor/skills/verify-halalfood/.run/persist` and seeds it from `seed/verify.sql`. That directory is not `apps/web/.wrangler/state`. `npm run dev` without `HALALFOOD_PERSIST_PATH` still uses the developer database. This skill never passes `--remote` and never reads or writes production D1 or worker secrets.

A second dev server cannot run at the same time. `vinext dev` writes `apps/web/.vinext/dev/lock.json` and refuses another start in `apps/web`, including a different `PORT` or a different `HALALFOOD_PERSIST_PATH`. Do not start another instance, and do not kill a server this skill did not start. Sequential runs do not share a database: a fresh launch deletes `.run/persist` and builds a new one. While the server this skill started is still up, launch reuses it and does not reseed.

`tests/browser-smoke.mjs` still uses `.explore-hero`, `.place-row`, `.rating-marker`, and `.map-selected`. Those classes are not in the current UI. Drive with the roles in `features/`.

## Launch

From the repo root, with Node 22:

```sh
npm ci
.cursor/skills/verify-halalfood/scripts/launch.sh
```

`npm ci` is once per checkout. On a fresh start the launch script:

1. Deletes `.run/persist` so this run cannot see a previous verification database.
2. Applies `apps/web` migrations with `wrangler d1 migrations apply halalfood-world --local --persist-to` that directory. It does not pass `--remote`.
3. Loads `seed/verify.sql` with `wrangler d1 execute --local --persist-to` the same directory.
4. Starts `npm run dev` with `HALALFOOD_PERSIST_PATH` set to that directory, and with `GOOGLE_PLACES_API_KEY` and `GOOGLE_MAPS_API_KEY` removed from the process environment. Turborepo forwards `HALALFOOD_PERSIST_PATH` into `vinext dev`. Vite then points the Cloudflare plugin's local persistence at that directory.

The seed is nine places (London 4, Mumbai 3, Manchester 2), two fixture users, one approved halal check, two reviews, and one visit signal. Rows are fixed. `google_details_cached_at` is the clock at seed time so each Google snapshot is inside the app's 7-day cache. Place pages therefore render the stored snapshot. This environment does not call `places.googleapis.com`, `maps.googleapis.com`, production D1, Resend, Turnstile, or an OAuth provider. Fixture emails are `@verify.halalfood.local` and are not inboxes.

Ready means `GET http://localhost:3000/` returns 200, the body contains `Search halal places or cities`, and it is not the Vite overlay (`<title>Error</title>`). The script waits up to 180 seconds. Vite listens on IPv6 `::1` only, so `http://127.0.0.1:3000/` is connection refused. Use `http://localhost:3000`.

No `.dev.vars` is required. If `apps/web/.dev.vars` defines `GOOGLE_PLACES_API_KEY` or `GOOGLE_MAPS_API_KEY`, doctor refuses. Do not edit or delete that file from this skill.

Teardown is `scripts/cleanup.sh`. It signals the recorded process group and deletes `.run/`, including the verification database. It leaves `evidence/` and `apps/web/.wrangler/` in place.

## Doctor

Run this before driving, and again whenever a page looks wrong:

```sh
.cursor/skills/verify-halalfood/scripts/doctor.sh
```

Exit 0 means the instance is worth driving. The script is read-only. It checks:

- `apps/web/.vinext/dev/lock.json` names a live pid whose cwd is `apps/web`, on port 3000, at `http://localhost:3000`.
- That pid is the process we launched, or a descendant of `.run/pid`.
- Port 3000's listening socket belongs to that process tree.
- The vinext process was started with `HALALFOOD_PERSIST_PATH` pointing at `.run/persist`, and without a Google API key in its environment.
- `GET /` is the explore shell (search label present, not the Vite error title, title text identifies halalfood.world).
- The seed is loaded: viewport `total` is 9, `GET /api/places/search?q=london&limit=48` returns `total` 4 with Dishoom King's Cross first, `GET /api/cities/london` has `place_count` 4, and `GET /api/leaderboard` ranks Amina Rahman at 34 then Yusuf Ali at 15.

Anonymous public pages are a valid session. The five mapped features do not need a signed-in user. Fixture users are database rows so the leaderboard has names. Login, save, and add stay undriven: they need Turnstile and email OTP, which this environment does not configure. Do not print secret values.

## Drive

Harness is Playwright, already a dependency of `@halalfood/web`. Chromium is whatever `PLAYWRIGHT_CHROMIUM_PATH` points at, otherwise `/opt/google/chrome/chrome` or `/usr/bin/google-chrome`. The recording needs Playwright's ffmpeg once: `npx playwright install ffmpeg`.

Feature files in `features/` are the selector map. Drive every mapped feature:

```sh
node .cursor/skills/verify-halalfood/scripts/drive-features.mjs
```

That script opens the real pages, clicks the real controls, and checks each result against the API or the place URL. `scripts/drive-search.mjs` still drives only search and writes the older `evidence/search-*` files. Prefer `drive-features.mjs` so the seeded proof stays in `evidence/e2e/`.

## Evidence

`drive-features.mjs` writes only under `.cursor/skills/verify-halalfood/evidence/e2e/`:

- `explore.png`, `explore-place.png`, `explore-api.json` — home row, then the Dishoom page and its fixture address
- `search-filled.png`, `search-results.png`, `search-api.json` — the london query and `GET /api/places/search`
- `cities.png`, `city-london.png`, `cities-api.json` — the directory and `GET /api/cities/london`
- `map.png`, `map-selected.png`, `map-api.json` — the opening viewport and the selected-place URL
- `community.png`, `leaderboard-api.json` — Amina Rahman on the board and `GET /api/leaderboard`
- `features-transcript.txt` — the action, the result URL, and the side effect for each feature
- `features-drive.webm` — the same path as one recording

Proof standard for this app:

- Use the header, footer, and routes in `features/`. Do not call a test-only endpoint or set React state directly.
- Keep the before screenshot and the after screenshot. The transcript has to name the action, not only the final screen.
- Each feature records a side effect: an API body, the place or map URL, or both.
- The drive must not POST to this origin and must not request `places.googleapis.com` or `maps.googleapis.com`. Fonts and map tiles are not that boundary.
- Do not mock D1, the Worker, or the handlers. The database is the seeded local file.

`evidence/` is gitignored. Cleanup must not delete it. The earlier empty-directory search proof, if present, lives in `evidence/` next to `e2e/` and is not replaced by this drive.

## Cleanup

```sh
.cursor/skills/verify-halalfood/scripts/cleanup.sh
```

The script reads `.run/pid` and signals that process group (`SIGTERM`, then `SIGKILL` if it is still alive after ten seconds). It does not scan the process table by name. It removes `.run/` (pid file, `dev.log`, and `.run/persist`) and leaves `evidence/` and `apps/web/.wrangler/` alone. After it returns, list `evidence/e2e/` and confirm the proof files are still there.

If launch exited 2, a server is running that this skill did not start. Leave it up.

## Helpers

| Script | Invoke |
| --- | --- |
| `scripts/launch.sh` | `.cursor/skills/verify-halalfood/scripts/launch.sh` |
| `scripts/doctor.sh` | `.cursor/skills/verify-halalfood/scripts/doctor.sh` |
| `scripts/drive-features.mjs` | `node .cursor/skills/verify-halalfood/scripts/drive-features.mjs` |
| `scripts/drive-search.mjs` | `node .cursor/skills/verify-halalfood/scripts/drive-search.mjs` |
| `scripts/cleanup.sh` | `.cursor/skills/verify-halalfood/scripts/cleanup.sh` |
| `seed/verify.sql` | applied by launch; do not run it with `--remote` |

`drive-features.mjs` and `drive-search.mjs` write evidence. `doctor.sh` and `cleanup.sh` never start a server.
