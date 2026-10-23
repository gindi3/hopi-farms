#!/usr/bin/env bash
# One-time setup of Hopi Farms on the droplet. Safe to re-run.
#
#   curl -fsSL https://raw.githubusercontent.com/gindi3/hopi-farms/main/deploy/setup.sh -o setup.sh
#   sudo bash setup.sh
#
# The droplet serves sites through a Cloudflare Tunnel (cloudflared), not nginx, so nothing
# here opens ports or needs certificates. What it does:
#   - creates a 'hopi' system user that runs the game
#   - uses Node 22.13+ if installed, otherwise installs a private copy in /opt/hopi-node
#   - clones the game to /opt/hopi-farms
#   - installs and starts the hopi-farms service on 127.0.0.1:5190
#   - installs a daily database backup timer
#   - adds hopifarms.fun to the existing tunnel config, ahead of the catch-all rule, so other
#     sites on the tunnel keep working (the old config is backed up and restored on failure)
set -euo pipefail

REPO=https://github.com/gindi3/hopi-farms.git
APP=/opt/hopi-farms
NODE_DIR=/opt/hopi-node
PORT=5190
HOSTS=(hopifarms.fun www.hopifarms.fun)
TUNNEL_CONFIG=/etc/cloudflared/config.yml

say() { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31mStopped: %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "run this with sudo (or as root)."
command -v apt-get >/dev/null || die "this script expects Ubuntu or Debian."

# --- Packages ------------------------------------------------------------------
NEED=()
command -v git >/dev/null || NEED+=(git)
command -v curl >/dev/null || NEED+=(curl)
command -v xz >/dev/null || NEED+=(xz-utils)
if [ ${#NEED[@]} -gt 0 ]; then
  say "Installing ${NEED[*]}"
  apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "${NEED[@]}"
fi

# --- Node --------------------------------------------------------------------------
node_ok() {
  "$1" -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>22||(a===22&&b>=13)?0:1)' 2>/dev/null
}
NODE=""
if command -v node >/dev/null && node_ok "$(command -v node)"; then
  NODE="$(command -v node)"
elif [ -x "$NODE_DIR/bin/node" ] && node_ok "$NODE_DIR/bin/node"; then
  NODE="$NODE_DIR/bin/node"
else
  say "Installing a private Node 22 in $NODE_DIR (system Node is missing or older than 22.13)"
  case "$(uname -m)" in
    x86_64) ARCH=x64 ;;
    aarch64) ARCH=arm64 ;;
    *) die "unsupported CPU $(uname -m)" ;;
  esac
  BASE=https://nodejs.org/dist/latest-v22.x
  TMP="$(mktemp -d)"
  curl -fsSL "$BASE/SHASUMS256.txt" -o "$TMP/SHASUMS256.txt"
  FILE="$(grep -o "node-v22[^ ]*-linux-$ARCH.tar.xz" "$TMP/SHASUMS256.txt" | head -1)"
  [ -n "$FILE" ] || die "couldn't find a Node 22 download for linux-$ARCH"
  curl -fsSL "$BASE/$FILE" -o "$TMP/$FILE"
  (cd "$TMP" && grep " $FILE\$" SHASUMS256.txt | sha256sum -c -) || die "Node download failed its checksum"
  rm -rf "$NODE_DIR" && mkdir -p "$NODE_DIR"
  tar -xJf "$TMP/$FILE" -C "$NODE_DIR" --strip-components=1
  rm -rf "$TMP"
  NODE="$NODE_DIR/bin/node"
fi
echo "Using Node $("$NODE" -v) at $NODE"

# --- User and code -----------------------------------------------------------------
say "Setting up the hopi user and $APP"
id hopi >/dev/null 2>&1 || useradd --system --home-dir /var/lib/hopi-farms --shell /usr/sbin/nologin hopi
if [ -d "$APP/.git" ]; then
  git -C "$APP" pull --ff-only
else
  git clone --depth 1 "$REPO" "$APP"
fi
chown -R root:root "$APP"
chmod -R a+rX "$APP"

