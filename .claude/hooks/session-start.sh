#!/bin/bash
# SessionStart hook for Claude Code cloud sessions: make lint, tests, build and `pnpm dev` work
# without any setup. Local sessions are left alone (you manage your own checkout).
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}"

# `install` (not a clean reinstall) so the cached container's store is reused between sessions.
pnpm install --frozen-lockfile

# Local Miniflare D1 so `pnpm dev` and `pnpm e2e` have a schema and the sample places in seed/local.sql. Offline; idempotent.
pnpm exec wrangler d1 migrations apply DB --local >/dev/null
pnpm exec wrangler d1 execute DB --local --file=seed/local.sql >/dev/null

if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  {
    echo 'export WRANGLER_SEND_METRICS=false'
    echo 'export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1'
    # The pinned Playwright can expect a newer Chromium than the one preinstalled in cloud containers.
    if [ -x /opt/pw-browsers/chromium ]; then
      echo 'export PLAYWRIGHT_CHROMIUM_EXECUTABLE=/opt/pw-browsers/chromium'
    fi
  } >> "$CLAUDE_ENV_FILE"
fi
