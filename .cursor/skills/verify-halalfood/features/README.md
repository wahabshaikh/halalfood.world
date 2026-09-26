# halalfood.world features

Public surfaces of the `@halalfood/web` Worker. Drive them in Playwright against `http://localhost:3000` after `scripts/doctor.sh` exits 0. Launch seeds nine places, so each feature below has a visible result. An empty directory means the verification database was not the one that answered.

| Feature | Route | File |
| --- | --- | --- |
| Explore | `/` | [explore.md](explore.md) |
| Search | `/search?q=` | [search.md](search.md) |
| Cities | `/cities` | [cities.md](cities.md) |
| Map | `/map` | [map.md](map.md) |
| Community | `/leaderboard` | [community.md](community.md) |

The seed's fixture users (Amina Rahman, Yusuf Ali) are rows for the leaderboard. They are not a signed-in session. Login, save, and add stay undriven: they need Turnstile and email OTP, which this environment does not configure.
