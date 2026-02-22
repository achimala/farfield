#!/bin/zsh
set -euo pipefail

: "${FARFIELD_HOSTNAME:?FARFIELD_HOSTNAME is required}"
: "${FARFIELD_TUNNEL_NAME:?FARFIELD_TUNNEL_NAME is required}"

cloudflared tunnel info "$FARFIELD_TUNNEL_NAME"
cloudflared access curl "https://$FARFIELD_HOSTNAME/api/health"
