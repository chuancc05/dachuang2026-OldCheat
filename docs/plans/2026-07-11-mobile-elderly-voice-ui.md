# Mobile Elderly Voice UI Implementation Plan

> **For Codex:** Implement this plan task-by-task while preserving the existing desktop training flow.

**Goal:** Add a responsive, elderly-friendly mobile voice training flow to the existing Next.js training application without creating a second scenario or chat system.

**Architecture:** `TrainingApp` remains the single owner of scenarios, messages, voice clients, risk scores, and report data. A new presentational mobile flow receives that state and invokes the existing handlers; it is selected by a `matchMedia` breakpoint below 768px, while the current desktop JSX stays intact.

**Tech Stack:** Next.js client components, React state/effects, Tailwind CSS, lucide-react, existing `/api/training-chat`, browser/DashScope voice clients.

---

### Task 1: Add a responsive mode hook and mobile-flow component

**Files:**
- Create: `frontend/components/training/mobile-training-flow.tsx`
- Modify: `frontend/components/training/training-app.tsx`

**Steps:**
1. Add a client-side media-query hook using `(max-width: 767px)`.
2. Add a one-column mobile flow with `scene-selection`, `scene-confirm`, `voice-call`, `text-fallback`, and `result` steps.
3. Derive scenario groups from stable scenario codes and sort high-risk scenarios first inside each group.
4. Reuse the existing callbacks for scenario selection, voice start/replay, child help, hangup, text start, and report opening.

### Task 2: Preserve phone-like accessibility and safe transitions

**Files:**
- Modify: `frontend/components/training/mobile-training-flow.tsx`

**Steps:**
1. Make the primary start/retry controls at least 64px high.
2. Show caller identity, risk level, timer, concise voice status, subtitle, advice, and large action controls.
3. Require a confirmation dialog before switching away from an active scenario.
4. Show a short result screen after hangup/completion and expose the existing report dialog.

### Task 3: Verify no desktop regression

**Files:**
- Modify: `frontend/components/training/training-app.tsx`

**Steps:**
1. Render the existing desktop layout unchanged for widths at or above 768px.
2. Run the TypeScript/Next production build.
3. Inspect desktop and mobile browser layouts when a local server is available.
