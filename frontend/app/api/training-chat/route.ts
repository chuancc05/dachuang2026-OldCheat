import { NextRequest, NextResponse } from "next/server"
import type { Message } from "@/components/training/simulation-stage"
import type { Scenario, ScriptTurn } from "@/lib/scenarios"
import { formatRagReferences, retrieveRagContext, type RagContext } from "@/lib/rag"

interface ChatRequest {
  scenario: Scenario
  messages: Message[]
  userText: string
  turnIndex: number
}

type AiProvider = "auto" | "deepseek" | "ollama"
type AiSource = "deepseek" | "ollama" | "fallback"

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

function buildSystemPrompt(scenario: Scenario, ragContext?: RagContext): string {
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
  ].join("\n")
}

function buildMessages(scenario: Scenario, messages: Message[], userText: string, ragContext?: RagContext) {
  const recent = messages
    .filter((message) => message.sender !== "system")
    .slice(-10)
    .map((message) => ({
      role: message.sender === "user" ? "user" : "assistant",
      content: message.text,
    }))

  return [
    { role: "system", content: buildSystemPrompt(scenario, ragContext) },
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
        messages: buildMessages(scenario, messages, userText, ragContext),
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
  ragContext?: RagContext,
): Promise<string> {
  return withTimeout(45_000, async (signal) => {
    const response = await fetch(`${ollamaUrl().replace(/\/$/, "")}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: ollamaModel(),
        stream: false,
        messages: buildMessages(scenario, messages, userText, ragContext),
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
  ragContext?: RagContext,
): Promise<{ line: string; source: Exclude<AiSource, "fallback">; errors: string[] }> {
  const errors: string[] = []

  for (const provider of providerOrder()) {
    try {
      const line =
        provider === "deepseek"
          ? await askDeepSeek(scenario, messages, userText, ragContext)
          : await askOllama(scenario, messages, userText, ragContext)
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
    const result = await generateAiLine(scenario, messages, userText.trim(), ragContext)
    const trigger = pickTrigger(scenario, result.line, turnIndex)
    return NextResponse.json({
      line: result.line,
      trigger,
      riskDelta: Math.min(4.5, 1.8 + turnIndex * 0.35),
      coach: buildCoach(trigger),
      source: result.source,
      rag: {
        enabled: ragContext.enabled,
        mode: ragContext.mode,
        count: ragContext.references.length,
        ids: ragContext.references.map((ref) => ref.id),
        error: ragContext.error,
      },
    })
  } catch (error) {
    const fallback = fallbackTurn(scenario, turnIndex)
    return NextResponse.json({
      ...fallback,
      source: "fallback" satisfies AiSource,
      rag: {
        enabled: ragContext.enabled,
        mode: ragContext.mode,
        count: ragContext.references.length,
        ids: ragContext.references.map((ref) => ref.id),
        error: ragContext.error,
      },
      error: error instanceof Error ? error.message : "Unknown AI provider error",
    })
  }
}

