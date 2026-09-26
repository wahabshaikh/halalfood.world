# halalfood.world features

Public surfaces of the `@halalfood/web` Worker. Drive them in Playwright against `http://localhost:3000` after `scripts/doctor.sh` exits 0. A fresh local D1 database has no places, so several end states below are the empty directory.

| Feature | Route | File |
| --- | --- | --- |
| Explore | `/` | [explore.md](explore.md) |
| Search | `/search?q=` | [search.md](search.md) |
| Cities | `/cities` | [cities.md](cities.md) |
| Map | `/map` | [map.md](map.md) |
| Community | `/leaderboard` | [community.md](community.md) |

Authenticated flows (sign-in, save, add a place) stay undriven until `apps/web/.dev.vars` has `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `TURNSTILE_SITE_KEY`, and `TURNSTILE_SECRET_KEY`. Login is fail-closed without Turnstile.
