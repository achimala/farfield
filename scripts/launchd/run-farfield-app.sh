#!/bin/zsh
set -euo pipefail

: "${FARFIELD_DIR:?FARFIELD_DIR is required}"
: "${FARFIELD_NODE_BIN:?FARFIELD_NODE_BIN is required}"

ENV_FILE="${FARFIELD_ENV_FILE:-$HOME/.config/farfield/farfield.env}"
if [[ -f "$ENV_FILE" ]]; then
  set -a
  source "$ENV_FILE"
  set +a
fi

export PATH="${FARFIELD_NODE_BIN:h}:/usr/bin:/bin:/usr/sbin:/sbin"
cd "$FARFIELD_DIR"

exec "$FARFIELD_NODE_BIN" scripts/dev.mjs --remote
