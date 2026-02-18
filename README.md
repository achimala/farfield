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

## Install & Run

```bash
pnpm install
pnpm dev
```

Opens at `http://localhost:4312`. Defaults to Codex.

**Agent options:**

```bash
pnpm dev -- --agents=opencode             # OpenCode only
pnpm dev -- --agents=codex,opencode       # both
pnpm dev -- --agents=all                  # expands to codex,opencode
pnpm dev:remote                           # network-accessible (codex)
pnpm dev:remote -- --agents=opencode      # network-accessible (opencode)
```

> **Warning:** `dev:remote` exposes Farfield with no authentication. Only use on trusted networks.

## Requirements

- Node.js 20+
- pnpm 10+
- Codex or OpenCode installed locally

## License

MIT
