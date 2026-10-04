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
#   PLAIN_HTTP=1  no certificate: serve plain http on HTTPS_PORT. No port 80 needed, but
#                 traffic (including the token) is unencrypted, and Claude connectors
#                 require https. For testing; re-run with PLAIN_HTTP=0 to switch to https.
#   BEHIND_CLOUDFLARE=1
#                 the DOMAIN is proxied by Cloudflare (orange cloud), which holds the
#                 public certificate. Caddy serves HTTPS_PORT with a self-signed
#                 certificate (Cloudflare SSL mode "Full" accepts it); no port 80.
#                 Add a Cloudflare Origin Rule sending DOMAIN to HTTPS_PORT, and the
#                 public URL is https://DOMAIN with no port.
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
  PLAIN_HTTP=${PLAIN_HTTP:-$(prev PLAIN_HTTP)}
  BEHIND_CLOUDFLARE=${BEHIND_CLOUDFLARE:-$(prev BEHIND_CLOUDFLARE)}
fi
[[ ${PLAIN_HTTP:-0} == 1 ]] && PLAIN_HTTP=1 || PLAIN_HTTP=0
[[ ${BEHIND_CLOUDFLARE:-0} == 1 ]] && BEHIND_CLOUDFLARE=1 || BEHIND_CLOUDFLARE=0
[[ $PLAIN_HTTP == 1 && $BEHIND_CLOUDFLARE == 1 ]] && die "choose one of PLAIN_HTTP=1 and BEHIND_CLOUDFLARE=1"
[[ $BEHIND_CLOUDFLARE == 0 || -n ${DOMAIN:-} ]] || die "BEHIND_CLOUDFLARE=1 needs DOMAIN (the hostname proxied by Cloudflare)"
TUTOR_TZ=${TUTOR_TZ:-Europe/Warsaw}
HTTPS_PORT=${HTTPS_PORT:-443}
[[ $HTTPS_PORT =~ ^[0-9]+$ && $HTTPS_PORT -ge 1 && $HTTPS_PORT -le 65535 ]] || die "HTTPS_PORT must be a port number"
[[ $HTTPS_PORT != 80 || $PLAIN_HTTP == 1 || $BEHIND_CLOUDFLARE == 1 ]] || die "HTTPS_PORT cannot be 80: Caddy needs port 80 for the certificate check"
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

