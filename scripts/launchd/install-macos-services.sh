#!/bin/zsh
set -euo pipefail

: "${FARFIELD_DIR:?FARFIELD_DIR is required}"
: "${FARFIELD_NODE_BIN:?FARFIELD_NODE_BIN is required}"
: "${FARFIELD_CLOUDFLARED_BIN:?FARFIELD_CLOUDFLARED_BIN is required}"
: "${FARFIELD_TUNNEL_NAME:?FARFIELD_TUNNEL_NAME is required}"
: "${FARFIELD_CLOUDFLARED_CONFIG:?FARFIELD_CLOUDFLARED_CONFIG is required}"
: "${FARFIELD_CLOUDFLARED_CERT:?FARFIELD_CLOUDFLARED_CERT is required}"

HOME_DIR="${HOME}"
LOG_DIR="$HOME_DIR/Library/Logs/farfield"
BIN_DIR="$HOME_DIR/bin"
LAUNCH_AGENT_DIR="$HOME_DIR/Library/LaunchAgents"

mkdir -p "$LOG_DIR" "$BIN_DIR" "$LAUNCH_AGENT_DIR"

install -m 755 scripts/launchd/run-farfield-app.sh "$BIN_DIR/run-farfield-app.sh"
install -m 755 scripts/launchd/run-farfield-tunnel.sh "$BIN_DIR/run-farfield-tunnel.sh"

perl -0pe "s|__HOME__|$HOME_DIR|g; s|__FARFIELD_DIR__|$FARFIELD_DIR|g" scripts/launchd/com.farfield.app.plist > "$LAUNCH_AGENT_DIR/com.farfield.app.plist"
perl -0pe "s|__HOME__|$HOME_DIR|g" scripts/launchd/com.farfield.awake.plist > "$LAUNCH_AGENT_DIR/com.farfield.awake.plist"
perl -0pe "s|__HOME__|$HOME_DIR|g" scripts/launchd/com.farfield.tunnel.plist > /tmp/com.farfield.tunnel.plist

plutil -lint "$LAUNCH_AGENT_DIR/com.farfield.app.plist"
plutil -lint "$LAUNCH_AGENT_DIR/com.farfield.awake.plist"
plutil -lint /tmp/com.farfield.tunnel.plist

launchctl bootout "gui/$(id -u)" "$LAUNCH_AGENT_DIR/com.farfield.app.plist" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$LAUNCH_AGENT_DIR/com.farfield.app.plist"
launchctl enable "gui/$(id -u)/com.farfield.app"
launchctl kickstart -k "gui/$(id -u)/com.farfield.app"

launchctl bootout "gui/$(id -u)" "$LAUNCH_AGENT_DIR/com.farfield.awake.plist" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$LAUNCH_AGENT_DIR/com.farfield.awake.plist"
launchctl enable "gui/$(id -u)/com.farfield.awake"
launchctl kickstart -k "gui/$(id -u)/com.farfield.awake"

sudo install -o root -g wheel -m 644 /tmp/com.farfield.tunnel.plist /Library/LaunchDaemons/com.farfield.tunnel.plist
sudo launchctl bootout system /Library/LaunchDaemons/com.farfield.tunnel.plist 2>/dev/null || true
sudo launchctl bootstrap system /Library/LaunchDaemons/com.farfield.tunnel.plist
sudo launchctl enable system/com.farfield.tunnel
sudo launchctl kickstart -k system/com.farfield.tunnel

echo "Installed services: com.farfield.app, com.farfield.awake, com.farfield.tunnel"
echo "Run scripts/launchd/farfield-healthcheck.sh to verify remote health."
