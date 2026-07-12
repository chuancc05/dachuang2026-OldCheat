# OldCheat Story Variants Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 为全部 14 个诈骗大类提供可维护、低重复、会话内一致的故事变体训练，并保留现有模型、RAG、语音、报告和静态 fallback。

**Architecture:** 内置种子变体保证离线可用，Netlify Blobs 提供线上覆盖，本地使用 `.data` 覆盖文件。训练开始时从启用池抽取并将变体应用为会话 Scenario 快照；后续模型、fallback、语音和报告只读取该快照。

**Tech Stack:** Next.js 15、React 19、TypeScript、Netlify Blobs、现有 DeepSeek/Ollama/RAG/语音链路、Node smoke tests、Python/Gradio 兼容加载。

---

### Task 1：建立变体数据模型与确定性抽取

**Files:**
* Create: `frontend/lib/story-variants.ts`
* Create: `frontend/data/story-variants.json`
* Modify: `frontend/lib/scenarios.ts`
* Test: `frontend/scripts/test-story-variants.mjs`

1. 定义 StoryVariant 与会话剧本卡字段。
2. 添加全部 14 场景、每场景至少 3 个种子变体。
3. 编写共享校验、启用筛选、无立即重复抽取、应用变体函数。
4. 用固定随机输入验证确定性和完整性。

### Task 2：建立持久化与安全管理 API

**Files:**
* Create: `frontend/lib/story-variant-store.ts`
* Create: `frontend/app/api/story-variants/route.ts`
* Modify: `frontend/package.json`
* Modify: `frontend/.env.example`
* Modify: `.gitignore`

1. 安装 `@netlify/blobs`。
2. 实现线上 Blobs、本地 `.data`、内置种子三级读取。
3. 普通 GET 只返回启用数据；管理 GET/POST/DELETE 校验 Bearer token。
4. 写入前执行字段、安全、唯一性校验；响应禁止缓存。

### Task 3：在训练开始时锁定变体

**Files:**
* Modify: `frontend/app/page.tsx`
* Modify: `frontend/components/training/training-app.tsx`
* Modify: `frontend/hooks/use-training-session.ts`

1. 从页面向训练组件传入种子变体，并异步读取线上覆盖。
2. 文字、浏览器语音、实时语音统一调用一次 `prepareSessionScenario`。
3. 记录近期变体 ID；重新开始时回到基础场景并重新抽取。
4. 变体读取或抽取失败时保持原 Scenario。

### Task 4：让模型、fallback 和报告服从剧本卡

**Files:**
* Modify: `frontend/app/api/training-chat/route.ts`
* Modify: `frontend/app/api/training-report/route.ts`
* Modify: `frontend/components/training/report-dialog.tsx`

1. 提示词增加锁定人物、事实、目标和压力手法，声明其优先于 RAG。
2. fallback 优先使用变体 fallbackLines，再使用原 script。
3. 报告请求、AI 提示与 UI 增加变体标题和背景。
4. 保持无 variant 的旧请求完全兼容。

### Task 5：实现轻量内容维护页面

**Files:**
* Create: `frontend/app/admin/story-variants/page.tsx`
* Create: `frontend/components/admin/story-variant-manager.tsx`

1. 实现管理令牌连接、按场景筛选、列表和表单。
2. 支持新建、编辑、启停和删除。
3. 前端展示服务端校验错误并保留输入。
4. 不把令牌写入 localStorage、URL 或日志。

### Task 6：Python/Gradio 兼容

**Files:**
* Create: `app/core/story_variants.py`
* Modify: `app/core/dialogue_manager.py`
* Modify: `app/core/prompt_builder.py`
* Modify: `app/main.py`

1. 从前端种子文件加载并校验启用变体。
2. 开始训练时抽取并锁定变体，开场白与提示词共用该变体。
3. 无文件、无变体或解析错误时回到当前逻辑。

### Task 7：质量门禁与全量验证

**Files:**
* Modify: `frontend/scripts/check-scenario-quality.mjs`
* Modify: `frontend/scripts/run-training-smoke-tests.mjs`
* Modify: `frontend/package.json`

1. 检查 14 个场景每个至少 3 个有效变体。
2. 运行 `pnpm.cmd run test:variants`，期望全部 PASS。
3. 运行 `pnpm.cmd run scenarios:check` 和 `pnpm.cmd run test:smoke`。
4. 运行 `pnpm.cmd run lint` 和 `pnpm.cmd run build`。
5. 启动开发服务，验证普通 GET、未授权写入拒绝和训练首句变化。

