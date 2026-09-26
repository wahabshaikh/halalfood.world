#!/usr/bin/env bash
# Start the halalfood.world web dev server for verification.
# Records the process-group pid under .run/ and does not return until HTTP is ready.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
SKILL="$ROOT/.cursor/skills/verify-halalfood"
RUN="$SKILL/.run"
LOCK="$ROOT/apps/web/.vinext/dev/lock.json"
BASE_URL="http://localhost:3000"
mkdir -p "$RUN" "$SKILL/evidence"

if [[ ! -x "$ROOT/node_modules/.bin/vinext" ]]; then
  echo "launch: node_modules is missing. From $ROOT run: npm ci" >&2
  exit 1
fi

set +e
python3 - "$LOCK" "$RUN/pid" <<'PY'
import json, os, sys
lock_path, pid_path = sys.argv[1], sys.argv[2]

def alive(pid):
    if not isinstance(pid, int) or pid <= 0:
        return False
    try:
        os.kill(pid, 0)
        return True
    except OSError as err:
        return err.errno == 1  # EPERM: exists, owned by someone else

def ancestors(pid):
    seen = set()
    while isinstance(pid, int) and pid > 1 and pid not in seen:
        seen.add(pid)
        try:
            raw = open(f"/proc/{pid}/stat").read()
        except OSError:
            break
        end = raw.rfind(")")
        if end < 0:
            break
        parts = raw[end + 2 :].split()
        if len(parts) < 2:
            break
        pid = int(parts[1])
    return seen

lock = None
if os.path.exists(lock_path):
    try:
        lock = json.load(open(lock_path))
    except json.JSONDecodeError:
        lock = None

recorded = None
if os.path.exists(pid_path):
    text = open(pid_path).read().strip()
    if text.isdigit():
        recorded = int(text)

if lock and alive(lock.get("pid")):
    owned = recorded is not None and (
        lock["pid"] == recorded or recorded in ancestors(lock["pid"])
    )
    if owned:
        print(f"launch: dev server already running (pid {lock['pid']}) at {lock.get('appUrl')}")
        sys.exit(0)
    print(
        "launch: another vinext dev server is already running and this skill did not start it.",
        file=sys.stderr,
    )
    print(
        f"  pid: {lock.get('pid')}  url: {lock.get('appUrl')}  cwd: {lock.get('cwd')}",
        file=sys.stderr,
    )
    print("  Do not kill it. Two instances cannot share apps/web.", file=sys.stderr)
    sys.exit(2)
sys.exit(10)
PY
status=$?
set -e

if [[ "$status" -eq 2 ]]; then
  exit 2
fi
if [[ "$status" -ne 0 && "$status" -ne 10 ]]; then
  exit "$status"
fi

if [[ "$status" -eq 10 ]]; then
  echo "launch: applying local D1 migrations"
  npm run db:migrate:local

  echo "launch: starting npm run dev"
  : >"$RUN/dev.log"
  # setsid makes npm the leader of a new process group. Cleanup kills that group only.
  setsid npm run dev >>"$RUN/dev.log" 2>&1 < /dev/null &
  echo $! >"$RUN/pid"
  echo "launch: recorded process-group pid $(cat "$RUN/pid")"
fi

deadline=$((SECONDS + 180))
ready=0
while (( SECONDS <= deadline )); do
  if ! kill -0 "$(cat "$RUN/pid")" 2>/dev/null; then
    echo "launch: dev process exited before it was ready" >&2
    tail -n 40 "$RUN/dev.log" >&2 || true
    exit 1
  fi
  html="$(curl -fsS --max-time 25 "$BASE_URL/" 2>/dev/null || true)"
  if [[ "$html" == *"Search halal places or cities"* && "$html" != *"<title>Error</title>"* ]]; then
    ready=1
    break
  fi
  sleep 2
done

if [[ "$ready" -ne 1 ]]; then
  echo "launch: server did not become ready at $BASE_URL within 180s" >&2
  echo "launch: curl http://127.0.0.1:3000 fails here; use http://localhost:3000 (Vite binds ::1)." >&2
  echo "launch: last log lines:" >&2
  tail -n 40 "$RUN/dev.log" >&2 || true
  exit 1
fi

python3 - "$LOCK" "$BASE_URL" <<'PY'
import json, os, sys
lock_path, base = sys.argv[1:]
if not os.path.exists(lock_path):
    raise SystemExit("launch: HTTP is up but apps/web/.vinext/dev/lock.json is missing")
lock = json.load(open(lock_path))
if lock.get("port") != 3000:
    raise SystemExit(f"launch: expected port 3000, lock says {lock.get('port')}")
print(f"launch: ready {lock.get('appUrl', base)} vinext pid {lock.get('pid')}")
PY
