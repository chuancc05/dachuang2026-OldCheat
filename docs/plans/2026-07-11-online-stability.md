# Online Stability Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the Netlify deployment observable and resilient without exposing API keys or making health checks spend model tokens.

**Architecture:** Add a dynamic Next.js `/api/health` route backed by a server-only runtime-status helper. The desktop coach panel fetches this configuration-safe status and combines it with the actual AI/RAG result from the latest training turn. Existing training-chat, lexical RAG fallback, browser voice fallback, and text fallback remain the operational safety net.

**Tech Stack:** Next.js App Router, React 19, TypeScript, Netlify Next.js adapter, DashScope/DeepSeek configuration via environment variables.

---

### Task 1: Expose Safe Runtime Status

**Files:**
- Create: `frontend/lib/runtime-status.ts`
- Create: `frontend/app/api/health/route.ts`
- Modify: `frontend/lib/rag.ts`

**Step 1:** Export non-secret RAG readiness information: enabled state, preferred retrieval mode, provider label, index count, and lexical fallback readiness.

**Step 2:** Derive AI preference without returning any key, URL credentials, or provider response bodies. Detect Netlify-local Ollama as unavailable for the cloud primary path and report scenario fallback readiness.

**Step 3:** Return `Cache-Control: no-store` from `/api/health` so environment changes are reflected without a stale CDN response.

### Task 2: Add Visible Runtime Status

**Files:**
- Create: `frontend/components/training/runtime-status-panel.tsx`
- Modify: `frontend/components/training/coach-panel.tsx`
- Modify: `frontend/components/training/training-app.tsx`

**Step 1:** Fetch health status in a client-only panel with a retry control and a non-blocking unavailable state.

**Step 2:** Display the latest actual AI source from the training response and the latest actual RAG mode. Before a training reply, display configured preferred mode.

**Step 3:** State the active fallback path in concise Chinese without exposing implementation secrets.

### Task 3: Extend Offline Acceptance Checks

**Files:**
- Modify: `frontend/scripts/run-training-smoke-tests.mjs`

**Step 1:** Check that `/api/health` is dynamic, no-store, and never references raw secret variable values in its response mapping.

**Step 2:** Check that runtime status includes scenario fallback, lexical RAG fallback, browser voice fallback, and text fallback declarations.

**Step 3:** Run smoke tests, TypeScript checking, production build, and a local GET to `/api/health`.