if [[ -z ${DOMAIN:-} && -z ${NO_CADDY:-} && $PLAIN_HTTP == 0 && $BEHIND_CLOUDFLARE == 0 ]]; then
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
PLAIN_HTTP=$PLAIN_HTTP
BEHIND_CLOUDFLARE=$BEHIND_CLOUDFLARE
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
  if [[ $PLAIN_HTTP == 1 ]]; then
    HOST_NAME=${DOMAIN:-$(curl -4 -fsS https://api.ipify.org || echo '<server-ip>')}
    PUBLIC="$HOST_NAME:$HTTPS_PORT"
    SCHEME=http
    SITE="http://:$HTTPS_PORT"  # any host name or bare IP, no certificate
    PORTS=("$HTTPS_PORT")
    TLS_LINE=""
  elif [[ $BEHIND_CLOUDFLARE == 1 ]]; then
    PUBLIC=$DOMAIN  # Cloudflare listens on 443; an Origin Rule forwards to HTTPS_PORT
    SCHEME=https
    SITE="$DOMAIN:$HTTPS_PORT"
    PORTS=("$HTTPS_PORT")
    TLS_LINE="tls internal"  # self-signed; Cloudflare SSL mode "Full" accepts it
  else
    if [[ $HTTPS_PORT == 443 ]]; then PUBLIC="$DOMAIN"; else PUBLIC="$DOMAIN:$HTTPS_PORT"; fi
    SCHEME=https
    SITE=$PUBLIC
    PORTS=(80 "$HTTPS_PORT")  # 80: Let's Encrypt checks the domain there
    TLS_LINE=""
  fi
  log "Configuring Caddy for $SCHEME://$PUBLIC"
  # No access log: the connector URL carries the token.
  if [[ $BEHIND_CLOUDFLARE == 1 ]]; then
    # No redirect listener on :80, and don't try to add Caddy's local CA to the system trust.
    GLOBAL=$'{\n\tauto_https disable_redirects\n\tskip_install_trust\n}\n\n'
  else
    GLOBAL=""
  fi
  cat >/etc/caddy/Caddyfile <<EOF
$GLOBAL$SITE {
	$TLS_LINE
	encode gzip
	reverse_proxy 127.0.0.1:$PORT
}
EOF
  if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then
    for p in "${PORTS[@]}"; do ufw allow "$p/tcp" >/dev/null; done
  elif command -v iptables >/dev/null && iptables -S INPUT 2>/dev/null | grep -q -- "-j REJECT"; then
    # Oracle Cloud images ship iptables rules that reject everything but SSH.
    for p in "${PORTS[@]}"; do
      iptables -C INPUT -p tcp --dport "$p" -m state --state NEW -j ACCEPT 2>/dev/null \
        || iptables -I INPUT 1 -p tcp --dport "$p" -m state --state NEW -j ACCEPT
    done
    command -v netfilter-persistent >/dev/null && netfilter-persistent save >/dev/null 2>&1 || true
    echo "Opened port(s) ${PORTS[*]} in iptables"
  fi
  systemctl enable caddy >/dev/null
  systemctl reload-or-restart caddy

  CURL_OPTS=()
  if [[ $PLAIN_HTTP == 1 ]]; then
    CHECK="http://127.0.0.1:$HTTPS_PORT/health"
    printf 'Waiting for Caddy'
  elif [[ $BEHIND_CLOUDFLARE == 1 ]]; then
    # Check the origin directly: self-signed (-k), name resolved to this machine.
    CHECK="https://$DOMAIN:$HTTPS_PORT/health"
    CURL_OPTS=(-k --noproxy "*" --resolve "$DOMAIN:$HTTPS_PORT:127.0.0.1")
    printf 'Waiting for Caddy'
  else
    CHECK="https://$PUBLIC/health"
    printf 'Waiting for the HTTPS certificate'
  fi
  for _ in $(seq 1 30); do
    curl -fsS "${CURL_OPTS[@]}" "$CHECK" >/dev/null 2>&1 && break
    printf '.'
    sleep 2
  done
  echo
  if curl -fsS "${CURL_OPTS[@]}" "$CHECK" >/dev/null 2>&1; then
    echo "$CHECK is up"
  else
    echo "$CHECK is not answering yet. Check that port(s) ${PORTS[*]} are open on this machine"
    [[ $PLAIN_HTTP == 0 && $BEHIND_CLOUDFLARE == 0 ]] && echo "and that $DOMAIN points at it."
    echo "Cloud firewalls too (on Oracle Cloud: ingress rules in the subnet's Security List)."
    echo "Logs: journalctl -u caddy -n 50"
  fi
  URL="$SCHEME://$PUBLIC"
else
  URL="https://<your-proxy-host>"
fi

log "Done"
if [[ $PLAIN_HTTP == 1 && -z ${NO_CADDY:-} ]]; then
  cat <<EOF
Plain HTTP mode: no certificate, traffic is unencrypted. Claude connectors need
https, so use this URL for testing with curl/scripts until you switch:
re-run with PLAIN_HTTP=0 (and open port 80) to get a certificate.

EOF
fi
if [[ $BEHIND_CLOUDFLARE == 1 && -z ${NO_CADDY:-} ]]; then
  cat <<EOF
Cloudflare mode. The origin answers on port $HTTPS_PORT with a self-signed certificate.
In the Cloudflare dashboard for your domain, if not done yet:
  1. DNS: A record $DOMAIN -> this server's IP, Proxy status "Proxied" (orange cloud)
  2. SSL/TLS -> Overview: encryption mode "Full" (not "Full (strict)", not "Flexible")
  3. Rules -> Origin Rules: Hostname equals $DOMAIN -> Destination Port $HTTPS_PORT
Test from your computer: curl https://$DOMAIN/health

EOF
fi
cat <<EOF
Connector URL (treat it as a password):
  $URL/mcp/$MCP_TOKEN

Learning stats page (same secret, open it in a browser):
  $URL/stats/$MCP_TOKEN

Bearer-token endpoint (OpenAI Realtime, scripts):
  $URL/mcp    Authorization: Bearer $MCP_TOKEN

Logs:    journalctl -u $SERVICE -f
Update:  git pull && sudo ./deploy/install.sh
Secrets: $ENV_FILE
EOF
