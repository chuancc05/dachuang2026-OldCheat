# Realtime Voice Mobile Stability Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the browser-to-gateway realtime voice experience continuous on phones, reduce turn-transition latency, and show a clear microphone prompt whenever the trainee should speak.

**Architecture:** The voice gateway batches very small upstream PCM deltas into short, ordered packets before forwarding them to the browser. The browser keeps one local microphone track for an active call, waits for ASR readiness before opening the reply phase, and schedules packet audio with a larger initial buffer. Existing DeepSeek/RAG/fallback and browser-voice fallback paths remain unchanged.

**Tech Stack:** Next.js 15, React 19, Web Audio API, browser MediaDevices, Node.js WebSocket gateway, DashScope realtime ASR/TTS.

---

### Task 1: Stabilize gateway TTS packet delivery

**Files:**
- Modify: `frontend/voice-gateway/server.mjs`
- Modify: `frontend/voice-gateway/smoke-test.mjs`

1. Aggregate small PCM deltas into bounded packets before forwarding them to the browser.
2. Flush queued audio before each TTS completion event and discard it on cancellation.
3. Expose packet timing in `/health` and assert it in the gateway smoke test.

### Task 2: Reduce browser turn-transition overhead

**Files:**
- Modify: `frontend/lib/voice/realtime-voice-client.ts`

1. Reuse the local microphone track and AudioContext between turns while not forwarding audio during scammer playback.
2. Wait for gateway ASR readiness before presenting the reply phase.
3. Increase initial TTS queue buffering so mobile playback stays continuous during short network jitter.

### Task 3: Keep interaction explicit and responsive

**Files:**
- Modify: `frontend/components/training/voice-call-panel.tsx`
- Modify: `frontend/components/training/mobile-training-flow.tsx`
- Modify: `frontend/app/api/training-chat/route.ts`

1. Use the same visible `Mic` icon plus `请你回复` wording on desktop and mobile while the system records the user.
2. Keep the prompt visual only; do not add an audio prompt.
3. Cap normal dialog generation to a concise turn so the model does not spend time generating unused text.

### Task 4: Verify without changing training semantics

**Files:**
- Test: `frontend/voice-gateway/smoke-test.mjs`

1. Run gateway smoke test.
2. Run TypeScript type check and production build.
3. Confirm no source files outside the voice/UI/API scope changed.
