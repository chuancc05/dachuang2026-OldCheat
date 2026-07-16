import { NextRequest, NextResponse } from "next/server"
import type { Message } from "@/components/training/simulation-stage"
import type { Scenario, ScriptTurn } from "@/lib/scenarios"
import { formatRagReferences, retrieveRagContext, type RagContext } from "@/lib/rag"
import {
  findIdentityConflicts,
  identityCorrectionPrompt,
  identityPromptLines,
  normalizeIdentityContract,
  sanitizeIdentityText,
  sanitizeRagContextForIdentity,
} from "@/lib/scenario-identity.mjs"
import { audioCuePrompt, createAudioTurn } from "@/lib/voice/scenario-audio"

interface ChatRequest {
  scenario: Scenario
  messages: Message[]
  userText: string
  turnIndex: number
  realtimeVoice?: boolean
}

type AiProvider = "auto" | "deepseek" | "ollama"
type AiSource = "deepseek" | "ollama" | "fallback"

function redactRagExcerpt(value: string): string {
  return value
    .replace(/https?:\/\/\S+/giu, "[已隐藏链接]")
    .replace(/\b1[3-9]\d{9}\b/gu, "[已隐藏手机号]")
    .replace(/(?:账号|账户|银行卡)\s*[：:]?\s*\d{8,}/gu, (match) => match.replace(/\d/g, "*"))
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 120)
}

function ragDebugPayload(context: RagContext) {
  return {
    enabled: context.enabled,
    mode: context.mode,
    count: context.references.length,
    error: context.error,
    references: context.references.map((reference) => ({
      id: reference.id,
      sceneId: reference.sceneId,
      sceneName: reference.sceneName,
      source: reference.source,
      tags: reference.tags.slice(0, 5),
      score: Number(reference.score.toFixed(3)),
      excerpt: redactRagExcerpt(reference.text),
    })),
  }
}

function envValue(key: string): string {
  return (process.env[key] ?? "").trim()
}

function envValueBase64(key: string): string {
  const value = envValue(key)
  if (!value) return ""
  try {
    const decoded = Buffer.from(value, "base64").toString("utf8").trim()
    return decoded.startsWith("sk-") ? decoded : ""
  } catch {
    return ""
  }
}

function aiProvider(): AiProvider {
  return normalizeProvider(envValue("AI_PROVIDER"))
}

function deepSeekApiKey(): string {
  return envValue("DEEPSEEK_API_KEY") || envValueBase64("DEEPSEEK_API_KEY_B64")
}

function deepSeekBaseUrl(): string {
  return envValue("DEEPSEEK_BASE_URL") || "https://api.deepseek.com"
}

function deepSeekDialogModel(): string {
  return envValue("DEEPSEEK_MODEL_DIALOG") || "deepseek-v4-flash"
}

function ollamaUrl(): string {
  return envValue("OLLAMA_URL") || "http://127.0.0.1:11434"
}

function ollamaModel(): string {
  return envValue("OLLAMA_MODEL") || envValue("DEFAULT_MODEL") || "qwen2:7b"
}

function identityCorrectionEnabled(): boolean {
  return envValue("IDENTITY_CORRECTION_ENABLED").toLowerCase() !== "false"
}

function normalizeProvider(value?: string): AiProvider {
  const normalized = value?.trim().toLowerCase()
  if (normalized === "deepseek" || normalized === "ollama" || normalized === "auto") {
    return normalized
  }
  return "auto"
}

