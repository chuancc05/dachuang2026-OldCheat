# Hybrid RAG Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a first stable hybrid RAG layer to the Next.js training chat so DeepSeek/Ollama can use retrieved TeleAntiFraud-style references without breaking fallback behavior.

**Architecture:** Build a server-only retriever that reads local scenario/material data, filters by scenario and tactics, optionally ranks with Ollama `bge-m3` embeddings, then injects a small reference pack into the existing prompt. Keep AI provider order unchanged: DeepSeek, Ollama, scenario fallback.

**Tech Stack:** Next.js route handlers, TypeScript, local JSON/JSONL data, Ollama `/api/embed`, DeepSeek-compatible chat completion.

---

### Task 1: Server RAG Module

**Files:**
- Create: `frontend/lib/rag.ts`

**Steps:**
1. Load `data/scenario_library.json`, `teleantifraud_1000_data_ledger.jsonl`, and supplemental materials.
2. Normalize each record to a compact RAG document with `id`, `sceneId`, `tags`, `text`, `source`.
3. Filter candidates by current scenario id and tactic tags.
4. Rank candidates by lexical overlap and optional vector similarity.
5. Return at most 5 short references for prompt injection.

### Task 2: Optional Index Builder

**Files:**
- Create: `frontend/scripts/build-rag-index.mjs`
- Modify: `frontend/package.json`

**Steps:**
1. Read the same JSON/JSONL data.
2. Call local Ollama `/api/embed` with `bge-m3`.
3. Write `frontend/data/rag-index.json`.
4. Add `pnpm run rag:build`.

### Task 3: Chat Route Integration

**Files:**
- Modify: `frontend/app/api/training-chat/route.ts`
- Modify: `frontend/.env.example`

**Steps:**
1. Retrieve references before AI generation.
2. Inject references into `buildSystemPrompt`.
3. Do not change request shape.
4. Add `rag` metadata to the response for diagnostics while keeping existing fields.
5. If RAG fails, continue the existing AI/fallback chain.

### Task 4: Verification

**Commands:**
- `pnpm.cmd run build`
- `pnpm.cmd run rag:build`

**Expected:**
- Build passes.
- RAG index generation succeeds when Ollama is running with `bge-m3`.
- `/api/training-chat` still works if no index exists or embedding fails.
