import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const frontendRoot = path.resolve(scriptDir, "..")
const repoRoot = path.resolve(frontendRoot, "..")

function readText(relativePath) {
  return fs.readFileSync(path.join(frontendRoot, relativePath), "utf8")
}

function readJson(absolutePath) {
  return JSON.parse(fs.readFileSync(absolutePath, "utf8"))
}

function check(name, callback) {
  try {
    callback()
    console.log(`PASS ${name}`)
  } catch (error) {
    console.error(`FAIL ${name}`)
    throw error
  }
}

check("14 个动态场景可加载并具备开场话术", () => {
  const library = readJson(path.join(repoRoot, "data", "scenario_library.json"))
  const scenes = library.scenes
  assert.ok(Array.isArray(scenes), "场景库缺少 scenes 数组")
  assert.equal(scenes.length, 14, "场景总数必须为 14")

  for (const scene of scenes) {
    assert.match(scene.id ?? "", /^SC-\d{2}$/u, "场景缺少规范 ID")
    assert.ok(String(scene.name ?? "").trim(), `${scene.id} 缺少名称`)
    assert.ok(String(scene.core_tactics ?? "").trim(), `${scene.id} 缺少诈骗套路`)
    assert.ok(String(scene.backstory ?? "").trim(), `${scene.id} 缺少背景说明`)
    assert.ok(Array.isArray(scene.openings) && scene.openings.some((line) => String(line).trim().length >= 8), `${scene.id} 缺少可用开场白`)
  }
})

check("场景质量与 14 个音色映射通过现有质检", () => {
  const result = spawnSync(process.execPath, ["scripts/check-scenario-quality.mjs"], {
    cwd: frontendRoot,
    encoding: "utf8",
  })
  assert.equal(result.status, 0, result.stdout || result.stderr || "场景质量检查失败")
})

check("RAG 索引可读取且每条参考样本都有检索文本", () => {
  const index = readJson(path.join(frontendRoot, "data", "rag-index.json"))
  assert.ok(Array.isArray(index.documents), "RAG 索引缺少 documents")
  assert.ok(index.documents.length > 0, "RAG 索引不能为空")
  for (const document of index.documents) {
    assert.ok(String(document.id ?? "").trim(), "RAG 样本缺少 id")
    assert.ok(String(document.text ?? "").trim(), `RAG 样本 ${document.id ?? "未知"} 缺少 text`)
  }
})

