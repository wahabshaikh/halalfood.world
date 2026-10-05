#!/usr/bin/env bash
# Install dependencies at the start of a Claude Code session so the agent can
# run `npm run check` straight away. Fast no-op when node_modules is current.
set -euo pipefail
cd "${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel)}"

if [ ! -d node_modules ] || [ package-lock.json -nt node_modules/.package-lock.json ]; then
  npm ci --no-audit --no-fund >&2
fi
