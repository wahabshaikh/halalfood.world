#!/usr/bin/env bash
# Read-only check: is the running dev server worth driving?
# Exit 0 means yes. Does not start, migrate, or kill anything.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
SKILL="$ROOT/.cursor/skills/verify-halalfood"
RUN="$SKILL/.run"
LOCK="$ROOT/apps/web/.vinext/dev/lock.json"
BASE_URL="http://localhost:3000"

python3 - "$ROOT" "$LOCK" "$RUN/pid" "$BASE_URL" <<'PY'
import json, os, sys, urllib.request
root, lock_path, pid_path, base = sys.argv[1:]
failures = []

def alive(pid):
    if not isinstance(pid, int) or pid <= 0:
        return False
    try:
        os.kill(pid, 0)
        return True
    except OSError as err:
        return err.errno == 1

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

def listening_pids(port):
    hex_port = f"{port:04X}"
    inodes = set()
    for path in ("/proc/net/tcp", "/proc/net/tcp6"):
        try:
            lines = open(path).read().splitlines()[1:]
        except OSError:
            continue
        for line in lines:
            parts = line.split()
            local, state, inode = parts[1], parts[3], parts[9]
            if state != "0A":
                continue
            if local.rsplit(":", 1)[-1].upper() != hex_port:
                continue
            inodes.add(inode)
    pids = []
    if not inodes:
        return pids
    for entry in os.listdir("/proc"):
        if not entry.isdigit():
            continue
        fd_dir = f"/proc/{entry}/fd"
        try:
            fds = os.listdir(fd_dir)
        except OSError:
            continue
        for fd in fds:
            try:
                target = os.readlink(f"{fd_dir}/{fd}")
            except OSError:
                continue
            if target.startswith("socket:[") and target[8:-1] in inodes:
                pids.append(int(entry))
                break
    return pids

lock = None
if os.path.exists(lock_path):
    try:
        lock = json.load(open(lock_path))
    except json.JSONDecodeError:
        failures.append("apps/web/.vinext/dev/lock.json is not valid JSON")
else:
    failures.append("no vinext lock at apps/web/.vinext/dev/lock.json (dev server is not up)")

recorded = None
if os.path.exists(pid_path):
    text = open(pid_path).read().strip()
    if text.isdigit():
        recorded = int(text)
else:
    failures.append(f"no recorded pid at {pid_path} (this skill did not launch the server)")

vinext_pid = lock.get("pid") if isinstance(lock, dict) else None
if vinext_pid is not None and not alive(vinext_pid):
    failures.append(f"lock pid {vinext_pid} is not running")
if recorded is not None and not alive(recorded):
    failures.append(f"recorded process-group pid {recorded} is not running")

if isinstance(lock, dict) and alive(vinext_pid) and recorded is not None and alive(recorded):
    chain = ancestors(vinext_pid)
    if recorded != vinext_pid and recorded not in chain:
        failures.append(
            f"port is not owned by this skill: vinext pid {vinext_pid} is not in the tree of recorded pid {recorded}"
        )
    if lock.get("cwd") != os.path.join(root, "apps", "web"):
        failures.append(f"lock cwd is {lock.get('cwd')}, expected {os.path.join(root, 'apps', 'web')}")
    if lock.get("port") != 3000 or lock.get("appUrl") != base:
        failures.append(f"lock url {lock.get('appUrl')} port {lock.get('port')} is not {base}")

listeners = listening_pids(3000)
if not listeners:
    failures.append("nothing is listening on port 3000 (Vite binds ::1; 127.0.0.1 is refused)")
elif vinext_pid and vinext_pid not in listeners and not any(
    recorded is not None and (pid == recorded or recorded in ancestors(pid)) for pid in listeners
):
    # The listener should be the vinext process named in the lock, or a child of the group we started.
    if not any(vinext_pid in ancestors(pid) or pid in ancestors(vinext_pid) for pid in listeners):
        failures.append(f"port 3000 listeners {listeners} are not the vinext pid {vinext_pid}")

def fetch(path):
    try:
        with urllib.request.urlopen(base + path, timeout=30) as response:
            return response.status, response.read().decode("utf-8", "replace")
    except Exception as err:
        return None, str(err)

status, home = fetch("/")
if status != 200 or "Search halal places or cities" not in home or "<title>Error</title>" in home:
    failures.append(f"GET / is not the explore shell (status {status})")
elif "halalfood.world" not in home:
    failures.append("GET / did not identify itself as halalfood.world")

status, api = fetch("/api/places?bbox=-180,-90,180,90&limit=1")
if status != 200:
    failures.append(f"GET /api/places viewport query failed ({status}): {api[:180]}")
else:
    try:
        payload = json.loads(api)
    except json.JSONDecodeError:
        failures.append("GET /api/places did not return JSON")
        payload = None
    if isinstance(payload, dict):
        for key in ("places", "total", "limit"):
            if key not in payload:
                failures.append(f"GET /api/places JSON is missing {key}")
        if payload.get("limit") != 1:
            failures.append(f"GET /api/places ignored limit=1 (limit={payload.get('limit')})")
        if not isinstance(payload.get("places"), list):
            failures.append("GET /api/places `places` is not a list")

# Public pages are anonymous. Authenticated features are a separate gate.
dev_vars = os.path.join(root, "apps", "web", ".dev.vars")
auth_names = ("BETTER_AUTH_SECRET", "BETTER_AUTH_URL", "TURNSTILE_SITE_KEY", "TURNSTILE_SECRET_KEY")
present = set()
if os.path.exists(dev_vars):
    for line in open(dev_vars):
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        name, value = line.split("=", 1)
        if value.strip():
            present.add(name.strip())
missing_auth = [name for name in auth_names if name not in present]
print("doctor: anonymous public routes do not need a session")
if missing_auth:
    print(
        "doctor: authenticated routes (login OTP, save, add) are not worth driving; "
        + "apps/web/.dev.vars is missing "
        + ", ".join(missing_auth)
    )
else:
    print("doctor: apps/web/.dev.vars defines the auth and Turnstile names")

if failures:
    print("doctor: not worth driving", file=sys.stderr)
    for item in failures:
        print(f"  - {item}", file=sys.stderr)
    sys.exit(1)

print(f"doctor: worth driving {base} (vinext pid {vinext_pid}, listener pids {listeners})")
PY
