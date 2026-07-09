# V3 实时语音通话实施计划

## 1. 目标

在现有 V1 语音训练基础上，实现 V3 “实时通话”体验：

- 实时 ASR：用户说话时生成中间字幕和最终转写。
- 流式 TTS：诈骗方回复边生成/边返回/边播放，减少等待感。
- 电话式状态机：接通、对方正在说、正在听、正在识别、正在思考、求助、挂断。
- 保留现有 DeepSeek/RAG、风险识别、报告和文字输入兜底。

本实施计划优先使用阿里云百炼/DashScope 实时语音能力，因为它最可能沿用当前项目已经在用的阿里云 `sk-...` key。传统智能语音交互 ISI/NLS 路线作为备选。

## 2. 当前基础

当前已存在：

- `frontend/components/training/voice-call-panel.tsx`：V1 电话式面板。
- `frontend/components/training/training-app.tsx`：V1 浏览器 ASR/TTS 轮式语音内核。
- `frontend/components/training/reply-bar.tsx`：麦克风入口。
- `frontend/app/api/training-chat/route.ts`：DeepSeek + RAG + fallback 对话链路。
- `frontend/app/api/training-report/route.ts`：训练报告链路。

V3 不能推翻上述结构，而是在 V1 语音面板和训练状态之上替换语音引擎。

## 3. 推荐架构

```text
浏览器 VoiceCallPanel
  ↓
VoiceRealtimeClient
  ↓
本项目 /api/voice/realtime WebSocket 或 Netlify Function
  ↓
阿里云百炼实时 ASR WebSocket
  ↓
最终转写
  ↓
现有 handleSend / /api/training-chat
  ↓
DeepSeek + RAG + fallback
  ↓
阿里云 Qwen-TTS Realtime WebSocket
  ↓
音频流播放 + 字幕 + 报告记录
```

## 4. 关键技术选择

### 4.1 语音供应商优先级

1. **首选：DashScope/百炼实时 ASR + Qwen-TTS Realtime**
   - 优点：更符合用户“沿用之前阿里云 key”的要求。
   - 适合：线上 Netlify 演示、答辩、软著展示。
   - 参考：阿里云百炼实时语音识别、Qwen-TTS-Realtime WebSocket 文档。

2. **备选：阿里云智能语音交互 ISI/NLS**
   - 优点：传统 ASR/TTS 产品成熟。
   - 代价：通常需要 AppKey、AccessKey ID/Secret、Token 获取流程。
   - 适合：如果百炼实时语音模型当前账号不可用。

3. **兜底：浏览器 V1 语音**
   - 优点：零成本、已验证可用。
   - 代价：不像真实实时通话。

### 4.2 服务端代理优先

首版 V3 不建议浏览器直接拿阿里云长期 key。推荐新增本项目语音代理：

```text
POST /api/voice/session
GET/WS /api/voice/realtime
POST /api/voice/end
```

如果 Netlify Functions 对长 WebSocket 支持不足，则改为：

- 本地演示：Next.js custom server 或独立 Node WebSocket 服务。
- 线上演示：短期先用 HTTP 分段 ASR/TTS 或边界更清晰的云函数中转。
- 长期产品：部署一个轻量 Node 语音网关，不需要高性能 GPU 服务器。

## 5. 实施步骤

### M1：语音引擎抽象

新增前端抽象：

```ts
type VoiceEngineStatus =
  | "idle"
  | "connecting"
  | "speaking"
  | "listening"
  | "recognizing"
  | "thinking"
  | "paused"
  | "finished"
  | "error"

type VoiceEngineEvent =
  | { type: "partial-transcript"; text: string }
  | { type: "final-transcript"; text: string; confidence?: number }
  | { type: "audio-start" }
  | { type: "audio-end" }
  | { type: "error"; message: string }
```

落地要求：

- 把当前 `training-app.tsx` 里的浏览器 ASR/TTS 逻辑移入 `frontend/lib/voice/browser-voice-engine.ts`。
- 新增 `frontend/lib/voice/types.ts`。
- `TrainingApp` 只关心事件，不直接关心具体供应商。
- 保持 V1 浏览器语音仍可用。

### M2：实时 ASR 接入

