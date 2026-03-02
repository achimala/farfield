# Farfield

Remote control for AI coding agents — read conversations, send messages, switch models, and monitor agent activity from a clean web UI.

Supports [Codex](https://openai.com/codex) and [OpenCode](https://opencode.ai).

Built by [@anshuchimala](https://x.com/anshuchimala).

This is an independent project and is not affiliated with, endorsed by, or sponsored by OpenAI or the OpenCode team.

[![Buy Me A Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-FFDD00?style=for-the-badge&logo=buymeacoffee&logoColor=000000)](https://buymeacoffee.com/achimalap)

<img src="./screenshot.png" alt="Farfield screenshot" width="500" />

## Features

- Thread browser grouped by project
- Chat view with model/reasoning controls
- Plan mode toggle
- Live agent monitoring and interrupts
- Debug tab with full IPC history

## Quick start (recommended)

Start the Farfield server:

```bash
npx -y @farfield/server@latest
```

or:

```bash
bunx @farfield/server@latest
```

This runs the backend on `127.0.0.1:4311` by default.

You can pass server flags too to customize the agents (default is only Codex):

```bash
npx -y @farfield/server@latest -- --agents=opencode
npx -y @farfield/server@latest -- --agents=codex,opencode
npx -y @farfield/server@latest -- --agents=all
```

You can access the web app at [farfield.app](https://farfield.app). Tap the bottom left status dot to pull up settings.

You will need to make port 4311 remotely accessible via HTTPS and give the public URL to it to the Farfield frontend. None of this routes through an external server. The app runs inside entirely in your browser and tunnels directly to the Farfield server you started above, and all of it is open-source for you to audit yourself. However, if you are ultra paranoid, you can run and host the Farfield frontend too; read on!

The securest way to open the port for remote access is by putting all devices involved in a private VPN. Tailscale is a free option that works.

Doing this with Tailscale is as simple as installing Tailscale on your phone, computer, etc., and running this command on the device hosting the Farfield server:
```bash
tailscale serve --https=443 http://127.0.0.1:4311
```

We are working on easier options. Stay tuned!

## Running from source

Clone the repo and do this:

```bash
bun install
bun run server
```

`bun run server` runs only the backend on `0.0.0.0:4311`.

If you need to pick agent providers:

```bash
bun run server -- --agents=opencode
bun run server -- --agents=codex,opencode
bun run server -- --agents=all
```

> **Warning:** This exposes the Farfield server on your network. Only use on trusted networks. See below for how to configure Tailscale as a VPN for secure remote access.

## Local development and self-hosted frontend

Use this if you are working on Farfield itself, or if you want to run both frontend and backend locally.

```bash
bun install
bun run dev
```

Opens local frontend at `http://localhost:4312`. By default `dev` does not expose the port, it's only accessible on your device.

More local dev options:

```bash
bun run dev -- --agents=opencode             # OpenCode only
bun run dev -- --agents=codex,opencode       # both
bun run dev -- --agents=all                  # expands to codex,opencode
bun run dev:remote                           # exposes frontend + backend on your network
bun run dev:remote -- --agents=opencode      # remote mode with OpenCode only
```

> **Warning:** `dev:remote` exposes Farfield with no authentication. Only use on trusted networks.

## Production Mode (No Extra Proxy)

Build once and run in production mode with two commands:

```bash
bun run build
bun run start
```

Open `http://127.0.0.1:4312`.

By default, this is local-only:
- backend on `127.0.0.1:4311`
- frontend preview on `127.0.0.1:4312`

If you need a custom backend origin for API proxying:

```bash
FARFIELD_API_ORIGIN=http://127.0.0.1:4311 bun run start
```

## Requirements

- Node.js 20+
- Bun 1.2+ (needed for source checkout workflow)
- Codex or OpenCode installed locally

## More details on Tailscale setup

This is the detailed setup for the recommended model:

- Hosted frontend (`https://farfield.app`)
- Local Farfield server running on your machine
- Secure VPN path using Tailscale

You still need to run the server locally so it can talk to your coding agent.

### 1) Start the Farfield server on your machine

```bash
HOST=0.0.0.0 PORT=4311 bun run --filter @farfield/server dev
```

Quick local check:

```bash
curl http://127.0.0.1:4311/api/health
```

### 2) Put Tailscale HTTPS in front of port 4311

On the same machine:

```bash
tailscale serve --https=443 http://127.0.0.1:4311
tailscale serve status
```

This gives you a URL like:

```text
https://<machine>.<tailnet>.ts.net
```

Check it from a device on your tailnet:

```bash
curl https://<machine>.<tailnet>.ts.net/api/health
```

### 3) Pair farfield.app to your server

1. Visit farfield.app on your other device
2. Click the status pill in the lower-left corner (green/red dot + commit hash) to open **Settings**.
3. In **Server**, enter your Tailscale HTTPS URL, for example:

```text
https://<machine>.<tailnet>.ts.net
(note: no port)
```

4. Click **Save**.

Farfield stores this in browser storage and uses it for API calls and live event stream.

### Notes

- Do not use raw tailnet IPs with `https://` (for example `https://100.x.x.x:4311`) in the browser; this won't work.
- If you use `tailscale serve --https=443`, do not include `:4311` in the URL you enter in Settings.
- **Use automatic** in Settings clears the saved server URL and returns to built-in default behavior.

## License

MIT