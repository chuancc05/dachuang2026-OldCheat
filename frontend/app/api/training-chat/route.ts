import { NextRequest, NextResponse } from "next/server"
import type { Message } from "@/components/training/simulation-stage"
import type { Scenario, ScriptTurn } from "@/lib/scenarios"
import { formatRagReferences, retrieveRagContext, type RagContext } from "@/lib/rag"
import { audioCuePrompt, createAudioTurn } from "@/lib/voice/scenario-audio"

interface ChatRequest {
  scenario: Scenario
  messages: Message[]
  userText: string
  turnIndex: number
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
  return envValue("DEEPSEEK_API_KEY") || envValueBase64("DEEPSEEK_API_KEY_B64") || envValueBase64("RAG_EMBED_BATCH_SIZE")
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
  const persona = scenario.persona || ""
  const afterDot = persona.includes("·") ? persona.split("·").pop()?.trim() ?? "" : ""
  const afterQuote = persona.match(/」\s*(.+)$/u)?.[1]?.trim() ?? ""
  const candidates = [afterDot, afterQuote].filter(Boolean)
  return candidates.find((name) => !["来电", "工作人员", "官方客服", "退款专员", "风控专员", "紧急威胁"].includes(name)) ?? ""
}

function buildIdentityRules(scenario: Scenario): string[] {
  const fixedName = fixedPersonaName(scenario)
  const rules = [
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
  const fallback = scenario.script[turnIndex % Math.max(scenario.script.length, 1)]
  if (fallback) return fallback

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

function buildSystemPrompt(scenario: Scenario, turnIndex: number, ragContext?: RagContext): string {
  const examples = scenario.script
    .slice(0, 8)
    .map((turn, index) => `${index + 1}. ${turn.line}`)
    .join("\n")

  const ragReferences = ragContext?.references?.length
    ? formatRagReferences(ragContext.references)
    : "No retrieved examples."

  return [
    "You generate safe simulated scammer dialogue for an anti-fraud training app for older adults.",
    "Always reply in Simplified Chinese.",
    "Role: a simulated scammer persona inside a protected training environment, not a real criminal.",
    `Scenario title: ${scenario.title}`,
    `Difficulty: ${scenario.difficulty}`,
    `Scenario background: ${scenario.tagline}`,
    `Core tactics: ${scenario.method}`,
    "Reference lines from the scenario library. Use their tone, pacing, and risk cues, but do not copy them mechanically:",
    examples || "No reference lines.",
    "Retrieved TeleAntiFraud-style references from the local RAG layer. Prefer these when they match the current scene and user reply:",
    ragReferences,
    "Reply rules:",
    "1. Output only the next sentence or short paragraph from the simulated persona. No explanations, no role labels.",
    "2. Keep it natural, oral, and scenario-specific. 40-90 Chinese characters is ideal.",
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
) {
  const recent = messages
    .filter((message) => message.sender !== "system")
    .slice(-10)
    .map((message) => ({
      role: message.sender === "user" ? "user" : "assistant",
      content: message.text,
    }))

  return [
    { role: "system", content: buildSystemPrompt(scenario, turnIndex, ragContext) },
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
        messages: buildMessages(scenario, messages, userText, turnIndex, ragContext),
        stream: false,
        temperature: 1.1,
        max_tokens: 220,
      }),
      signal,
    })

    if (!response.ok) throw new Error(`DeepSeek returned ${response.status}`)

    const data = await response.json()
    const content = sanitizeAiText(data?.choices?.[0]?.message?.content ?? "")
    if (!content) throw new Error("DeepSeek returned empty content")
    return content
  })
}

async function askOllama(
  scenario: Scenario,
  messages: Message[],
  userText: string,
  turnIndex: number,
  ragContext?: RagContext,
): Promise<string> {
  return withTimeout(45_000, async (signal) => {
    const response = await fetch(`${ollamaUrl().replace(/\/$/, "")}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: ollamaModel(),
        stream: false,
        messages: buildMessages(scenario, messages, userText, turnIndex, ragContext),
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
): Promise<{ line: string; source: Exclude<AiSource, "fallback">; errors: string[] }> {
  const errors: string[] = []

  for (const provider of providerOrder()) {
    try {
      const line =
        provider === "deepseek"
          ? await askDeepSeek(scenario, messages, userText, turnIndex, ragContext)
          : await askOllama(scenario, messages, userText, turnIndex, ragContext)
      return { line, source: provider, errors }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      errors.push(`${provider}: ${message}`)
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

  const { scenario, messages = [], userText = "", turnIndex = 0 } = body
  if (!scenario || !userText.trim()) {
    return NextResponse.json({ error: "Missing scenario or userText" }, { status: 400 })
  }
  const ragContext = await retrieveRagContext(scenario, messages, userText.trim())

  try {
    const result = await generateAiLine(scenario, messages, userText.trim(), turnIndex, ragContext)
    const audioTurn = createAudioTurn(scenario, normalizeAiIdentity(result.line, scenario), turnIndex)
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