新增 DashScope 实时 ASR 引擎：

- 捕获麦克风音频。
- 转换为模型要求的音频格式。
- WebSocket 推流到服务端代理或阿里云。
- 接收中间识别和最终识别。
- 中间识别更新字幕，不进入训练报告。
- 最终识别调用 `handleSend` 并记录报告。

必须处理：

- 麦克风拒绝。
- 连接失败。
- token/key 无效。
- 静默超时。
- 用户连续长句。
- 识别为空。

### M3：流式 TTS 接入

新增 DashScope/Qwen-TTS Realtime 引擎：

- 接收诈骗方文本。
- 调用流式 TTS。
- 前端边接收音频边播放。
- 播放开始时暂停 ASR。
- 播放结束后延迟 300-500ms 再开启 ASR。
- 播放失败时降级到浏览器 `speechSynthesis` 或文本字幕。

诈骗方文本约束：

- 默认 40-90 汉字。
- 硬上限 120 汉字。
- 提示词约束“电话口吻、短句、不要长篇解释”。

### M4：电话 UI 升级

在 `VoiceCallPanel` 中增加：

- 大号通话头像。
- 实时波形/音量反馈。
- 中间字幕和最终字幕分层。
- 连接质量提示。
- 当前语音模式：百炼实时 / 浏览器兜底 / 文字兜底。
- 成本估算小标签，仅开发/演示模式显示。

按钮保留：

- 再说一遍。
- 向子女求助。
- 挂断/退出。
- 继续/暂停语音。

### M5：报告增强

报告增加“语音通话质量”模块：

- 通话总时长。
- 有效语音轮次。
- ASR 成功次数。
- ASR 失败/重说次数。
- TTS 播放失败次数。
- 求助次数。
- 挂断是否为主动安全中止。
- 估算语音成本。

## 6. 成本控制

V3 成本目标：0.30-0.60 元/场。

控制策略：

- ASR 只在用户说话阶段推流。
- TTS 播放时关闭 ASR。
- 静默 12 秒提示，持续静默则暂停推流。
- 单轮用户发言上限 45 秒。
- 单场通话默认上限 8 分钟。
- 单轮诈骗方 TTS 上限 120 汉字。
- 训练报告不触发额外语音合成。

## 7. 验收标准

- Edge/Chrome 可完成至少 5 轮实时语音训练。
- 用户说话时出现中间字幕，停顿后形成最终字幕。
- 最终字幕自动进入现有 DeepSeek/RAG 训练链路。
- 诈骗方回复能流式播放。
- TTS 播放期间 ASR 不提交任何用户回答。
- 求助和挂断在任意状态可用。
- 云语音失败时自动降级到浏览器语音或文字训练。
- 报告包含语音质量指标和每轮转写。
- `pnpm.cmd run build` 通过。
- 原有文字训练和报告不回归。

## 8. 外部条件确认结果

确认报告见：`docs/plans/2026-07-09-voice-call-v3-external-confirmation.md`。

已确认：

1. 当前阿里云百炼账号已具备 Qwen-ASR Realtime 基础访问能力。
2. 当前阿里云百炼账号已具备 Qwen-TTS Realtime 基础访问能力。
3. 当前 `sk-...` key 可用于实时 ASR/TTS WebSocket 鉴权。
4. Workspace ID 首版不强制需要，但生产环境建议补充。
5. Netlify Functions 不适合作为长期实时语音 WebSocket 代理。

因此，V3 可以进入编码阶段，但线上版需要单独部署轻量语音网关。该网关只处理音频转发、鉴权隐藏和会话管理，不需要 GPU，也不等于租高性能服务器。

## 9. 官方参考

- 阿里云百炼实时语音识别：https://help.aliyun.com/zh/model-studio/real-time-speech-recognition-user-guide
- 阿里云 Qwen-TTS-Realtime WebSocket：https://help.aliyun.com/zh/model-studio/interactive-process-of-qwen-tts-realtime-synthesis
- 阿里云智能语音交互 WebSocket 协议：https://help.aliyun.com/zh/isi/developer-reference/websocket
- 阿里云智能语音交互获取 Token：https://help.aliyun.com/zh/isi/getting-started/obtain-an-access-token