say "Running the game's tests"
(cd "$APP" && "$NODE" --disable-warning=ExperimentalWarning --test tests/*.test.js >/tmp/hopi-tests.log 2>&1) \
  || die "tests failed; see /tmp/hopi-tests.log"
grep -E '^ℹ (pass|fail)' /tmp/hopi-tests.log || true

# --- systemd -------------------------------------------------------------------------
if ss -ltnH "sport = :$PORT" | grep -q . && ! systemctl is-active --quiet hopi-farms; then
  die "port $PORT is already used by something else on this server"
fi

say "Installing the hopi-farms service and daily backups"
for unit in hopi-farms.service hopi-farms-backup.service hopi-farms-backup.timer; do
  sed "s#@NODE@#$NODE#g" "$APP/deploy/$unit" > "/etc/systemd/system/$unit"
done
systemctl daemon-reload
systemctl enable --now hopi-farms.service
systemctl restart hopi-farms.service
systemctl enable --now hopi-farms-backup.timer

for _ in $(seq 1 20); do
  curl -fsS "http://127.0.0.1:$PORT/api/leaderboard" >/dev/null 2>&1 && break
  sleep 0.5
done
curl -fsS "http://127.0.0.1:$PORT/api/leaderboard" >/dev/null \
  || die "the game server didn't start; see: journalctl -u hopi-farms -n 50"
echo "Game server is running on 127.0.0.1:$PORT"

# --- Cloudflare Tunnel ---------------------------------------------------------------
say "Adding hopifarms.fun to the Cloudflare Tunnel"
[ -f "$TUNNEL_CONFIG" ] || die "no tunnel config at $TUNNEL_CONFIG"
command -v cloudflared >/dev/null || die "cloudflared isn't installed"
TUNNEL_UNIT="$(systemctl list-units --type=service --all --no-legend --plain | awk '{print $1}' \
  | while read -r u; do systemctl cat "$u" 2>/dev/null | grep -q "cloudflared.*$TUNNEL_CONFIG" && echo "$u"; done | head -1)"
[ -n "$TUNNEL_UNIT" ] || die "couldn't find the systemd service that runs the tunnel"
TUNNEL_ID="$(awk '/^tunnel:/{print $2}' "$TUNNEL_CONFIG")"

if grep -q "hostname: hopifarms.fun" "$TUNNEL_CONFIG"; then
  echo "hopifarms.fun is already in $TUNNEL_CONFIG"
else
  BACKUP="$TUNNEL_CONFIG.bak-$(date +%Y%m%d-%H%M%S)"
  cp -p "$TUNNEL_CONFIG" "$BACKUP"
  echo "Backed up the tunnel config to $BACKUP"
  RULES=""
  for h in "${HOSTS[@]}"; do
    RULES+="  - hostname: $h\n    service: http://localhost:$PORT\n"
  done
  # Insert our rules right after 'ingress:', so they come before the catch-all rule.
  awk -v rules="$RULES" '{print} /^ingress:[[:space:]]*$/ && !done {printf "%s", rules; done=1}' \
    "$BACKUP" > "$TUNNEL_CONFIG.new"
  grep -q "hostname: hopifarms.fun" "$TUNNEL_CONFIG.new" || { rm -f "$TUNNEL_CONFIG.new"; die "couldn't find 'ingress:' in $TUNNEL_CONFIG"; }
  if ! cloudflared tunnel --config "$TUNNEL_CONFIG.new" ingress validate; then
    rm -f "$TUNNEL_CONFIG.new"
    die "the new tunnel config didn't validate; nothing was changed"
  fi
  mv "$TUNNEL_CONFIG.new" "$TUNNEL_CONFIG"
  echo "Restarting $TUNNEL_UNIT (other sites on the tunnel blink for a second or two)"
  systemctl restart "$TUNNEL_UNIT"
  sleep 3
  if ! systemctl is-active --quiet "$TUNNEL_UNIT"; then
    cp -p "$BACKUP" "$TUNNEL_CONFIG"
    systemctl restart "$TUNNEL_UNIT"
    die "the tunnel didn't come back with the new config, so the old one was restored"
  fi
fi
cloudflared tunnel --config "$TUNNEL_CONFIG" ingress rule https://hopifarms.fun | grep -q ":$PORT" \
  || die "the tunnel isn't routing hopifarms.fun to port $PORT"
echo "Tunnel routes hopifarms.fun → 127.0.0.1:$PORT"

say "Done"
cat <<MSG
Last step, in Cloudflare (hopifarms.fun → DNS → Records):
  delete any A, AAAA or CNAME records named hopifarms.fun or www, then add:
    CNAME  @    $TUNNEL_ID.cfargotunnel.com   Proxied
    CNAME  www  $TUNNEL_ID.cfargotunnel.com   Proxied

Check it once Cloudflare says the domain is Active:
  curl -sI https://hopifarms.fun | head -1     # expect HTTP/2 200
  systemctl status hopi-farms                   # game server
  journalctl -u hopi-farms -f                   # live logs
MSG
