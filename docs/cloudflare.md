# Cloudflare architecture

halalfood.world runs as **one Cloudflare Worker** (`halalfood-world`) built with
[vinext](https://github.com/cloudflare/vinext). The Worker serves server-rendered
pages, the `/api` routes and the static assets. There are no other Workers, no
KV namespaces and no Durable Objects.

```
                    ┌──────────────────────────── halalfood-world Worker ─┐
 halalfood.world ──▶│ vinext (RSC/SSR pages, /api routes)                 │
                    │   ASSETS            static files from dist/client   │
                    │   DB                D1 halalfood-world              │
                    │   HALAL_EVIDENCE_R2 R2 halalfood-world-evidence     │
                    └─────────────────────────────────────────────────────┘
 External APIs (fetch): Resend (email), Turnstile (bot check), Google Places, DataFast, Crisp
```

## Bindings

Every binding is declared in [`apps/web/wrangler.jsonc`](../apps/web/wrangler.jsonc).
Never add a binding, variable or resource in the dashboard: the next deploy
would remove it, and nobody reading the repo would know it exists.

| Binding | Type | Production resource | Preview resource | Read in |
| --- | --- | --- | --- | --- |
| `DB` | D1 | `halalfood-world` | `halalfood-world-pr-<n>` (one per PR) | `apps/web/src/db/index.ts` |
| `HALAL_EVIDENCE_R2` | R2 | `halalfood-world-evidence` | `halalfood-world-evidence-preview` (shared) | `apps/web/src/lib/r2.ts` |
| `ASSETS` | Static assets | `dist/client` | same build | vinext |

Bindings are read through `import("cloudflare:workers")` and fail closed when
they are missing, so Node tests and scripts run without them.

### Adding a binding

1. Add it to `apps/web/wrangler.jsonc` (and to `src/cloudflare-workers.d.ts`).
2. If it is a storage resource, decide what previews use. Previews must never
   point at production data: extend `rebindForPreview` in
   [`apps/web/scripts/preview.mjs`](../apps/web/scripts/preview.mjs) and create
   the preview resource there if it does not exist.
3. Document it in the table above.

## Configuration and secrets

Public configuration is in `vars` in `wrangler.jsonc`. Secrets are set once per
Worker with `npx wrangler secret put <NAME>` (run from `apps/web`) and are
inherited by every deploy and preview version.

| Name | Kind | Purpose |
| --- | --- | --- |
| `BETTER_AUTH_URL` | var | Public origin. Previews override it with their own URL. |
| `EMAIL_FROM` | var | Sender for sign-in codes (`noreply@halalfood.world`, verified in Resend). |
| `TURNSTILE_SITE_KEY` | var | Public Turnstile site key rendered on `/login`. |
| `BETTER_AUTH_SECRET` | secret | Session signing, 32+ characters. |
| `RESEND_API_KEY` | secret | Sends sign-in codes. |
| `TURNSTILE_SECRET_KEY` | secret | Verifies Turnstile tokens. |
| `GOOGLE_PLACES_API_KEY` | secret | Optional. Google Places lookups (`GOOGLE_MAPS_API_KEY` is an accepted fallback). |
| `EMAIL_HEALTHCHECK_*` | var/secret | Optional operator email check, off unless `EMAIL_HEALTHCHECK_ENABLED=true`. |

Local values go in `apps/web/.dev.vars`; copy
[`apps/web/.dev.vars.example`](../apps/web/.dev.vars.example), which uses
Turnstile's always-pass test keys.

## Environments

| | Local | Pull request preview | Production |
| --- | --- | --- | --- |
| URL | `http://localhost:3000` | `https://pr-<n>-halalfood-world.<subdomain>.workers.dev` | `https://halalfood.world` |
| Runs | `npm run dev` (Vite + workerd) | Worker version with a preview alias | Deployed Worker version |
| D1 | local SQLite in `.wrangler/state` | `halalfood-world-pr-<n>`, empty + migrations | `halalfood-world` |
| R2 | local | `halalfood-world-evidence-preview` | `halalfood-world-evidence` |
| Secrets | `.dev.vars` | production secrets | production secrets |
| Triggered by | you | every push to a same-repo PR | every push to `main` |

### Pull request previews

[`.github/workflows/preview.yml`](../.github/workflows/preview.yml) runs on every
push to a pull request from this repository:

1. Builds the app.
2. `scripts/preview.mjs setup` creates or reuses the PR's D1 database, makes
   sure the preview R2 bucket exists, and rewrites the generated
   `dist/server/wrangler.json` so `DB` and `HALAL_EVIDENCE_R2` point at them.
3. Applies every migration to the PR database.
4. Uploads a Worker version with `wrangler versions upload --preview-alias pr-<n>`.
   Uploading a version never changes what production serves.
5. Comments the URL on the PR and records a GitHub deployment in the `preview`
   environment.

When the PR closes, `scripts/preview.mjs cleanup` deletes the PR's versions and
its D1 database. Fork and Dependabot PRs get CI but no preview, because they
cannot read the deployment secrets.

Previews share production **secrets** (Resend, Turnstile, Google), so sign-in
codes from a preview are real emails. Previews never share production **data**.

### Production deploys

[`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml) runs on every
push to `main` (and on demand): typecheck, test, build, apply D1 migrations with
`npm run db:migrate:remote`, then `wrangler deploy`. Deploys are serialized and
never cancelled halfway. Migrations run before the new code goes live, so every
migration must be backwards compatible with the version still serving traffic
(add columns and tables; do not drop or rename in the same change).

`db:migrate:remote` (`apps/web/scripts/apply-d1-migrations.ts`) wraps wrangler's
migration tracking with guards for this database's history: it refuses
`DROP TABLE` and rebuilding `places`, and skips `ADD COLUMN` statements for
columns production already has. Do not apply migrations to production with raw
`wrangler d1 migrations apply`.

To roll back, pick an earlier version under **Workers & Pages → halalfood-world
→ Deployments** in the dashboard, or run
`npx wrangler rollback` from `apps/web`. Rolling back code does not roll back
migrations.

### Observability

Workers Logs are on for every request and 5% of requests are traced
(`observability` in `wrangler.jsonc`). Read them under **Workers & Pages →
halalfood-world → Observability**, or stream them with
`npx wrangler tail halalfood-world` from `apps/web`.

## CI

[`.github/workflows/ci.yml`](../.github/workflows/ci.yml) runs
`npm run typecheck`, `npm test` and `npm run build` on every pull request
(including forks) and on `main`.

## One-time setup for a new Cloudflare account

For forks or a fresh account:

```sh
cd apps/web
npx wrangler login
npx wrangler d1 create halalfood-world          # put the id in wrangler.jsonc
npx wrangler r2 bucket create halalfood-world-evidence
npx wrangler secret put BETTER_AUTH_SECRET
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put TURNSTILE_SECRET_KEY
npx wrangler secret put GOOGLE_PLACES_API_KEY
npm run db:migrate:remote
```

Then set `vars` in `wrangler.jsonc` for your domain and Turnstile widget, and
add two GitHub repository secrets:

| Secret | Value |
| --- | --- |
| `CLOUDFLARE_ACCOUNT_ID` | Your account id |
| `CLOUDFLARE_API_TOKEN` | API token with **Workers Scripts: Edit**, **D1: Edit** and **Workers R2 Storage: Edit** |

Attach the custom domain under **Workers & Pages → halalfood-world → Settings →
Domains & Routes**. Do not connect Workers Builds (the dashboard Git
integration): production deploys come from `deploy.yml`, and a second deploy
path would skip the migrations.

## Operations

### Moderating community evidence by hand

Approval adds community evidence to the place page; it does not create a formal
certification or change the listing flag. The admin console covers this; the
SQL equivalent is:

```sh
cd apps/web
npx wrangler d1 execute halalfood-world --remote --command "
  UPDATE place_halal_verifications
  SET status = 'approved', updated_at = unixepoch() * 1000
  WHERE id = '<verification id>' AND status = 'pending'
"
```

### R2 uploads

Uploads go Worker-direct into `HALAL_EVIDENCE_R2`; there are no S3 credentials
and the bucket is private. Uploads are capped at 8 MiB, limited to JPEG, PNG,
WebP and PDF, signature-checked, and stored under account-hashed keys
(`photos/<hashed-owner>/<uuid>.<ext>` for place photos). Objects are served only
through access-checked routes.

### Migrating data from Neon

The app previously ran on Neon/Postgres. The one-time import was: export each
table to CSV, convert rows to `INSERT` statements for the D1 schema (text ids,
epoch-millisecond timestamps, `0`/`1` booleans, JSON-array text for
`places.serves_cuisine`), load them with
`npx wrangler d1 execute halalfood-world --remote --file=<file>.sql`, and
compare row counts.
