# OldCheat Realtime Voice Gateway

This service proxies browser WebSocket audio to DashScope realtime ASR and TTS.
It does not run an AI model and needs no GPU.

## Production deployment

1. Point a DNS name such as `voice.example.com` to the public server IP.
2. Copy `.env.production.example` to `.env.production` on that server.
3. Set a newly rotated `DASHSCOPE_API_KEY` and the exact Netlify origin in `VOICE_ALLOWED_ORIGINS`.
4. Set `VOICE_GATEWAY_DOMAIN` in the server shell or an adjacent `.env` file.
5. Run `docker compose up -d --build`.
6. Verify `https://voice.example.com/health` returns `{ "ok": true }`.
7. Set Netlify variable `NEXT_PUBLIC_VOICE_GATEWAY_URL=wss://voice.example.com/voice` and redeploy the frontend.

Caddy requests and renews the TLS certificate automatically after the domain DNS
record points to the server and ports 80 and 443 are reachable.

## Local development

Use the frontend `.env.local` and run:

```powershell
pnpm.cmd run voice:gateway
```

Local origin checking stays open unless `VOICE_ALLOWED_ORIGINS` is explicitly set.
