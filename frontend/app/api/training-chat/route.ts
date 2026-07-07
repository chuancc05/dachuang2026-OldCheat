import { NextRequest, NextResponse } from "next/server"
import type { Message } from "@/components/training/simulation-stage"
import type { Scenario, ScriptTurn } from "@/lib/scenarios"

interface ChatRequest {
  scenario: Scenario
  messages: Message[]
  userText: string
  turnIndex: number
}

const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://127.0.0.1:11434"
const OLLAMA_MODEL = process.env.DEFAULT_MODEL ?? "qwen2:7b"

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
  if (trigger.includes("验证码")) return "任何验证码都等同于账户控制权。训练中可以识别话术，但现实中绝不能透露验证码。"
  if (trigger.includes("转账") || trigger.includes("资金") || trigger.includes("垫付")) return "只要进入转账、垫付、资金验证环节，就应立刻停止沟通并联系家人或官方渠道核实。"
  if (trigger.includes("阻止") || trigger.includes("隔离") || trigger.includes("保密")) return "不让你告诉家人、阻止你核实，是高危信号。越急越要停下来。"
  if (trigger.includes("高收益") || trigger.includes("保本") || trigger.includes("内部")) return "“高收益、保本、内部名额”常被组合使用。不要下载陌生平台，不要被收益截图带节奏。"
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

function buildSystemPrompt(scenario: Scenario): string {
  const examples = scenario.script
    .slice(0, 8)
    .map((turn, index) => `${index + 1}. ${turn.line}`)
    .join("\n")

  return [
    "你正在为一个反诈骗训练系统生成安全的诈骗话术模拟回复。",
    "你的角色是“诈骗场景模拟对象”，目标是帮助用户练习识别和拒绝骗局，而不是真实实施诈骗。",
    `当前场景：${scenario.title}`,
    `难度：${scenario.difficulty}`,
    `场景背景：${scenario.tagline}`,
    `核心套路：${scenario.method}`,
    "来自数据集/场景库的参考话术如下。只参考语气、节奏和风险点，不要逐字复述：",
    examples || "暂无样例。",
    "回复要求：",
    "1. 只输出模拟对象下一句话，不要解释，不要写旁白，不要标注角色名。",
    "2. 每次 40-90 个汉字，口语化、自然、有场景推进感。",
    "3. 根据用户上一句灵活回应，不要机械重复样例。用户如果说“说来听听”“怎么弄”“继续”，你要顺势推进当前骗局话术，而不是变成普通客服。",
    "4. 必须持续扮演当前骗局中的模拟对象，可以表现催促、利诱、情感施压、阻止核实等训练话术，但必须保持安全边界。",
    "5. 不得索要真实银行卡号、身份证号、密码、真实验证码、住址等敏感信息；如剧情需要，只能说“模拟验证码”“模拟账户”。",
    "6. 不提供现实可执行的诈骗操作步骤，不给真实链接、真实账号或真实联系方式；如需推进剧情，只能使用“模拟链接”“模拟APP”“模拟账户”。",
    "7. 禁止输出普通客服式寒暄，例如“有什么我能帮助您的吗”；你的任务是推进训练剧情。",
  ].join("\n")
}

function buildMessages(scenario: Scenario, messages: Message[], userText: string) {
  const recent = messages
    .filter((message) => message.sender !== "system")
    .slice(-10)
    .map((message) => ({
      role: message.sender === "user" ? "user" : "assistant",
      content: message.text,
    }))

  return [
    { role: "system", content: buildSystemPrompt(scenario) },
    ...recent,
    { role: "user", content: userText },
  ]
}

async function askOllama(scenario: Scenario, messages: Message[], userText: string): Promise<string> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 45_000)

  try {
    const response = await fetch(`${OLLAMA_URL.replace(/\/$/, "")}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        stream: false,
        messages: buildMessages(scenario, messages, userText),
        options: {
          temperature: 0.78,
          top_p: 0.9,
          repeat_penalty: 1.12,
        },
      }),
      signal: controller.signal,
    })

    if (!response.ok) throw new Error(`Ollama returned ${response.status}`)

    const data = await response.json()
    const content = sanitizeAiText(data?.message?.content ?? "")
    if (!content) throw new Error("Ollama returned empty content")
    return content
  } finally {
    clearTimeout(timeout)
  }
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

  try {
    const line = await askOllama(scenario, messages, userText.trim())
    const trigger = pickTrigger(scenario, line, turnIndex)
    return NextResponse.json({
      line,
      trigger,
      riskDelta: Math.min(4.5, 1.8 + turnIndex * 0.35),
      coach: buildCoach(trigger),
      source: "ollama",
    })
  } catch (error) {
    const fallback = fallbackTurn(scenario, turnIndex)
    return NextResponse.json({
      ...fallback,
      source: "fallback",
      error: error instanceof Error ? error.message : "Unknown Ollama error",
    })
  }
}