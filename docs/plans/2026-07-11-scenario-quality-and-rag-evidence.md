# Scenario Quality and RAG Evidence Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make scenario quality issues discoverable before release and expose safe, evidence-based RAG retrieval details for project demonstrations.

**Architecture:** A Node quality script reads the dynamic scenario library plus the runtime voice mapping and reports structural errors separately from content warnings. The chat route returns a redacted projection of existing RAG references; a desktop-only panel is enabled by the `ragDebug=1` URL query and does not change model prompts or ordinary elderly-user UI.

**Tech Stack:** Node.js ESM scripts, Next.js route handlers, React client components, TypeScript, existing RAG index.

---

### Task 1: Add scenario quality checks

**Files:**
- Create: `frontend/scripts/check-scenario-quality.mjs`
- Modify: `frontend/package.json`

**Steps:**
1. Read the bundled dynamic scenario library and runtime scenario voice mapping.
2. Check scene count/codes, required fields, usable source lines, minimum generated turns, identity aliases, gender/voice consistency, speech cues, and real contact patterns.
3. Print a concise per-scene report, returning nonzero only for structural errors by default and including warnings in `--strict` mode.

### Task 2: Add safe RAG evidence metadata

**Files:**
- Modify: `frontend/app/api/training-chat/route.ts`
- Create: `frontend/components/training/rag-debug-panel.tsx`
- Modify: `frontend/components/training/training-app.tsx`

**Steps:**
1. Return source, sample ID, tags, score, and a redacted text excerpt from the already retrieved references.
2. Parse the metadata in the existing training response handler.
3. Render it only when `ragDebug=1` is present on desktop.

### Task 3: Verify both paths

**Files:**
- Test: `frontend/scripts/check-scenario-quality.mjs`
- Test: `frontend/app/api/training-chat/route.ts`

**Steps:**
1. Run the normal and strict scenario checks.
2. Run TypeScript validation and the production build.
3. Confirm regular UI remains free of the RAG debug panel without the query parameter.
