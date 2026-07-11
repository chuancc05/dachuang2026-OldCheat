# Training Report Enhancement Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Turn the current training report into a structured, evidence-backed replay that serves older users, family/community supporters, and project demonstrations.

**Architecture:** Rule-derived insights remain in `ReportDialog`, computed from recorded turn events and available scenarios so they work offline and when AI is unavailable. The existing report API gains one optional DeepSeek-generated family/community briefing; it never changes scores, risk classifications, or factual turn data.

**Tech Stack:** Next.js route handlers, React client component, TypeScript, existing DeepSeek-compatible report endpoint.

---

### Task 1: Add structured rule-derived report insights

**Files:**
- Modify: `frontend/components/training/report-dialog.tsx`
- Modify: `frontend/components/training/training-app.tsx`

**Steps:**
1. Pass the available dynamic scenario list to `ReportDialog`.
2. Derive correct defenses, risky/mixed responses, and the highest-risk turn from recorded report events.
3. Recommend the next suitable scenario from the same shared scenario list.
4. Render compact cards that link every conclusion to a recorded training turn.

### Task 2: Add an AI family/community briefing

**Files:**
- Modify: `frontend/app/api/training-report/route.ts`
- Modify: `frontend/components/training/report-dialog.tsx`

**Steps:**
1. Extend the strict DeepSeek JSON contract with `familyBriefing`.
2. Validate it server-side alongside existing report fields.
3. Display the briefing only when present; preserve all rule-based content when the API fails.

### Task 3: Verify report safety and build output

**Files:**
- Test: `frontend/components/training/report-dialog.tsx`

**Steps:**
1. Run TypeScript validation.
2. Run the Next.js production build.
3. Verify the report has no empty-state crash when there are fewer than two user replies or when DeepSeek is unavailable.
