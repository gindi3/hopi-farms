#!/usr/bin/env bash
# Ship the latest pushed code to the droplet and restart the game.
#
#   ./deploy/deploy.sh
#
# Defaults to root@206.189.172.171 with the ~/.ssh/frontporch_cloud key; override with
# HOPI_HOST and HOPI_KEY.
#
# Run it from your computer after committing. It pushes main, pulls it on the server,
# runs the tests there, and restarts the service only if they pass.
set -euo pipefail

HOST="${HOPI_HOST:-root@206.189.172.171}"
KEY="${HOPI_KEY:-$HOME/.ssh/frontporch_cloud}"
cd "$(dirname "$0")/.."

if [ -n "$(git status --porcelain)" ]; then
  echo "You have uncommitted changes. Commit them first (only pushed commits are deployed)." >&2
  exit 1
fi

echo "==> Pushing main"
git push origin main

echo "==> Updating $HOST"
ssh -i "$KEY" -o ConnectTimeout=15 "$HOST" 'bash -s' <<'REMOTE'
set -euo pipefail
APP=/opt/hopi-farms
NODE="$(systemctl show -p ExecStart hopi-farms | grep -o 'path=[^ ;]*' | cut -d= -f2)"
git -C "$APP" pull --ff-only
cd "$APP"
if ! "$NODE" --disable-warning=ExperimentalWarning --test tests/*.test.js >/tmp/hopi-tests.log 2>&1; then
  echo "Tests failed on the server; not restarting. See /tmp/hopi-tests.log" >&2
  exit 1
fi
systemctl restart hopi-farms
sleep 1
curl -fsS http://127.0.0.1:5190/api/leaderboard >/dev/null && echo "Restarted; game is up at $(git rev-parse --short HEAD)"
REMOTE
