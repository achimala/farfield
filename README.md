# Codex Companion

Local web app that gives you a higher-level view and control layer for Codex.
The front end is now a bundled React app with lighter polling-based updates.

- lists threads
- opens a thread and shows a readable timeline
- sends messages to the selected thread
- interrupts active turns
- keeps raw desktop IPC controls in an advanced section

## Run

```bash
cd /Users/anshu/Code/codextemp
npm start
```

Then open:

```text
http://127.0.0.1:4311
```

## Notes

- Uses two local channels:
1. `codex app-server` over stdio for thread and turn actions.
2. Desktop IPC socket for advanced raw mode.
- The default view uses polling to reduce browser CPU.
- The raw live feed is optional and off by default.
- Everything is local to your machine.
- Internal methods can change between app versions.
