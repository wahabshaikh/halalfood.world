@AGENTS.md

## Claude Code

- Skills: `/preflight`, `/ship-feature`, `/d1-migration`, `/steward` (see `.claude/skills/`). Path-scoped
  rules in `.claude/rules/` load automatically when you touch matching files.
- Cloud sessions run `.claude/hooks/session-start.sh` first: it installs dependencies, applies local
  D1 migrations and loads `seed/local.sql`, so lint, tests, build and `pnpm dev` work straight away. It also points
  `PLAYWRIGHT_CHROMIUM_EXECUTABLE` at the preinstalled `/opt/pw-browsers/chromium`, so run E2E with
  `--project=chromium` and never run `playwright install`.
- `.claude/settings.json` asks before deploys, `--remote` wrangler commands and `wrangler secret`.
  Treat that prompt as a stop sign unless the user asked for that exact action.
- Before calling work done, run `/preflight` and quote its results in your reply or PR body.
