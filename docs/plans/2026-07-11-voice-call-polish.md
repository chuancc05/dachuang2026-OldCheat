# Voice Call Polish Implementation Plan

## Goal

Polish the existing voice-call training flow without changing the training API,
RAG retrieval, report records, or text-training fallback.

## Scope

1. Keep the existing per-scenario DashScope voice mapping as the source of
   truth for real-time calls.
2. Lock only reply input while the simulated caller is speaking. Help and
   hang-up actions must remain available.
3. Make microphone and recognition recovery explicit with a large retry action
   and short, elderly-friendly guidance.
4. Keep speech-style cues internal: they may guide synthesis, but must not be
   rendered as dialogue content or spoken aloud.
5. Use matching feedback on desktop and mobile while retaining the current
   text fallback.

## Implementation Steps

1. Add an `inputLocked` state path to the desktop reply bar. It disables text,
   quick replies, and send, but not help, pause, or hang-up.
2. Surface a short "please listen first" explanation during caller playback
   and rename retry actions according to their state.
3. Improve browser and real-time recognition error messages so the next action
   is clear: reopen the microphone, then try speaking again or use text.
4. Update the mobile error-state copy to use the same recovery wording.
5. Verify TypeScript and production build, then restart the local development
   server so the browser receives a clean Next.js asset set.

## Out of Scope

- WebRTC or continuous full-duplex calling.
- Changing voice identities, model providers, DeepSeek configuration, or RAG
  retrieval behavior.
- Persisting raw audio.
