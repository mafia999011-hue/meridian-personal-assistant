#!/bin/sh
set -eu

allowed_email=${1:-}
case "$allowed_email" in
  *@*.*) ;;
  *) printf '%s\n' 'Usage: scripts/start-cloudflare-quick-tunnel.sh your-email@example.com' >&2; exit 2 ;;
esac

command -v cloudflared >/dev/null 2>&1 || { printf '%s\n' 'cloudflared is required. Install it before starting the tunnel.' >&2; exit 127; }
app_port=${PORT:-4173}
case "$app_port" in
  *[!0-9]*|'') printf '%s\n' 'PORT must be a number.' >&2; exit 2 ;;
esac

exec cloudflared tunnel --url "http://127.0.0.1:${app_port}" --allowed-mail "$allowed_email"
