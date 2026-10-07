# halalfood.world

A community map of halal food, built so you can see what people who actually ate there found.

People who eat somewhere answer four questions: Is it Muslim-owned? Is it halal certified? Does it serve pork? Does
it serve alcohol? A fact is settled when the three most recent definite answers from different accounts agree, and a
place is **Community verified** when all four are settled. Until then it shows "n of 3 checks" or "Not checked yet",
which never means "not halal". Follows, lists, recs, events and points help people decide where to eat, but none of
them can change a place's status. The rules live in [`lib/core/halal.ts`](lib/core/halal.ts) and
[`docs/spec/halal-model.md`](docs/spec/halal-model.md).

Built with [vinext](https://github.com/cloudflare/vinext) (the Next.js App Router API on Vite) and deployed as a
single Cloudflare Worker with D1, R2, Email Service, Rate Limiting and Turnstile. The map uses MapLibre GL with
CARTO Positron tiles.

## Quick start

```sh
pnpm install
pnpm db:migrate:local
pnpm db:seed:local   # a few sample places
pnpm dev             # http://127.0.0.1:5173
```

No Cloudflare account or secrets are needed: sign-in works locally, and the email code lands in a local sink
(`/api/test/emails`).

## Docs

- [Contributing](CONTRIBUTING.md) and [agent instructions](AGENTS.md)
- [Testing and verifying changes](docs/testing.md) (`pnpm verify`, `pnpm e2e`, signed-in screenshots with `pnpm shot`)
- [Architecture](docs/architecture.md): routes, API, limits, auth, SEO
- [Deployment and environments](docs/deployment.md) and [operations](docs/operations.md)
- [Product spec](docs/spec/README.md) and [design snapshot](design/social-community.html)
- [Security policy](SECURITY.md) · [Code of conduct](CODE_OF_CONDUCT.md)

Map data © OpenStreetMap contributors (ODbL), basemap © CARTO.

## License

[AGPL-3.0](LICENSE). If you run a modified version as a service, you must publish its source.
