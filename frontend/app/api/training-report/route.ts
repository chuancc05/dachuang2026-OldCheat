import { NextRequest, NextResponse } from "next/server"

interface ReportEvent {
  turn: number
  scammerText: string
  userText: string
  trigger?: string
  riskDelta: number
  evaluation: "safe" | "risky" | "mixed" | "neutral"
  reason: string
  aiSource: "deepseek" | "ollama" | "fallback" | "idle"
  audioCues?: { labels?: string[] }[]
}

interface ReportRequest {
  scenario: {
    code?: string
    title?: string
    difficulty?: string
    channel?: string
    tagline?: string
    method?: string
    variant?: {
      id?: string
      title?: string
      persona?: string
      premise?: string
      objective?: string
    }
  }
  metrics: {
    defenseScore: number
    goodMoves: number
    riskyMoves: number
    peakRisk: number
    turns: number
    triggers: string[]
  }
  events: ReportEvent[]
}

interface AiReport {
  summary: string
  improvements: string[]
  elderAdvice: string
  nextTraining: string
  familyBriefing: string
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

function deepSeekApiKey(): string {
  return envValue("DEEPSEEK_API_KEY") || envValueBase64("DEEPSEEK_API_KEY_B64")
}

function deepSeekBaseUrl(): string {
  return envValue("DEEPSEEK_BASE_URL") || "https://api.deepseek.com"
}

function deepSeekReportModel(): string {
  return envValue("DEEPSEEK_MODEL_REPORT") || envValue("DEEPSEEK_MODEL_DIALOG") || "deepseek-v4-flash"
}

function compactEvents(events: ReportEvent[]) {
  return events.slice(0, 16).map((event) => ({
    turn: event.turn,
    scammerText: event.scammerText.slice(0, 140),
    userText: event.userText.slice(0, 120),
    trigger: event.trigger,
    evaluation: event.evaluation,
    reason: event.reason,
    audioCues: (event.audioCues ?? []).flatMap((cue) => cue.labels ?? []).filter(Boolean),
  }))
}

function buildPrompt(body: ReportRequest) {
  return [
    "你是一个面向老年人反诈骗训练系统的训练教练。",
    "请根据本场训练数据，生成简洁、温和、可执行的中文训练总结。",
    "不要编造不存在的对话，不要改变评分，不要输出诈骗操作教程。",
    "请严格输出 JSON，不要 Markdown，不要额外解释。JSON 格式如下：",
    '{"summary":"本场总体表现总结，80-140字","improvements":["改进点1","改进点2"],"elderAdvice":"给长辈的一段口语化建议，60-120字","nextTraining":"下一次训练建议，40-80字","familyBriefing":"给子女或社区工作人员的简短说明，60-100字，包含本场风险表现和陪练建议"}',
    "\n场景信息：",
    JSON.stringify(body.scenario, null, 2),
    "\n训练指标：",
    JSON.stringify(body.metrics, null, 2),
    "\n关键对话记录：",
    JSON.stringify(compactEvents(body.events), null, 2),
  ].join("\n")
}

function extractJson(text: string): AiReport {
  const trimmed = text.trim()
  const start = trimmed.indexOf("{")
  const end = trimmed.lastIndexOf("}")
  if (start < 0 || end < start) throw new Error("DeepSeek report is not JSON")
  const parsed = JSON.parse(trimmed.slice(start, end + 1)) as Partial<AiReport>
  return {
    summary: String(parsed.summary ?? "").trim(),
    improvements: Array.isArray(parsed.improvements) ? parsed.improvements.map(String).filter(Boolean).slice(0, 2) : [],
    elderAdvice: String(parsed.elderAdvice ?? "").trim(),
    nextTraining: String(parsed.nextTraining ?? "").trim(),
    familyBriefing: String(parsed.familyBriefing ?? "").trim(),
  }
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

async function askDeepSeekReport(body: ReportRequest): Promise<AiReport> {
  const apiKey = deepSeekApiKey()
  if (!apiKey) throw new Error("DeepSeek API key is not configured")

  return withTimeout(60_000, async (signal) => {
    const response = await fetch(`${deepSeekBaseUrl().replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: deepSeekReportModel(),
        messages: [
          { role: "system", content: "你只输出合法 JSON。" },
          { role: "user", content: buildPrompt(body) },
        ],
        thinking: { type: "disabled" },
        response_format: { type: "json_object" },
        stream: false,
        temperature: 0.45,
        max_tokens: 900,
      }),
      signal,
    })

    if (!response.ok) throw new Error(`DeepSeek returned ${response.status}`)
    const data = await response.json()
    const content = data?.choices?.[0]?.message?.content ?? ""
    const report = extractJson(content)
    if (!report.summary || report.improvements.length === 0 || !report.elderAdvice || !report.nextTraining) {
      throw new Error("DeepSeek report JSON is incomplete")
    }
    return report
  })
}

export async function POST(request: NextRequest) {
  let body: ReportRequest
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  if (!body?.scenario || !body?.metrics || !Array.isArray(body.events)) {
    return NextResponse.json({ error: "Missing report fields" }, { status: 400 })
  }

  try {
    const report = await askDeepSeekReport(body)
    return NextResponse.json({ ...report, source: "deepseek" })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown report generation error", source: "fallback" },
      { status: 502 },
    )
  }
}
