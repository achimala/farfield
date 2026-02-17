# Codex IPC Monitor

Local web app that:

- shows live messages from the running Codex desktop IPC socket
- sends raw IPC requests
- sends raw IPC broadcasts

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

- This tool talks to the local desktop socket:
  - macOS: `$(python3 -c 'import os,tempfile; print(os.path.join(tempfile.gettempdir(),"codex-ipc"))')`
- Most methods are private internal methods and may change.
- If you send a method with no handler, you will usually get `no-client-found`.
- The UI lets you set a custom message `version` if you need to match an internal method version.
