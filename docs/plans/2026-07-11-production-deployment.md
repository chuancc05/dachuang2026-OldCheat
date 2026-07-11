# Production Deployment Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Deploy the Next.js application to the existing Netlify site and package the real-time voice gateway for a secure, low-resource public `wss://` deployment.

**Architecture:** Netlify hosts the Next.js UI, route handlers, DeepSeek calls, and DashScope RAG. A standalone Node.js WebSocket gateway holds only DashScope real-time voice credentials; it is packaged as a Docker service and placed behind Caddy for TLS. The browser connects only to the gateway's public `wss://` URL and is restricted to the Netlify site origin.

**Tech Stack:** Next.js 15, Netlify Next.js adapter, Node.js 20, ws, Docker Compose, Caddy, DashScope Realtime API.

---

### Task 1: Harden And Package The Voice Gateway

**Files:**
- Modify: `frontend/voice-gateway/server.mjs`
- Create: `frontend/voice-gateway/package.json`
- Create: `frontend/voice-gateway/Dockerfile`
- Create: `frontend/voice-gateway/docker-compose.yml`
- Create: `frontend/voice-gateway/Caddyfile`
- Create: `frontend/voice-gateway/.env.production.example`

**Step 1:** Bind the gateway to a configurable host with production default `0.0.0.0`.

**Step 2:** Require an allowed-origin list in production and reject browser WebSocket upgrades from other origins.

**Step 3:** Package only the gateway dependency (`ws`) in a small Node 20 container.

**Step 4:** Add Caddy reverse proxy configuration to terminate TLS and expose a public `wss://.../voice` endpoint.

### Task 2: Document Environment Split

**Files:**
- Modify: `frontend/.env.example`
- Create: `frontend/voice-gateway/README.md`

**Step 1:** Separate Netlify-only variables from gateway-only DashScope realtime variables.

**Step 2:** Document the required production origin and the update to `NEXT_PUBLIC_VOICE_GATEWAY_URL`.

### Task 3: Deploy And Verify

**Files:**
- Verify: `netlify.toml`
- Verify: `frontend/app/api/health/route.ts`

**Step 1:** Run smoke checks, TypeScript, and production build.

**Step 2:** Authenticate Netlify CLI, set site runtime variables, deploy a preview, test `/api/health`, then deploy production.

**Step 3:** Start the gateway container on the selected public host, verify `/health` and a secure browser WebSocket connection, then set the Netlify public gateway URL and redeploy.
