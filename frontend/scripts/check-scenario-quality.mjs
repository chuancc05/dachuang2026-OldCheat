import fs from "node:fs"
import path from "node:path"
import process from "node:process"
import { fileURLToPath } from "node:url"

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const frontendRoot = path.resolve(scriptDir, "..")
const scenarioLibraryPath = path.join(frontendRoot, "data", "scenario_library.json")
const pagePath = path.join(frontendRoot, "app", "page.tsx")
const voicesPath = path.join(frontendRoot, "lib", "voice", "scenario-voices.ts")
const strict = process.argv.includes("--strict")

const EXPECTED_CODES = Array.from({ length: 14 }, (_, index) => `SC-${String(index + 1).padStart(2, "0")}`)
const EXPECTED_VOICE_GENDER = {
  "SC-01": "男",
  "SC-02": "男",
  "SC-03": "女",
  "SC-04": "女",
  "SC-05": "女",
  "SC-06": "女",
  "SC-07": "女",
  "SC-08": "女",
  "SC-09": "男",
  "SC-10": "男",
  "SC-11": "女",
  "SC-12": "男",
  "SC-13": "男",
  "SC-14": "男",
}
const NAME_ALIASES = ["小王", "小李", "小张", "小赵", "小陈", "李华", "王强", "小军", "张经理", "李经理", "李小明"]
const GENERIC_PERSONA_NAMES = new Set(["来电", "工作人员", "官方客服", "退款专员", "风控专员", "紧急威胁"])
const SPEECH_CUE_PATTERN = /[（(][^（）()]{0,160}(语气|口吻|语速|音效|背景|声音|严肃|急切|恐吓|威胁|哭声|停顿)[^（）()]{0,160}[）)]/u
const SENSITIVE_PATTERN = /https?:\/\/|\bwww\.|\b1[3-9]\d{9}\b|(?:账号|账户|银行卡)\s*[：:]?\s*\d{8,}/u

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"))
}

function normalize(value) {
  return String(value ?? "").replace(/\s+/gu, " ").trim()
}

function desiredTurnCount(difficulty = "") {
  if (difficulty.includes("高")) return 9
  if (difficulty.includes("低") && difficulty.includes("中")) return 7
  if (difficulty.includes("低")) return 6
  return 8
}

function parsePersonas(source) {
  const personas = new Map()
  const pattern = /"(SC-\d{2})":\s*"([^"]+)"/gu
  for (const match of source.matchAll(pattern)) personas.set(match[1], match[2])
  return personas
}

function parseVoiceLabels(source) {
  const voices = new Map()
  const pattern = /"(SC-\d{2})":\s*\{\s*voice:\s*"([^"]+)",\s*label:\s*"([^"]+)"\s*\}/gu
  for (const match of source.matchAll(pattern)) {
    voices.set(match[1], { voice: match[2], label: match[3] })
  }
  return voices
}

function fixedPersonaName(persona = "") {
  const afterDot = persona.includes("·") ? persona.split("·").pop()?.trim() ?? "" : ""
  const afterQuote = persona.match(/」\s*(.+)$/u)?.[1]?.trim() ?? ""
  return [afterDot, afterQuote].find((name) => name && !GENERIC_PERSONA_NAMES.has(name)) ?? ""
}

function addIssue(target, level, code, rule, detail) {
  target.push({ level, code, rule, detail })
}

function sourceLines(scene) {
  return [...(scene.openings ?? []), ...(scene.typical_lines ?? [])]
    .map(normalize)
    .filter(Boolean)
}

function hasIdentityIntro(text) {
  return /(我是|我叫|这里是|这边是|来自|客服经理|客户经理)/u.test(text)
}

const library = readJson(scenarioLibraryPath)
const personas = parsePersonas(fs.readFileSync(pagePath, "utf8"))
const voices = parseVoiceLabels(fs.readFileSync(voicesPath, "utf8"))
const errors = []
const warnings = []
const sceneSummaries = []
const sceneByCode = new Map((library.scenes ?? []).map((scene) => [scene.id, scene]))

