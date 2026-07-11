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

console.log("\n训练系统离线验收通过：场景、RAG、API 兜底和语音降级均已检查。")
