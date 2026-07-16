# Scenario Identity Consistency Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: execute this plan task-by-task and keep the PRD completion audit current.

**Goal:** Make every training session use one immutable identity contract so SC-13 stays gender-neutral and SC-14 keeps text, RAG, fallback, voice cues, and reports on the same relative identity.

**Architecture:** Extend each controlled story variant with a normalized identity contract. Freeze that contract into the prepared session, sanitize RAG references, validate every generated line before UI/TTS, and fall back to contract-safe lines when correction fails. Voice cues and reports consume the same session snapshot; static checks and executable tests enforce the invariant across all 14 scenarios and the Python mirror.

**Tech Stack:** Next.js 15, TypeScript, Node.js executable tests, React training state, DeepSeek/Ollama-compatible API routes, DashScope RAG, browser/Aliyun voice playback, Python/Gradio parity.

---

### Task 1: Add executable identity-contract tests

**Files:**
- Create: `frontend/lib/scenario-identity.mjs`
- Create: `frontend/scripts/test-scenario-identity.mjs`
- Modify: `frontend/package.json`
- Modify: `frontend/scripts/test-story-variants.mjs`

**Steps:**
1. Add tests for neutral trainee terms, SC-14 subject aliases, conflict detection, RAG sanitization, safe fallback, and report sanitization.
2. Add tests proving variant fallback never appends raw base-script identities after its own lines are exhausted.
3. Add `test:identity` to package scripts.
4. Run the tests and confirm they fail before implementation, then pass after Tasks 2-5.

### Task 2: Extend and migrate controlled story variants

**Files:**
- Modify: `frontend/lib/story-variants.ts`
- Modify: `frontend/lib/story-variant-selector.mjs`
- Modify: `frontend/data/story-variants.json`
- Modify: `frontend/lib/story-variant-store.ts`
- Modify: `frontend/app/api/story-variants/route.ts`

**Steps:**
1. Define normalized trainee, caller, subject, forbidden-term, and distress-cue fields.
2. Derive safe neutral defaults for old variants while rejecting ambiguous enabled relative variants.
3. Add identity contracts to all 42 seed variants; SC-13 must be neutral and SC-14 must use the PRD migration baseline.
4. Freeze a deep-cloned identity snapshot into each prepared scenario.
5. Replace raw-script tail appending with contract-safe cycling templates.
6. Validate online/admin overrides with the same rules before use or save.

### Task 3: Enforce identity in AI, RAG, and fallback paths

**Files:**
- Modify: `frontend/app/api/training-chat/route.ts`
- Modify: `frontend/lib/rag.ts` only if a shared metadata hook is needed

**Steps:**
1. Serialize the locked identity contract into the model system prompt.
2. Sanitize retrieved samples before model use so conflicting relations become neutral style evidence.
3. Validate model output deterministically before returning it.
4. On conflict, make at most one correction attempt; on failure use a contract-safe fallback.
5. Return non-sensitive identity-validation diagnostics without exposing hidden prompts or secrets.

### Task 4: Make voice cues variant-aware

**Files:**
- Modify: `frontend/lib/voice/scenario-audio.ts`
- Modify: `frontend/components/training/training-app.tsx` if the variant snapshot is not already supplied
- Modify: `frontend/lib/voice/realtime-voice-client.ts` only if playback metadata is required

**Steps:**
1. Remove the scenario-global fixed `妈，救我` dynamic speech.
2. Resolve distress speech from the locked identity contract.
3. Use young female speech only for SC-14-V01, no relative speech for V02 without a matching male voice, and ambient-only speech-safe behavior for V03.
4. Preserve cancellation, replay, browser TTS, and realtime gateway behavior.

### Task 5: Keep reports and Python/Gradio behavior consistent

**Files:**
- Modify: `frontend/app/api/training-report/route.ts`
- Modify: `frontend/components/training/report-dialog.tsx`
- Modify: `app/core/story_variants.py`
- Modify: `app/core/prompt_builder.py` or the actual Python prompt entrypoint if needed

**Steps:**
1. Send the locked identity snapshot with report generation.
2. Validate AI report text and omit only the conflicting AI section when it cannot be repaired locally.
3. Normalize Python variants to the same identity defaults and contract-safe fallback behavior.
4. Prove one SC-13 and one SC-14 Python session retain the same identities as Next.js.

### Task 6: Strengthen quality gates and regression coverage

**Files:**
- Modify: `frontend/scripts/check-scenario-quality.mjs`
- Modify: `frontend/scripts/run-training-smoke-tests.mjs`
- Modify: `frontend/scripts/test-story-variants.mjs`

**Steps:**
1. Treat SC-13/SC-14 gender-address, relation, pronoun, and voice mismatches as errors.
2. Check all enabled variants for a normalized contract and forbidden-term leakage.
3. Add failure injection for AI conflict, RAG conflict, exhausted fallback, report conflict, and old online data.
4. Run `pnpm.cmd run test:identity`, `test:variants`, `scenarios:check`, and `test:smoke`.

### Task 7: Full validation and completion audit

**Files:**
- Modify: docs only if implementation evidence changes the PRD or registry.

**Steps:**
1. Run ESLint and TypeScript no-emit checks.
2. Run the Next.js production build.
3. Start the local frontend and verify `/`, `/api/health`, and the admin page return expected responses.
4. Run Python syntax/unit checks and a deterministic SC-13/SC-14 variant preparation check.
5. Inspect `git diff --check`, secrets, and unrelated changes.
6. Audit every PRD Definition of Done item against file/test/runtime evidence before marking complete.