check("训练对话 API 具备模型失败时的场景库兜底", () => {
  const route = readText("app/api/training-chat/route.ts")
  assert.match(route, /function fallbackTurn\(/u, "训练对话 API 缺少 fallbackTurn")
  assert.match(route, /source:\s*"fallback"/u, "训练对话 API 缺少 fallback 来源")
  assert.match(route, /catch \(error\)[\s\S]{0,900}fallbackTurn\(/u, "训练对话 API 未在失败时进入 fallback")
})

check("故事变体覆盖全部场景且训练、模型和报告共享剧本卡", () => {
  const variants = readJson(path.join(frontendRoot, "data", "story-variants.json")).variants
  assert.equal(variants.length, 42, "应提供 14×3 个种子故事变体")
  const training = readText("components/training/training-app.tsx")
  const chat = readText("app/api/training-chat/route.ts")
  const report = readText("components/training/report-dialog.tsx")
  assert.match(training, /prepareSessionScenario/u, "训练入口未统一准备剧本卡")
  assert.match(training, /rememberStoryVariant/u, "训练入口未记录防重复历史")
  assert.match(chat, /Locked story card for this session/u, "模型提示词没有锁定剧本卡")
  assert.match(chat, /locked story card always wins/u, "RAG 与剧本卡冲突时缺少优先级")
  assert.match(report, /scenario\.variant/u, "报告没有记录故事变体")
})

check("故事变体管理接口保护写入并保留种子降级", () => {
  const route = readText("app/api/story-variants/route.ts")
  const store = readText("lib/story-variant-store.ts")
  assert.match(route, /STORY_VARIANT_ADMIN_TOKEN/u, "管理写入缺少服务器令牌")
  assert.match(route, /timingSafeEqual/u, "管理令牌比较缺少恒定时间保护")
  assert.match(route, /Cache-Control.*no-store/u, "管理接口响应不应缓存")
  assert.match(store, /netlify-blobs/u, "线上覆盖缺少 Netlify Blobs")
  assert.match(store, /cloneSeed\(\)/u, "在线存储故障缺少种子降级")
})

check("训练报告 API 具备无模型环境的失败响应", () => {
  const route = readText("app/api/training-report/route.ts")
  assert.match(route, /export async function POST/u, "训练报告 API 缺少 POST 入口")
  assert.match(route, /source:\s*"fallback"/u, "训练报告 API 缺少 fallback 来源")
  assert.match(route, /catch \(error\)/u, "训练报告 API 缺少失败处理")
})

check("语音配置缺失时仍保留默认音色与文字训练兜底", () => {
  const voiceConfig = readText("lib/voice/scenario-voices.ts")
  const voiceUi = readText("components/training/voice-call-panel.tsx")
  assert.match(voiceConfig, /DEFAULT_SCENARIO_VOICE/u, "缺少默认语音映射")
  assert.match(voiceConfig, /\?\? DEFAULT_SCENARIO_VOICE/u, "未知场景没有默认音色兜底")
  assert.match(voiceUi, /改用文字输入/u, "语音界面缺少文字训练兜底提示")
})

check("语气提示不会作为对话内容展示或朗读", () => {
  const speechText = readText("lib/speech-text.ts")
  const scenarioAudio = readText("lib/voice/scenario-audio.ts")
  assert.match(speechText, /stripSpeechCues/u, "缺少语气提示过滤函数")
  assert.match(scenarioAudio, /stripSpeechCues\(turn\.line\)/u, "TTS 片段没有过滤语气提示")
})

check("线上健康检查不缓存且只返回非敏感运行状态", () => {
  const route = readText("app/api/health/route.ts")
  const runtimeStatus = readText("lib/runtime-status.ts")
  assert.match(route, /export const dynamic = "force-dynamic"/u, "健康检查必须是动态响应")
  assert.match(route, /Cache-Control": "no-store, max-age=0"/u, "健康检查不能被 CDN 缓存")
  assert.match(route, /getRuntimeStatus\(\)/u, "健康检查缺少运行状态响应")
  assert.doesNotMatch(route, /process\.env/u, "健康路由不应直接映射环境变量")
  assert.match(runtimeStatus, /fallbackReady: true/u, "健康状态缺少场景库兜底声明")
  assert.match(runtimeStatus, /browserFallbackReady: true/u, "健康状态缺少浏览器语音兜底声明")
  assert.match(runtimeStatus, /textFallbackReady: true/u, "健康状态缺少文字训练兜底声明")
})

check("RAG 配置异常时保留关键词检索兜底", () => {
  const rag = readText("lib/rag.ts")
  assert.match(rag, /mode: "lexical"/u, "RAG 缺少关键词检索模式")
  assert.match(rag, /lexicalFallbackReady/u, "RAG 运行状态缺少兜底声明")
  assert.match(rag, /catch \(error\)[\s\S]{0,1600}mode: "lexical"/u, "向量检索失败后未回退关键词检索")
})

check("实时语音网关具备生产来源限制和容器部署配置", () => {
  const gateway = readText("voice-gateway/server.mjs")
  const dockerfile = readText("voice-gateway/Dockerfile")
  const compose = readText("voice-gateway/docker-compose.yml")
  const caddyfile = readText("voice-gateway/Caddyfile")
  assert.match(gateway, /VOICE_ALLOWED_ORIGINS/u, "语音网关缺少来源限制配置")
  assert.match(gateway, /verifyClient/u, "语音网关缺少 WebSocket 来源校验")
  assert.match(gateway, /VOICE_GATEWAY_HOST/u, "语音网关缺少生产监听地址配置")
  assert.match(dockerfile, /FROM node:20-alpine/u, "语音网关缺少 Node 20 容器镜像")
  assert.match(compose, /caddy/u, "语音网关缺少 TLS 反向代理服务")
  assert.match(caddyfile, /reverse_proxy voice-gateway:8787/u, "Caddy 未转发到语音网关")
})

check("AI 与向量密钥只从专用秘密变量读取", () => {
  const chatRoute = readText("app/api/training-chat/route.ts")
  const rag = readText("lib/rag.ts")
  assert.doesNotMatch(chatRoute, /envValueBase64\("RAG_EMBED_BATCH_SIZE"\)/u, "DeepSeek 密钥仍从批量大小变量读取")
  assert.doesNotMatch(rag, /envValueBase64\("RAG_EMBED_DIMENSIONS"\)/u, "DashScope 密钥仍从向量维度变量读取")
  assert.match(chatRoute, /DEEPSEEK_API_KEY_B64/u, "DeepSeek 缺少专用 Base64 Secret 支持")
  assert.match(rag, /DASHSCOPE_API_KEY_B64/u, "DashScope 缺少专用 Base64 Secret 支持")
})

console.log("\n训练系统离线验收通过：场景、RAG、API 兜底和语音降级均已检查。")