function splitTactics(method = ""): string[] {
  return method
    .split(/[+、，,]/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function pickTrigger(scenario: Scenario, text: string, turnIndex: number): string {
  const tactics = splitTactics(scenario.method)
  const matched = tactics.find((item) => item.length >= 2 && text.includes(item.slice(0, 2)))
  return matched ?? tactics[turnIndex % Math.max(tactics.length, 1)] ?? scenario.title
}

function buildCoach(trigger: string): string {
  if (trigger.includes("验证码")) {
    return "任何验证码都等同于账户控制权。训练中可以识别话术，但现实中绝不能透露验证码。"
  }
  if (trigger.includes("转账") || trigger.includes("资金") || trigger.includes("垫付")) {
    return "只要进入转账、垫付、资金验证环节，就应立刻停止沟通并联系家人或官方渠道核实。"
  }
  if (trigger.includes("阻止") || trigger.includes("隔离") || trigger.includes("保密")) {
    return "不让你告诉家人、阻止你核实，是高危信号。越急越要停下来。"
  }
  if (trigger.includes("高收益") || trigger.includes("保本") || trigger.includes("内部")) {
    return "高收益、保本、内部名额常被组合使用。不要下载陌生平台，不要被收益截图带节奏。"
  }
  return `识别到“${trigger}”相关话术。先稳住节奏，不透露个人信息，不点击链接，不转账。`
}

function fixedPersonaName(scenario: Scenario): string {
  const contractName = scenario.variant?.identityContract.caller.displayName?.trim()
  if (contractName) return contractName
  const persona = scenario.persona || ""
  const afterDot = persona.includes("·") ? persona.split("·").pop()?.trim() ?? "" : ""
  const afterQuote = persona.match(/」\s*(.+)$/u)?.[1]?.trim() ?? ""
  const candidates = [afterDot, afterQuote].filter(Boolean)
  return candidates.find((name) => !["来电", "工作人员", "官方客服", "退款专员", "风控专员", "紧急威胁"].includes(name)) ?? ""
}

function buildIdentityRules(scenario: Scenario): string[] {
  const contract = normalizeIdentityContract(scenario.variant?.identityContract, scenario.variant ?? { persona: scenario.persona })
  const fixedName = fixedPersonaName(scenario)
  const rules = [
    ...identityPromptLines(contract),
    `Fixed caller/persona shown to the trainee: ${scenario.persona}.`,
    "Keep identity consistent across every turn. Do not invent a different caller name, job title, relative, or organization.",
  ]
  if (fixedName) {
    rules.push(`If you introduce yourself or are asked who you are, use exactly this displayed name/title: ${fixedName}.`)
    rules.push("Do not rename yourself to 小王、小李、小张、小赵、小陈、李华、王强 or any other new name.")
  }
  if (scenario.persona.includes("女儿")) {
    rules.push("This family impersonation role is a daughter. Do not call yourself 儿子 or 小军; use 女儿/小雪 if needed.")
  }
  if (scenario.persona.includes("儿子")) {
    rules.push("This family impersonation role is a son. Do not call yourself 女儿.")
  }
  return rules
}

function normalizeAiIdentity(line: string, scenario: Scenario): string {
  let normalized = line
  const fixedName = fixedPersonaName(scenario)
  const introArea = normalized.slice(0, 70)
  const looksLikeSelfIntro = /(我是|我叫|这里是|这边是|来自|自称)/u.test(introArea)
  const alternateNames = ["小王", "小李", "小张", "小赵", "小陈", "李华", "王强", "小军"]

  if (fixedName && looksLikeSelfIntro) {
    for (const name of alternateNames) {
      if (name !== fixedName) normalized = normalized.replaceAll(name, fixedName)
    }
  }

  if (scenario.persona.includes("女儿")) {
    normalized = normalized.replaceAll("我是你儿子", "我是你女儿")
    normalized = normalized.replaceAll("你儿子", "你女儿")
    normalized = normalized.replaceAll("儿子", "女儿")
    normalized = normalized.replaceAll("小军", fixedName || "小雪")
  }

  return normalized
}

function fallbackTurn(scenario: Scenario, turnIndex: number): ScriptTurn {
  const identity = normalizeIdentityContract(scenario.variant?.identityContract, scenario.variant ?? { persona: scenario.persona })
  for (let offset = 0; offset < scenario.script.length; offset += 1) {
    const fallback = scenario.script[(turnIndex + offset) % scenario.script.length]
    if (!fallback) continue
    const safe = sanitizeIdentityText(fallback.line, identity)
    if (safe.valid) return { ...fallback, line: safe.text }
  }

  const trigger = pickTrigger(scenario, scenario.method, turnIndex)
  return {
    line: "我这边只是按流程提醒您，您先别急着挂断，听我把情况说完。",
    trigger,
    riskDelta: 2,
    coach: buildCoach(trigger),
  }
}

function sanitizeAiText(value: string): string {
  return value
    .replace(/^骗子[:：]\s*/u, "")
    .replace(/^诈骗分子[:：]\s*/u, "")
    .replace(/^模拟对象[:：]\s*/u, "")
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180)
}

function buildSystemPrompt(scenario: Scenario, turnIndex: number, ragContext?: RagContext, realtimeVoice = false): string {
  const examples = scenario.script
    .slice(0, realtimeVoice ? 4 : 8)
    .map((turn, index) => `${index + 1}. ${turn.line}`)
    .join("\n")

  const ragReferences = ragContext?.references?.length
    ? formatRagReferences(ragContext.references.slice(0, realtimeVoice ? 2 : 3))
    : "No retrieved examples."
  const variantRules = scenario.variant ? [
    "Locked story card for this session. These facts override any conflicting RAG example or reference line:",
    `Variant ID: ${scenario.variant.id}`,
    `Variant title: ${scenario.variant.title}`,
    `Locked persona: ${scenario.variant.persona}`,
    `Locked premise: ${scenario.variant.premise}`,
    `Simulated scam objective: ${scenario.variant.objective}`,
    `Pressure tactics: ${scenario.variant.pressureTactics.join("、")}`,
    "Never change the persona, institution, incident, relationship, or objective during this session.",
  ] : ["No locked story variant. Follow the base scenario as before."]

  return [
    "You generate safe simulated scammer dialogue for an anti-fraud training app for older adults.",
    "Always reply in Simplified Chinese.",
    "Role: a simulated scammer persona inside a protected training environment, not a real criminal.",
    `Scenario title: ${scenario.title}`,
    `Difficulty: ${scenario.difficulty}`,
    `Scenario background: ${scenario.tagline}`,
    `Core tactics: ${scenario.method}`,
    ...variantRules,
    "Reference lines from the scenario library. Use their tone, pacing, and risk cues, but do not copy them mechanically:",
    examples || "No reference lines.",
    "Retrieved TeleAntiFraud-style references from the local RAG layer. Use them only for tone and risk patterns; the locked story card always wins when facts conflict:",
    ragReferences,
    "Reply rules:",
    "1. Output only the next sentence or short paragraph from the simulated persona. No explanations, no role labels.",
    realtimeVoice
      ? "2. Keep it natural, oral, and scenario-specific. Prefer 28-52 Chinese characters so this voice turn starts quickly."
      : "2. Keep it natural, oral, and scenario-specific. 36-72 Chinese characters is ideal.",
    "3. Respond to the user's last message and continue the current scam scenario instead of becoming a generic assistant.",
    "4. You may simulate pressure, urgency, flattery, isolation, or fake authority for training purposes.",
    "5. Never request real bank cards, ID numbers, passwords, real verification codes, home addresses, or other sensitive data.",
    "6. If the plot needs payment, links, accounts, or codes, use clearly fictional placeholders such as mock account, mock app, mock link, or mock code.",
    "7. Do not provide real executable fraud instructions, real links, real accounts, or real contact information.",
    "8. Treat retrieved references as style and risk-pattern examples only. Do not copy full sample text verbatim.",
    "Identity consistency rules:",
    ...buildIdentityRules(scenario),
    ...audioCuePrompt(scenario, turnIndex),
  ].join("\n")
}

function buildMessages(
  scenario: Scenario,
  messages: Message[],
  userText: string,
  turnIndex: number,
  ragContext?: RagContext,
  realtimeVoice = false,
) {
  const recent = messages
    .filter((message) => message.sender !== "system")
    .slice(realtimeVoice ? -6 : -10)
    .map((message) => ({
      role: message.sender === "user" ? "user" : "assistant",
      content: message.text,
    }))

  return [
    { role: "system", content: buildSystemPrompt(scenario, turnIndex, ragContext, realtimeVoice) },
    ...recent,
    { role: "user", content: userText },
  ]
}

async function withTimeout<T>(ms: number, task: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), ms)
  try {
    return await task(controller.signal)
  } finally {
    clearTimeout(timeout)
  }
}