if ((library.scenes ?? []).length !== EXPECTED_CODES.length) {
  addIssue(errors, "error", "ALL", "scene-count", `期望 ${EXPECTED_CODES.length} 个场景，实际 ${(library.scenes ?? []).length} 个。`)
}

for (const code of EXPECTED_CODES) {
  const scene = sceneByCode.get(code)
  if (!scene) {
    addIssue(errors, "error", code, "missing-scene", "动态场景库中缺少该场景。")
    continue
  }

  const lines = sourceLines(scene)
  const persona = personas.get(code)
  const voice = voices.get(code)
  const requiredFields = [
    ["name", scene.name],
    ["difficulty", scene.difficulty],
    ["core_tactics", scene.core_tactics],
    ["backstory", scene.backstory],
  ]
  for (const [field, value] of requiredFields) {
    if (!normalize(value)) addIssue(errors, "error", code, "required-field", `缺少 ${field}。`)
  }
  if (!persona) addIssue(errors, "error", code, "missing-persona", "页面 persona 映射缺失。")
  if (!voice) addIssue(errors, "error", code, "missing-voice", "实时语音映射缺失。")
  if (lines.length === 0) addIssue(errors, "error", code, "missing-lines", "没有可用于生成训练话术的 openings 或 typical_lines。")

  const minimumTurns = desiredTurnCount(scene.difficulty)
  if (lines.length < 2) {
    addIssue(warnings, "warning", code, "low-source-lines", `仅 ${lines.length} 条原始可用话术；运行时会补齐到 ${minimumTurns} 轮，建议补充更多真实风格语料。`)
  }

  const expectedGender = EXPECTED_VOICE_GENDER[code]
  if (voice && expectedGender && !voice.label.includes(expectedGender)) {
    addIssue(errors, "error", code, "voice-gender", `期望 ${expectedGender}声，当前映射为“${voice.label}”。`)
  }

  const fixedName = fixedPersonaName(persona)
  for (const line of lines) {
    if (SPEECH_CUE_PATTERN.test(line)) {
      addIssue(warnings, "warning", code, "speech-cue", `原始话术含语气或音效括号提示：${line.slice(0, 76)}`)
    }
    if (SENSITIVE_PATTERN.test(line)) {
      addIssue(errors, "error", code, "sensitive-contact", `原始话术疑似包含真实联系方式、链接或账号：${line.slice(0, 76)}`)
    }
    if (hasIdentityIntro(line)) {
      for (const alias of NAME_ALIASES) {
        if (line.includes(alias) && alias !== fixedName) {
          addIssue(warnings, "warning", code, "identity-alias", `persona 为“${persona}”，但候选话术出现“${alias}”：${line.slice(0, 76)}`)
        }
      }
    }
  }

  sceneSummaries.push({
    code,
    title: scene.name,
    persona: persona ?? "缺失",
    voice: voice?.label ?? "缺失",
    sourceLines: lines.length,
    runtimeTurns: minimumTurns,
  })
}

for (const code of personas.keys()) {
  if (!sceneByCode.has(code)) addIssue(warnings, "warning", code, "orphan-persona", "页面存在未在动态场景库使用的 persona 映射。")
}

for (const code of voices.keys()) {
  if (!sceneByCode.has(code)) addIssue(warnings, "warning", code, "orphan-voice", "语音映射未在动态场景库使用。")
}

console.log("\n场景库质量检查")
console.table(sceneSummaries)

for (const issue of [...errors, ...warnings]) {
  console.log(`[${issue.level.toUpperCase()}] ${issue.code} ${issue.rule}: ${issue.detail}`)
}

console.log(`\n结果：${errors.length} 个结构错误，${warnings.length} 个内容告警。`)
if (errors.length > 0 || (strict && warnings.length > 0)) process.exitCode = 1
