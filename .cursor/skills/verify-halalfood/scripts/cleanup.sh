#!/usr/bin/env bash
# Stop the dev server this skill started. Does not delete evidence/.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
SKILL="$ROOT/.cursor/skills/verify-halalfood"
RUN="$SKILL/.run"
PID_FILE="$RUN/pid"
EVIDENCE="$SKILL/evidence"

if [[ ! -f "$PID_FILE" ]]; then
  echo "cleanup: no recorded pid at $PID_FILE (nothing this skill started)"
  exit 0
fi

pid="$(tr -d '[:space:]' <"$PID_FILE")"
if [[ ! "$pid" =~ ^[0-9]+$ ]]; then
  echo "cleanup: pid file does not contain a pid" >&2
  exit 1
fi

if kill -0 "$pid" 2>/dev/null; then
  echo "cleanup: stopping process group $pid"
  kill -TERM -- "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    if ! kill -0 "$pid" 2>/dev/null; then
      break
    fi
    sleep 1
  done
  if kill -0 "$pid" 2>/dev/null; then
    echo "cleanup: process group $pid did not exit; sending SIGKILL"
    kill -KILL -- "-$pid" 2>/dev/null || kill -KILL "$pid" 2>/dev/null || true
    sleep 1
  fi
else
  echo "cleanup: recorded pid $pid is already gone"
fi

if kill -0 "$pid" 2>/dev/null; then
  echo "cleanup: pid $pid is still running" >&2
  exit 1
fi

rm -rf "$RUN"
echo "cleanup: removed $RUN"
echo "cleanup: left evidence in $EVIDENCE"