async function askDeepSeek(
  scenario: Scenario,
  messages: Message[],
  userText: string,
  turnIndex: number,
  ragContext?: RagContext,
  realtimeVoice = false,
): Promise<string> {
  const apiKey = deepSeekApiKey()
  if (!apiKey) throw new Error("DeepSeek API key is not configured")

  return withTimeout(45_000, async (signal) => {
    const response = await fetch(`${deepSeekBaseUrl().replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: deepSeekDialogModel(),
        messages: buildMessages(scenario, messages, userText, turnIndex, ragContext, realtimeVoice),
        // DeepSeek V4 defaults to thinking mode. These short dialogue turns need
        // the final content immediately; otherwise the small token budget can be
        // consumed by reasoning_content and leave content empty.
        thinking: { type: "disabled" },
        stream: false,
        temperature: 1.1,
        max_tokens: realtimeVoice ? 88 : 120,
      }),
      signal,
    })

    if (!response.ok) throw new Error(`DeepSeek returned ${response.status}`)

    const data = await response.json()
    const message = data?.choices?.[0]?.message
    const content = sanitizeAiText(message?.content ?? "")
    if (!content) {
      const reasoningLength = String(message?.reasoning_content ?? "").length
      const finishReason = String(data?.choices?.[0]?.finish_reason ?? "unknown")
      throw new Error(
        `DeepSeek returned empty content (finish=${finishReason}, reasoningChars=${reasoningLength})`,
      )
    }
    return content
  })
}

async function askOllama(
  scenario: Scenario,
  messages: Message[],
  userText: string,
  turnIndex: number,
  ragContext?: RagContext,
  realtimeVoice = false,
): Promise<string> {
  return withTimeout(45_000, async (signal) => {
    const response = await fetch(`${ollamaUrl().replace(/\/$/, "")}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: ollamaModel(),
        stream: false,
        messages: buildMessages(scenario, messages, userText, turnIndex, ragContext, realtimeVoice),
        options: {
          temperature: 0.78,
          top_p: 0.9,
          repeat_penalty: 1.12,
        },
      }),
      signal,
    })

    if (!response.ok) throw new Error(`Ollama returned ${response.status}`)

    const data = await response.json()
    const content = sanitizeAiText(data?.message?.content ?? "")
    if (!content) throw new Error("Ollama returned empty content")
    return content
  })
}

