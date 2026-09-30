# Contributing

Thanks for helping build halalfood.world.

## Setup

```sh
npm ci                        # Node 22, see .node-version
cp apps/web/.dev.vars.example apps/web/.dev.vars
npm run db:migrate:local
npm run dev
```

The README covers the product and the repository layout;
[docs/cloudflare.md](docs/cloudflare.md) covers bindings, secrets, previews and deploys.

## Before opening a pull request

```sh
npm run typecheck
npm test
npm run build
```

CI runs the same three commands on every pull request. Pull requests from
branches in this repository also get a preview deployment with its own
database; the URL is commented on the PR.

## Conventions

- **Where code goes.** Platform-agnostic rules go in `packages/core`, UI
  components in `packages/ui`, and everything that touches D1, R2, requests or
  pages in `apps/web`.
- **Database changes** are new files in `apps/web/migrations`, numbered after
  the last one. Migrations run before the new code deploys, so they must work
  with the code already in production: add tables and columns, never drop or
  rename in the same change.
- **Bindings and configuration** live only in `apps/web/wrangler.jsonc`. A new
  storage binding also needs a preview resource (see docs/cloudflare.md).
- **Secrets** never go in code, `vars`, or anything sent to the browser.
- **Halal status** only ever comes from approved evidence. Social features,
  ratings and rankings must not change it.
