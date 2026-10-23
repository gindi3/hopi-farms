#!/usr/bin/env bash
# One-time setup of Hopi Farms on an Ubuntu/Debian droplet. Safe to re-run.
#
#   curl -fsSL https://raw.githubusercontent.com/gindi3/hopi-farms/main/deploy/setup.sh -o setup.sh
#   sudo bash setup.sh
#
# What it does (and nothing else on the server):
#   - creates a 'hopi' system user that runs the game
#   - uses Node 22.13+ if installed, otherwise installs a private copy in /opt/hopi-node
#     (so other apps on the droplet keep their own Node)
#   - clones the game to /opt/hopi-farms
#   - installs and starts the hopi-farms systemd service on 127.0.0.1:5180
#   - installs a daily database backup timer
#   - adds an nginx site for hopifarms.fun (other nginx sites are left alone)
set -euo pipefail

REPO=https://github.com/gindi3/hopi-farms.git
APP=/opt/hopi-farms
NODE_DIR=/opt/hopi-node
CERT_DIR=/etc/ssl/hopifarms

say() { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31mStopped: %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "run this with sudo (or as root)."
command -v apt-get >/dev/null || die "this script expects Ubuntu or Debian."

# --- Packages ------------------------------------------------------------------
say "Installing git, curl and nginx if missing"
NEED=()
command -v git >/dev/null || NEED+=(git)
command -v curl >/dev/null || NEED+=(curl)
command -v nginx >/dev/null || NEED+=(nginx)
command -v xz >/dev/null || NEED+=(xz-utils)
if [ ${#NEED[@]} -gt 0 ]; then
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
say "Installing the hopi-farms service and daily backups"
for unit in hopi-farms.service hopi-farms-backup.service hopi-farms-backup.timer; do
  sed "s#@NODE@#$NODE#g" "$APP/deploy/$unit" > "/etc/systemd/system/$unit"
done
systemctl daemon-reload
systemctl enable --now hopi-farms.service
systemctl restart hopi-farms.service
systemctl enable --now hopi-farms-backup.timer

for i in $(seq 1 20); do
  curl -fsS http://127.0.0.1:5180/api/leaderboard >/dev/null 2>&1 && break
  sleep 0.5
done
curl -fsS http://127.0.0.1:5180/api/leaderboard >/dev/null \
  || die "the game server didn't start; see: journalctl -u hopi-farms -n 50"
echo "Game server is running on 127.0.0.1:5180"

# --- nginx -----------------------------------------------------------------------------
say "Configuring nginx for hopifarms.fun"
mkdir -p /etc/nginx/snippets
{
  echo "# Cloudflare edge IPs, from https://www.cloudflare.com/ips/ (refreshed by setup.sh)."
  for ip in $(curl -fsSL https://www.cloudflare.com/ips-v4) $(curl -fsSL https://www.cloudflare.com/ips-v6); do
    echo "set_real_ip_from $ip;"
  done
  echo "real_ip_header CF-Connecting-IP;"
} > /etc/nginx/snippets/cloudflare-realip.conf

if [ ! -s "$CERT_DIR/origin.pem" ] || [ ! -s "$CERT_DIR/origin.key" ]; then
  mkdir -p "$CERT_DIR" && chmod 700 "$CERT_DIR"
  cat <<MSG

The game is running, but nginx needs the Cloudflare Origin Certificate before
hopifarms.fun can be served. In Cloudflare: SSL/TLS → Origin Server → Create
Certificate (keep the defaults), then on this server:

  sudo nano $CERT_DIR/origin.pem   # paste the Origin Certificate
  sudo nano $CERT_DIR/origin.key   # paste the Private Key
  sudo chmod 600 $CERT_DIR/origin.key

Then run this script again.
MSG
  exit 0
fi
chmod 600 "$CERT_DIR/origin.key"

cp "$APP/deploy/nginx-hopifarms.conf" /etc/nginx/sites-available/hopifarms.fun
ln -sf /etc/nginx/sites-available/hopifarms.fun /etc/nginx/sites-enabled/hopifarms.fun
nginx -t || die "nginx rejected the config (nothing was reloaded)"
systemctl reload nginx

if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then
  ufw allow 'Nginx Full' >/dev/null && echo "Opened ports 80 and 443 in ufw"
fi

say "Done"
cat <<MSG
Check it:
  curl -sI https://hopifarms.fun | head -1     # expect HTTP/2 200
  systemctl status hopi-farms                   # game server
  journalctl -u hopi-farms -f                   # live logs
  ls /var/lib/hopi-farms/backups                # daily backups (after the first run)

To ship updates later, run deploy/deploy.sh from your computer.
MSG
