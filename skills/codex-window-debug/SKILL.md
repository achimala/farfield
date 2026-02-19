# codex-window-debug

Use this skill when you need to verify that messages and responses appear in both:
- Codex.app UI
- Farfield web UI and server stream data

## What this skill gives you

- A non-interactive window screenshot tool for Codex.app.
- A repeatable workflow to confirm cross-surface sync.

Tool path:
- `skills/codex-window-debug/tools/codex-window-screenshot.mjs`

## Quick commands

Take a screenshot of the visible Codex window:
```bash
node skills/codex-window-debug/tools/codex-window-screenshot.mjs ~/Desktop/codex-app.png
```

Take a screenshot and prefer a window title match:
```bash
node skills/codex-window-debug/tools/codex-window-screenshot.mjs ~/Desktop/codex-app.png --title "part of title"
```

## Debug workflow used for message sync issues

1. Check server health
```bash
curl -sS 'http://localhost:4311/api/health' | jq '.state.ipcConnected, .state.ipcInitialized, .state.lastError'
```

2. Send a test message to a target thread
```bash
TEST_MSG="ff-sync-test $(date +%s)"
curl -sS -X POST 'http://localhost:4311/api/threads/<THREAD_ID>/messages' \
  -H 'Content-Type: application/json' \
  --data "{\"text\":\"$TEST_MSG\"}" | jq '.'
```

3. Confirm stream events advanced
```bash
curl -sS 'http://localhost:4311/api/threads/<THREAD_ID>/stream-events?limit=200' | jq '.ok, (.events|length)'
```

4. Confirm thread data contains user and agent messages
```bash
curl -sS 'http://localhost:4311/api/threads/<THREAD_ID>?includeTurns=true' | \
  jq -r '.thread.turns[-2:][] | "TURN " + (.turnId // .id // "?") + " status=" + .status, (.items[] | "  " + .type + ":" + ((.text // .content[0].text // "")|tostring))'
```

5. Capture Codex.app and visually confirm same messages
```bash
node skills/codex-window-debug/tools/codex-window-screenshot.mjs ~/Desktop/codex-after.png
```

## Notes

- The screenshot tool uses `swift` + `screencapture -x -l <windowId>`.
- It does not use interactive selection.
- It captures the currently visible Codex window. If you need a specific thread, bring that thread to the front first.
