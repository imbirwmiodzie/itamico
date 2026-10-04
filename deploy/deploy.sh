#!/usr/bin/env bash
# Push this checkout to your server over SSH and install/update it there.
#
# Run on your own computer, from the repository:
#   ./deploy/deploy.sh                    # uses deploy/deploy.env
#   ./deploy/deploy.sh user@host          # or name the server directly
#   ./deploy/deploy.sh -i ~/key.pem ubuntu@1.2.3.4   # with a key file, like ssh -i
#   ./deploy/deploy.sh -p 2222 user@host  # SSH port, like ssh -p
#   ./deploy/deploy.sh --upload-only      # copy files, don't run the installer
#
# Settings come from deploy/deploy.env (copy deploy/deploy.env.example; it is
# git-ignored) or the environment:
#   SSH_TARGET   user@host                       (required)
#   SSH_PORT     SSH port                         (default 22)
#   SSH_KEY      private key file                 (default: your SSH agent / config)
#   REMOTE_DIR   where the code goes on the server: absolute, or relative to the
#                login's home (default: itamico)
#   DOMAIN, HTTPS_PORT, PLAIN_HTTP, BEHIND_CLOUDFLARE, TUTOR_TZ, DATABASE_URL, NO_CADDY
#                passed through to deploy/install.sh on the server
#
# What it sends: every file git tracks or would track (respects .gitignore),
# including uncommitted edits. Not node_modules, dist, .git or .env files.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

die() { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }
log() { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }

UPLOAD_ONLY=
SSH_TARGET_ARG='' SSH_KEY_ARG='' SSH_PORT_ARG=''
while (( $# > 0 )); do
  case $1 in
    --upload-only) UPLOAD_ONLY=1 ;;
    -i|--key) [[ $# -ge 2 ]] || die "$1 needs a key file"; SSH_KEY_ARG=$2; shift ;;
    -p|--port) [[ $# -ge 2 ]] || die "$1 needs a port"; SSH_PORT_ARG=$2; shift ;;
    -h|--help) sed -n '2,23p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*) die "unknown option $1" ;;
    *) SSH_TARGET_ARG=$1 ;;
  esac
  shift
done

# shellcheck disable=SC1091
[[ -f deploy/deploy.env ]] && { set -a; . deploy/deploy.env; set +a; }
# Command-line flags win over deploy.env.
SSH_TARGET=${SSH_TARGET_ARG:-${SSH_TARGET:-}}
SSH_KEY=${SSH_KEY_ARG:-${SSH_KEY:-}}
SSH_PORT=${SSH_PORT_ARG:-${SSH_PORT:-22}}
[[ -n $SSH_TARGET ]] || die "no server: pass user@host or set SSH_TARGET in deploy/deploy.env"
[[ ${DOMAIN:-} != *YOUR-DOMAIN* ]] || die "set DOMAIN in deploy/deploy.env to your real hostname"
if [[ -n $SSH_KEY ]]; then
  # A quoted "~/..." from deploy.env arrives unexpanded.
  [[ $SSH_KEY == \~/* ]] && SSH_KEY="$HOME/${SSH_KEY#\~/}"
  [[ -f $SSH_KEY ]] || die "key file not found: $SSH_KEY"
  # ssh refuses a private key others can read (common for files in Downloads).
  if [[ -n $(find "$SSH_KEY" -perm -004 -o -perm -040 2>/dev/null) ]]; then
    echo "Tightening permissions on $SSH_KEY (ssh rejects keys readable by others)"
    chmod 600 "$SSH_KEY"
  fi
fi
REMOTE_DIR=${REMOTE_DIR:-itamico}
REMOTE_DIR=${REMOTE_DIR#\~/}  # relative paths are relative to the login's home anyway

command -v git >/dev/null || die "git is required"
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || die "run from a git checkout"

# One shared connection, so a password (if you use one) is asked for only once.
CTL="${TMPDIR:-/tmp}/itamico-ssh-$$"
SSH=(ssh -p "$SSH_PORT" -o ServerAliveInterval=15 -o ControlMaster=auto -o "ControlPath=$CTL" -o ControlPersist=120)
[[ -n $SSH_KEY ]] && SSH+=(-i "$SSH_KEY" -o IdentitiesOnly=yes)
LIST=$(mktemp)
cleanup() { rm -f "$LIST"; "${SSH[@]}" -O exit "$SSH_TARGET" 2>/dev/null || true; }
trap cleanup EXIT

log "Checking SSH access to $SSH_TARGET (port $SSH_PORT)"
"${SSH[@]}" -o ConnectTimeout=10 "$SSH_TARGET" true || die "cannot log in to $SSH_TARGET"

log "Uploading to $SSH_TARGET:$REMOTE_DIR"
# Tracked + untracked-but-not-ignored files that still exist; never .env files.
# (Plain loops rather than mapfile: macOS still ships bash 3.2.)
git ls-files -z --cached --others --exclude-standard \
  | while IFS= read -r -d '' f; do
      case ${f##*/} in .env | deploy.env) continue ;; esac
      [[ -f $f ]] && printf '%s\0' "$f"
    done >"$LIST"
COUNT=$(tr -cd '\0' <"$LIST" | wc -c | tr -d ' ')
(( COUNT > 0 )) || die "no files to send"
echo "$COUNT files, commit $(git rev-parse --short HEAD)$(git diff --quiet HEAD -- 2>/dev/null || echo ' + local changes')"

# Unpack into a fresh directory, then swap, so a removed file doesn't linger
# and an interrupted upload never leaves a half-written tree.
# COPYFILE_DISABLE stops macOS tar adding ._ resource-fork files.
COPYFILE_DISABLE=1 tar -czf - --null -T "$LIST" \
  | "${SSH[@]}" "$SSH_TARGET" "set -e
      dir=$(printf %q "$REMOTE_DIR")
      rm -rf \"\$dir.new\" && mkdir -p \"\$dir.new\"
      tar -xzf - -C \"\$dir.new\" --warning=no-unknown-keyword
      rm -rf \"\$dir.old\"
      [ -e \"\$dir\" ] && mv \"\$dir\" \"\$dir.old\"
      mv \"\$dir.new\" \"\$dir\"
      rm -rf \"\$dir.old\"
      chmod +x \"\$dir/deploy/install.sh\""

if [[ -n $UPLOAD_ONLY ]]; then
  log "Uploaded. Skipping the installer (--upload-only)"
  exit 0
fi

# Pass installer settings through, quoted for the remote shell.
ENV_ARGS=""
for v in DOMAIN HTTPS_PORT PLAIN_HTTP BEHIND_CLOUDFLARE TUTOR_TZ DATABASE_URL NO_CADDY MCP_TOKEN; do
  [[ -n ${!v:-} ]] && ENV_ARGS+=" $v=$(printf %q "${!v}")"
done

log "Running the installer on $SSH_TARGET"
# -t gives sudo a terminal to ask for the password if it needs one.
"${SSH[@]}" -t "$SSH_TARGET" "set -e
  cd $(printf %q "$REMOTE_DIR")
  if [ \"\$(id -u)\" = 0 ]; then env$ENV_ARGS ./deploy/install.sh
  else sudo env$ENV_ARGS ./deploy/install.sh; fi"