function providerOrder(): Exclude<AiSource, "fallback">[] {
  const provider = aiProvider()
  const hasDeepSeekKey = Boolean(deepSeekApiKey())
  if (provider === "ollama") return ["ollama"]
  if (provider === "deepseek") return hasDeepSeekKey ? ["deepseek", "ollama"] : ["ollama"]
  return hasDeepSeekKey ? ["deepseek", "ollama"] : ["ollama"]
}

async function generateAiLine(
  scenario: Scenario,
  messages: Message[],
  userText: string,
  turnIndex: number,
  ragContext?: RagContext,
  realtimeVoice = false,
): Promise<{ line: string; source: Exclude<AiSource, "fallback">; errors: string[] }> {
  const errors: string[] = []
  const identity = normalizeIdentityContract(scenario.variant?.identityContract, scenario.variant ?? { persona: scenario.persona })

  for (const provider of providerOrder()) {
    try {
      const candidate =
        provider === "deepseek"
          ? await askDeepSeek(scenario, messages, userText, turnIndex, ragContext, realtimeVoice)
          : await askOllama(scenario, messages, userText, turnIndex, ragContext, realtimeVoice)
      const normalized = sanitizeIdentityText(normalizeAiIdentity(candidate, scenario), identity)
      if (normalized.valid) return { line: normalized.text, source: provider, errors }

      if (!identityCorrectionEnabled()) {
        throw new Error(`Identity correction failed: disabled; ${normalized.conflicts.join("、")}`)
      }

      const correctionRequest = [
        `Previous candidate: ${normalized.text}`,
        identityCorrectionPrompt(normalized.conflicts, identity),
      ].join("\n")
      let correctedCandidate: string
      try {
        correctedCandidate = provider === "deepseek"
          ? await askDeepSeek(scenario, messages, correctionRequest, turnIndex, ragContext, realtimeVoice)
          : await askOllama(scenario, messages, correctionRequest, turnIndex, ragContext, realtimeVoice)
      } catch (error) {
        throw new Error(`Identity correction failed: ${error instanceof Error ? error.message : String(error)}`)
      }
      const corrected = sanitizeIdentityText(normalizeAiIdentity(correctedCandidate, scenario), identity)
      if (corrected.valid) return { line: corrected.text, source: provider, errors }
      throw new Error(`Identity correction failed: ${findIdentityConflicts(corrected.text, identity).join("、")}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      errors.push(`${provider}: ${message}`)
      if (message.startsWith("Identity correction failed:")) break
    }
  }

  throw new Error(errors.join(" | ") || "No AI provider available")
}

export async function POST(request: NextRequest) {
  let body: ChatRequest
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const { scenario, messages = [], userText = "", turnIndex = 0, realtimeVoice = false } = body
  if (!scenario || !userText.trim()) {
    return NextResponse.json({ error: "Missing scenario or userText" }, { status: 400 })
  }
  const identity = normalizeIdentityContract(scenario.variant?.identityContract, scenario.variant ?? { persona: scenario.persona })
  const retrievedRagContext = await retrieveRagContext(scenario, messages, userText.trim())
  const ragContext = sanitizeRagContextForIdentity(retrievedRagContext, identity) as RagContext

  try {
    const result = await generateAiLine(scenario, messages, userText.trim(), turnIndex, ragContext, realtimeVoice)
    const audioTurn = createAudioTurn(scenario, result.line, turnIndex)
    const trigger = pickTrigger(scenario, audioTurn.line, turnIndex)
    return NextResponse.json({
      line: audioTurn.line,
      audioCues: audioTurn.cues,
      trigger,
      riskDelta: Math.min(4.5, 1.8 + turnIndex * 0.35),
      coach: buildCoach(trigger),
      source: result.source,
      rag: ragDebugPayload(ragContext),
    })
  } catch (error) {
    const fallback = fallbackTurn(scenario, turnIndex)
    const audioTurn = createAudioTurn(scenario, fallback.line, turnIndex)
    return NextResponse.json({
      ...fallback,
      line: audioTurn.line,
      audioCues: audioTurn.cues,
      source: "fallback" satisfies AiSource,
      rag: ragDebugPayload(ragContext),
      error: error instanceof Error ? error.message : "Unknown AI provider error",
    })
  }
}

