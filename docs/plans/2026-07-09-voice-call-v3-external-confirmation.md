# V3 实时语音通话外部条件确认报告

确认日期：2026-07-09

## 1. 当前阿里云百炼账号是否已开通实时语音识别

结论：已确认可用。

确认方式：

- 使用项目本地 `frontend/.env.local` 中的 `DASHSCOPE_API_KEY`。
- 连接 DashScope Qwen-ASR Realtime WebSocket：
  `wss://dashscope.aliyuncs.com/api-ws/v1/realtime?model=qwen3-asr-flash-realtime`
- WebSocket 握手成功。
- 连接后收到 `session.created` 事件。

说明：

- 本次只做握手与会话创建探测，没有上传真实音频。
- 这已经足以确认当前 key 具备访问 Qwen-ASR Realtime 的基础权限。

## 2. 当前阿里云百炼账号是否已开通 Qwen-TTS Realtime

结论：已确认可用。

确认方式：

- 使用项目本地 `frontend/.env.local` 中的 `DASHSCOPE_API_KEY`。
- 连接 DashScope Qwen-TTS Realtime WebSocket：
  `wss://dashscope.aliyuncs.com/api-ws/v1/realtime?model=qwen3-tts-flash-realtime`
- WebSocket 握手成功。
- 连接后收到 `session.created` 事件。

说明：

- 本次只做会话创建探测，没有发送文本合成请求。
- 这已经足以确认当前 key 具备访问 Qwen-TTS Realtime 的基础权限。

## 3. 当前 sk key 是否可用于实时 ASR/TTS WebSocket

结论：可以。

证据：

| 能力 | 模型 | WebSocket 鉴权 | 会话创建 |
| --- | --- | --- | --- |
| 实时 ASR | `qwen3-asr-flash-realtime` | 成功 | `session.created` |
| 流式 TTS | `qwen3-tts-flash-realtime` | 成功 | `session.created` |

安全说明：

- 本报告不保存、不展示真实 key。
- 真实 key 仍应只放在服务端环境变量中。
- 线上 V3 不能把长期 key 暴露给浏览器。

## 4. 是否需要 Workspace ID

结论：首版 V3 不强制需要 Workspace ID，但建议后续补充。

依据：

- 本次实测使用通用域名 `dashscope.aliyuncs.com`，未提供 Workspace ID，ASR 和 TTS 均能成功建立会话。
- 阿里云官方文档建议使用业务空间专属域名以获得更好性能和稳定性。
- 文档也说明现有通用域名仍可正常使用。

产品决策：

- V3 首版可以先不阻塞在 Workspace ID 上。
- 如果后续线上演示出现延迟、稳定性或地域问题，再切换到业务空间专属域名。
- PRD 中保留 `DASHSCOPE_WORKSPACE_ID` 作为可选配置。

## 5. Netlify Functions 是否能满足语音 WebSocket 代理要求

结论：不建议用于 V3 的实时语音 WebSocket 代理。

依据：

- Netlify Functions 是事件触发、短生命周期的 serverless function。
- 官方函数配置文档显示，同步执行上限为 60 秒，流式响应也有 20 MB 限制。
- V3 需要浏览器与服务端之间保持持续、双向、低延迟音频流连接；这不适合用 Netlify Functions 承担 WebSocket 语音代理。

可用范围：

- Netlify 仍适合部署 Next.js 前端。
- Netlify Functions 可以继续用于普通 HTTP API、报告生成、配置读取、短请求。
- Netlify Functions 可用于“签发语音会话配置”这类短请求，但不适合作为长期音频 WebSocket 中转。

V3 线上方案建议：

1. 前端继续部署在 Netlify。
2. 新增一个轻量语音网关，用于隐藏 DashScope key，并代理 ASR/TTS WebSocket。
3. 语音网关只处理音频转发、鉴权和会话管理，不需要 GPU，也不需要高性能服务器。
4. 本地开发可直接运行 Node 语音网关。
5. 线上可选择便宜的轻量云服务、支持 WebSocket 的云函数/API 网关、Cloudflare Workers/Durable Objects、阿里云函数计算 + WebSocket 网关等方案。

## 6. 最终确认表

| 待确认项 | 结论 | 是否阻塞 V3 |
| --- | --- | --- |
| 当前阿里云百炼账号是否开通实时语音识别 | 已开通，握手成功并收到 `session.created` | 不阻塞 |
| 当前阿里云百炼账号是否开通 Qwen-TTS Realtime | 已开通，握手成功并收到 `session.created` | 不阻塞 |
| 当前 sk key 是否可用于实时 ASR/TTS WebSocket | 可以 | 不阻塞 |
| 是否需要 Workspace ID | 首版不强制，生产建议补充 | 不阻塞 |
| Netlify Functions 是否能承担实时 WebSocket 代理 | 不建议，需轻量语音网关 | 阻塞“纯 Netlify 代理方案”，不阻塞 V3 本身 |

## 7. 下一步建议

V3 可以进入编码阶段，但架构应调整为：

```text
Netlify 前端
  ↓
轻量语音网关
  ↓
DashScope Qwen-ASR Realtime / Qwen-TTS Realtime
  ↓
现有 DeepSeek + RAG 训练链路
```

首版实现优先级：

1. 本地 Node 语音网关。
2. 前端实时语音客户端。
3. 接入 Qwen-ASR Realtime。
4. 接入 Qwen-TTS Realtime。
5. 线上部署语音网关。
6. Netlify 前端配置语音网关地址。

