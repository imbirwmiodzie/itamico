#!/usr/bin/env bash
# Install or update the Italian tutor MCP server on a Debian/Ubuntu machine.
#
# Run from a checkout of this repository, as root:
#   sudo DOMAIN=tutor.example.com ./deploy/install.sh
#
# What it sets up:
#   - Node.js 22 (NodeSource) and a `tutor` system user
#   - the app in /opt/italian-tutor, built, run by systemd on 127.0.0.1:8080
#   - Postgres on this machine, unless you pass DATABASE_URL (Neon/Supabase)
#   - Caddy in front of it with an automatic Let's Encrypt certificate
#
# Settings (environment variables, all optional):
#   DOMAIN        public hostname pointing at this machine. Default: <public-ip>.sslip.io
#   HTTPS_PORT    public HTTPS port Caddy listens on. Default: 443. With another port
#                 (e.g. 28443), port 80 must still reach this machine: Let's Encrypt
#                 verifies the domain over port 80 when issuing and renewing (~every 60 days).
#   DATABASE_URL  external Postgres. Default: local Postgres, created here
#   TUTOR_TZ      time zone for "due today". Default: Europe/Warsaw
#   MCP_TOKEN     secret token. Default: generated on first install, kept on updates
#   NO_CADDY=1    skip Caddy (you already have a reverse proxy / tunnel to 127.0.0.1:8080)
#
# Safe to re-run: it updates the code, keeps the token and the database, restarts.

set -euo pipefail

APP_DIR=/opt/italian-tutor
ENV_FILE=/etc/italian-tutor.env
SERVICE=italian-tutor
APP_USER=tutor
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

log() { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }
die() { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "run as root (sudo $0)"
[[ -f "$SRC_DIR/package.json" && -f "$SRC_DIR/sql/schema.sql" ]] || die "run this from a checkout of the repository"
command -v apt-get >/dev/null || die "this script supports Debian/Ubuntu (apt) only"
command -v systemctl >/dev/null || die "systemd is required"

# Keep values from a previous install unless overridden now.
if [[ -f $ENV_FILE ]]; then
  prev() { grep -E "^$1=" "$ENV_FILE" | head -1 | cut -d= -f2- || true; }
  MCP_TOKEN=${MCP_TOKEN:-$(prev MCP_TOKEN)}
  DATABASE_URL=${DATABASE_URL:-$(prev DATABASE_URL)}
  TUTOR_TZ=${TUTOR_TZ:-$(prev TUTOR_TZ)}
  DOMAIN=${DOMAIN:-$(prev DOMAIN)}
  HTTPS_PORT=${HTTPS_PORT:-$(prev HTTPS_PORT)}
fi
TUTOR_TZ=${TUTOR_TZ:-Europe/Warsaw}
HTTPS_PORT=${HTTPS_PORT:-443}
[[ $HTTPS_PORT =~ ^[0-9]+$ && $HTTPS_PORT -ge 1 && $HTTPS_PORT -le 65535 ]] || die "HTTPS_PORT must be a port number"
[[ $HTTPS_PORT != 80 ]] || die "HTTPS_PORT cannot be 80: Caddy needs port 80 for the certificate check"
PORT=8080  # internal app port, loopback only

log "Installing base packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl ca-certificates gnupg openssl rsync >/dev/null

if ! command -v node >/dev/null || [[ $(node -p 'process.versions.node.split(".")[0]') -lt 20 ]]; then
  log "Installing Node.js 22"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
echo "node $(node --version)"

id -u "$APP_USER" >/dev/null 2>&1 || useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin "$APP_USER"

if [[ -z ${DATABASE_URL:-} ]]; then
  log "Setting up local Postgres"
  cd /  # psql as postgres cannot read the checkout directory
  apt-get install -y -qq postgresql >/dev/null
  systemctl enable --now postgresql >/dev/null
  DB_PASS=$(openssl rand -hex 16)
  runuser -u postgres -- psql -qtAc "select 1 from pg_roles where rolname = 'tutor'" | grep -q 1 \
    || runuser -u postgres -- psql -q -c "create role tutor login"
  runuser -u postgres -- psql -q -c "alter role tutor password '$DB_PASS'"
  runuser -u postgres -- psql -qtAc "select 1 from pg_database where datname = 'tutor'" | grep -q 1 \
    || runuser -u postgres -- psql -q -c "create database tutor owner tutor"
  DATABASE_URL="postgres://tutor:$DB_PASS@127.0.0.1:5432/tutor"
fi

if [[ -z ${DOMAIN:-} && -z ${NO_CADDY:-} ]]; then
  IP=$(curl -4 -fsS https://api.ipify.org || true)
  [[ -n $IP ]] || die "could not detect the public IP; pass DOMAIN=..."
  DOMAIN="${IP//./-}.sslip.io"
  echo "No DOMAIN given; using $DOMAIN (resolves to $IP)"
fi

MCP_TOKEN=${MCP_TOKEN:-$(openssl rand -hex 24)}

log "Writing $ENV_FILE"
umask 077
cat >"$ENV_FILE" <<EOF
DATABASE_URL=$DATABASE_URL
MCP_TOKEN=$MCP_TOKEN
TUTOR_TZ=$TUTOR_TZ
HOST=127.0.0.1
PORT=$PORT
DOMAIN=${DOMAIN:-}
HTTPS_PORT=$HTTPS_PORT
EOF
chmod 600 "$ENV_FILE"
umask 022

log "Building the app in $APP_DIR"
mkdir -p "$APP_DIR"
rsync -a --delete --exclude node_modules --exclude dist --exclude .git --exclude .env --exclude .npm "$SRC_DIR"/ "$APP_DIR"/
chown -R "$APP_USER:$APP_USER" "$APP_DIR"
runuser -u "$APP_USER" -- env HOME="$APP_DIR" bash -c "cd '$APP_DIR' && npm ci --no-audit --no-fund --loglevel=error && npm run build --silent && npm prune --omit=dev --loglevel=error"

log "Installing systemd service"
cat >/etc/systemd/system/$SERVICE.service <<EOF
[Unit]
Description=Italian tutor MCP server
After=network-online.target postgresql.service
Wants=network-online.target

[Service]
User=$APP_USER
WorkingDirectory=$APP_DIR
EnvironmentFile=$ENV_FILE
Environment=NODE_ENV=production
ExecStart=/usr/bin/env node dist/index.js
Restart=always
RestartSec=2
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=$APP_DIR

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable "$SERVICE" >/dev/null
systemctl restart "$SERVICE"

for _ in $(seq 1 20); do
  curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 && break
  sleep 1
done
curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null || {
  journalctl -u "$SERVICE" -n 30 --no-pager
  die "the service did not come up; see the log above"
}
echo "service is healthy on 127.0.0.1:$PORT"

if [[ -z ${NO_CADDY:-} ]]; then
  if ! command -v caddy >/dev/null; then
    log "Installing Caddy"
    curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --batch --yes --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt >/etc/apt/sources.list.d/caddy-stable.list
    apt-get update -qq
    apt-get install -y -qq caddy >/dev/null
  fi
  if [[ $HTTPS_PORT == 443 ]]; then PUBLIC="$DOMAIN"; else PUBLIC="$DOMAIN:$HTTPS_PORT"; fi
  log "Configuring Caddy for https://$PUBLIC"
  # No access log: the connector URL carries the token.
  cat >/etc/caddy/Caddyfile <<EOF
$PUBLIC {
	encode gzip
	reverse_proxy 127.0.0.1:$PORT
}
EOF
  if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then
    ufw allow 80/tcp >/dev/null
    ufw allow "$HTTPS_PORT/tcp" >/dev/null
  elif command -v iptables >/dev/null && iptables -S INPUT 2>/dev/null | grep -q -- "-j REJECT"; then
    # Oracle Cloud images ship iptables rules that reject everything but SSH.
    for p in 80 "$HTTPS_PORT"; do
      iptables -C INPUT -p tcp --dport "$p" -m state --state NEW -j ACCEPT 2>/dev/null \
        || iptables -I INPUT 1 -p tcp --dport "$p" -m state --state NEW -j ACCEPT
    done
    command -v netfilter-persistent >/dev/null && netfilter-persistent save >/dev/null 2>&1 || true
    echo "Opened ports 80 and $HTTPS_PORT in iptables"
  fi
  systemctl enable caddy >/dev/null
  systemctl reload-or-restart caddy

  printf 'Waiting for the HTTPS certificate'
  for _ in $(seq 1 30); do
    curl -fsS "https://$PUBLIC/health" >/dev/null 2>&1 && break
    printf '.'
    sleep 2
  done
  echo
  if curl -fsS "https://$PUBLIC/health" >/dev/null 2>&1; then
    echo "https://$PUBLIC/health is up"
  else
    echo "HTTPS is not answering yet. Check that $DOMAIN points at this machine and ports 80 and $HTTPS_PORT are open"
    echo "(cloud firewall / security group too), then: journalctl -u caddy -n 50"
    echo "On Oracle Cloud: add ingress rules for both ports to the subnet's Security List."
  fi
  URL="https://$PUBLIC"
else
  URL="https://<your-proxy-host>"
fi

log "Done"
cat <<EOF
Claude connector URL (treat it as a password):
  $URL/mcp/$MCP_TOKEN

Bearer-token endpoint (OpenAI Realtime, scripts):
  $URL/mcp    Authorization: Bearer $MCP_TOKEN

Logs:    journalctl -u $SERVICE -f
Update:  git pull && sudo ./deploy/install.sh
Secrets: $ENV_FILE
EOF
