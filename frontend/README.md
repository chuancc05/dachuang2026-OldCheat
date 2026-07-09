# OldCheat v0 Frontend

This directory is the new primary frontend for OldCheat.

## Run locally

```powershell
cd frontend
pnpm.cmd install
pnpm.cmd run dev
```

The dev server uses http://127.0.0.1:3000 by default.

## Realtime voice call mode

V3 voice mode uses a local WebSocket gateway to keep the DashScope API key out of the browser.
Start it in another terminal:

```powershell
cd frontend
pnpm.cmd run voice:gateway
```

Then keep both windows open and use:

```text
http://127.0.0.1:3000/
```

If the realtime gateway is unavailable, the voice button falls back to browser ASR/TTS and text training stays usable.

## Notes

- The legacy Gradio app is kept in the repository as backend/prototype reference.
- UI work should happen here first, using the v0/Next/Tailwind component structure.
