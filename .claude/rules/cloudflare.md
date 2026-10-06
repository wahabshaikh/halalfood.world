---
paths:
  - "wrangler.jsonc"
  - "worker/**"
  - "vite.config.ts"
  - "lib/db/**"
  - "lib/environment.ts"
  - "lib/worker-env.ts"
  - "lib/email.ts"
  - "lib/build-guard.ts"
  - "package.json"
  - "docs/deployment.md"
---

# Cloudflare config and the Worker entry

`docs/deployment.md` is the reference for environments, bindings, secrets, deploys and rollback. Keep it
in sync with any change here.

- One Worker serves everything. `worker/index.ts` wraps the vinext fetch handler in Sentry and the public cache.
- `wrangler.jsonc`: the top level is **production**; the `previews` block is what every Worker Preview
  runs with and inherits nothing from the top level.
- Adding a binding or var:
  1. Top level (production resource) **and** `previews` (a `-preview` resource; rate limits use the
     `811xx` namespaces). Never point a Preview at a production D1, R2 or KV.
     `lib/wrangler-config.test.ts` checks this.
  2. Never add `send_email`, queues, routes or crons to `previews`. Preview mail goes to the email sink.
  3. Read it through `readBinding()` / `readWorkerEnv()` in `lib/worker-env.ts`; add it to the
     `cloudflare:workers` declaration in `lib/cloudflare-workers.d.ts` if code reads it by name.
  4. Secrets: add to `.dev.vars.example` and the secrets table in `docs/deployment.md`; never put values
     in the repo. Setting them in Cloudflare is a human step listed under the PR's Rollout.
- "Is this production?" is decided only by `isNonProductionHost()` in `lib/environment.ts` (host +
  `ENVIRONMENT` var), reached through `isNonProductionRequest()`. Links sent out use `linkBase()`.
- `wrangler deploy` / `wrangler preview` read the config vinext writes into `dist/`, so they only work
  after `pnpm build`. Deploys are done by Workers Builds (`pnpm cf:deploy` on `main`, `pnpm cf:preview`
  on branches); don't run them yourself unless asked. Never use `wrangler versions upload`: it uploads a
  version of the production Worker with production bindings. `lib/build-guard.ts` keeps stale npm-based
  Builds settings from doing that.
