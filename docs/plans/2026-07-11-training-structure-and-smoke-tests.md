# Training Structure And Smoke Tests Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Reduce `TrainingApp` orchestration complexity and add offline-safe automated acceptance checks for the training system.

**Architecture:** Keep `TrainingApp` as the composition layer. Move reusable session lifecycle state into `useTrainingSession` and keep the existing voice state machine in a dedicated `useVoiceTraining` hook with injected callbacks for submitting turns. Add a Node-based smoke-test script that uses the real scenario data and imports no API credentials.

**Tech Stack:** Next.js 15, React 19, TypeScript, Node.js built-in assertions, pnpm.

---

### Task 1: Extract Training Session State

**Files:**
- Create: `frontend/hooks/use-training-session.ts`
- Modify: `frontend/components/training/training-app.tsx`

**Step 1:** Move scenario selection, messages, progress, risk, report events, and reset lifecycle into a typed hook without changing its existing caller-visible behavior.

**Step 2:** Keep API submission and rendering in `TrainingApp`, consuming the new hook's state/actions.

**Step 3:** Run TypeScript checking.

### Task 2: Extract Voice Training State Machine

**Files:**
- Create: `frontend/hooks/use-voice-training.ts`
- Modify: `frontend/components/training/training-app.tsx`

**Step 1:** Move browser speech, DashScope real-time client lifecycle, playback, microphone errors, replay, mute, and hangup cleanup behind a typed hook.

**Step 2:** Preserve the existing `/api/training-chat` call path through an injected `onSubmitReply` callback.

**Step 3:** Ensure speech cues remain stripped before browser and real-time TTS.

**Step 4:** Run TypeScript checking and a production build.

### Task 3: Add Offline Acceptance Script

**Files:**
- Create: `frontend/scripts/run-training-smoke-tests.mjs`
- Modify: `frontend/package.json`

**Step 1:** Validate all 14 scenario records load, have IDs, personas, opening lines, usable scripts, and at least one trigger/coaching value.

**Step 2:** Validate RAG index readability and that each index item contains retrieval text.

**Step 3:** Validate the two API route source files explicitly declare a fallback path and return fallback response data without requiring a real provider key.

**Step 4:** Validate voice configuration, speech cue stripping, and provider configuration can be absent without removing scenario fallback behavior.

**Step 5:** Run `pnpm.cmd run test:smoke`, then run `pnpm.cmd run build`.

### Task 4: Final Verification

**Files:**
- Verify: `frontend/components/training/training-app.tsx`
- Verify: `frontend/hooks/use-training-session.ts`
- Verify: `frontend/hooks/use-voice-training.ts`
- Verify: `frontend/scripts/run-training-smoke-tests.mjs`

**Step 1:** Verify TypeScript, smoke tests, and production build.

**Step 2:** Start the local development server and request `http://127.0.0.1:3000/`.

**Step 3:** Confirm the worktree contains only intentional source, script, and plan changes.
