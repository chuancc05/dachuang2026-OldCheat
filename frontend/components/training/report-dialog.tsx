"use client"

import { useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import type { Scenario } from "@/lib/scenarios"
import { cn } from "@/lib/utils"
import { audioCueLabels, type AudioCue } from "@/lib/voice/scenario-audio"
import {
  X,
  ShieldCheck,
  TriangleAlert,
  Award,
  Target,
  CheckCircle2,
  ListChecks,
  MessageSquareText,
  Sparkles,
  TrendingUp,
  UsersRound,
  Volume2,
} from "lucide-react"

export type ReportEvaluation = "safe" | "risky" | "mixed" | "neutral"

export interface ReportEvent {
  turn: number
  scammerText: string
  userText: string
  trigger?: string
  riskDelta: number
  evaluation: ReportEvaluation
  reason: string
  aiSource: "deepseek" | "ollama" | "fallback" | "idle"
  audioCues?: AudioCue[]
}

interface AiReport {
  summary: string
  improvements: string[]
  elderAdvice: string
  nextTraining: string
  familyBriefing: string
  source: "deepseek" | "fallback"
}

interface ReportDialogProps {
  open: boolean
  onClose: () => void
  scenarios: Scenario[]
  scenario: Scenario | null
  defenseScore: number
  goodMoves: number
  riskyMoves: number
  peakRisk: number
  triggers: string[]
  turns: number
  events: ReportEvent[]
}

const FALLBACK_TIPS = [
  "接到自称公检法、客服、银行、亲友的要求，先暂停，不在对话中做决定。",
  "任何人索要验证码、银行卡、密码或屏幕共享，都应立即拒绝。",
  "遇到转账、垫付、保证金、解冻费、领奖费，一律先联系家人或官方渠道核实。",
  "重大用钱决定先和子女或家人商量，尽量当面或视频确认。",
]

export function ReportDialog({
  open,
  onClose,
  scenarios,
  scenario,
  defenseScore,
  goodMoves,
  riskyMoves,
  peakRisk,
  triggers,
  turns,
  events,
}: ReportDialogProps) {
  const [aiReport, setAiReport] = useState<AiReport | null>(null)
  const [aiLoading, setAiLoading] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose()
    }
    if (open) document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [open, onClose])

  const requestKey = useMemo(() => {
    if (!scenario || !open || events.length === 0) return ""
    return JSON.stringify({ scenario: scenario.code, variant: scenario.variant?.id, turns, defenseScore, goodMoves, riskyMoves, peakRisk, events })
  }, [defenseScore, events, goodMoves, open, peakRisk, riskyMoves, scenario, turns])

  useEffect(() => {
    if (!open || !scenario || events.length === 0) {
      setAiReport(null)
      setAiLoading(false)
      setAiError(null)
      return
    }

    let cancelled = false
    setAiLoading(true)
    setAiError(null)

    fetch("/api/training-report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scenario: {
          code: scenario.code,
          title: scenario.title,
          difficulty: scenario.difficulty,
          channel: scenario.channel,
          tagline: scenario.tagline,
          method: scenario.method,
          variant: scenario.variant ? {
            id: scenario.variant.id,
            title: scenario.variant.title,
            persona: scenario.variant.persona,
            premise: scenario.variant.premise,
            objective: scenario.variant.objective,
            identityContract: scenario.variant.identityContract,
          } : undefined,
        },
        metrics: {
          defenseScore,
          goodMoves,
          riskyMoves,
          peakRisk,
          turns,
          triggers,
        },
        events,
      }),
    })
      .then(async (response) => {
        if (!response.ok) {
          const data = await response.json().catch(() => null)
          throw new Error(data?.error ?? `AI report returned ${response.status}`)
        }
        return response.json() as Promise<AiReport>
      })
      .then((data) => {
        if (!cancelled) setAiReport(data)
      })
      .catch((error) => {
        if (!cancelled) {
          setAiReport(null)
          setAiError(error instanceof Error ? error.message : "AI 总结生成失败")
        }
      })
      .finally(() => {
        if (!cancelled) setAiLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [requestKey, open, scenario, events, defenseScore, goodMoves, riskyMoves, peakRisk, turns, triggers])

  if (!open || !scenario) return null

  const grade =
    defenseScore >= 80
      ? "A · 反诈高手"
      : defenseScore >= 60
        ? "B · 警觉良好"
        : defenseScore >= 40
          ? "C · 仍需练习"
          : "D · 高危易受骗"
  const gradeTone =
    defenseScore >= 60 ? "text-safe" : defenseScore >= 40 ? "text-warning-foreground" : "text-danger"

  const triggerStats = countBy(triggers)
  const audioCueStats = countBy(events.flatMap((event) => audioCueLabels(event.audioCues ?? [])))
  const riskyEvents = events.filter((event) => event.evaluation === "risky" || event.evaluation === "mixed")
  const safeEvents = events.filter((event) => event.evaluation === "safe")
  const peakEvent = findPeakEvent(events)
  const nextScenario = recommendScenario(scenario, scenarios, riskyEvents, triggerStats, defenseScore)
  const familyBriefing = aiReport?.familyBriefing || buildFamilyBriefing({
    scenario,
    defenseScore,
    goodMoves,
    riskyMoves,
    riskyEvents,
    peakEvent,
  })
  const timeline = buildTimeline(events)
  const scoreReasons = buildScoreReasons(defenseScore, goodMoves, riskyMoves, peakRisk, turns)
  const tips = buildTips(scenario, triggerStats, riskyEvents)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-foreground/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 max-h-[92dvh] w-full max-w-3xl overflow-y-auto rounded-3xl border bg-card p-4 shadow-xl sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="font-mono text-xs text-muted-foreground">训练报告 · {scenario.code}</p>
            <h2 className="text-xl font-bold leading-tight sm:text-2xl">{scenario.title} · 训练复盘</h2>
            {scenario.variant && (
              <div className="mt-2 rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-900">
                <p className="font-semibold">本轮故事：{scenario.variant.title} · {scenario.variant.persona}</p>
                <p className="mt-1 text-blue-800/80">{scenario.variant.premise}</p>
              </div>
            )}
            <p className="mt-1 text-sm text-muted-foreground">规则指标负责评分，DeepSeek 负责生成自然语言总结。</p>
          </div>
          <button
            onClick={onClose}
            aria-label="关闭"
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted"
          >
            <X className="size-5" />
          </button>
        </div>

        <div className="mt-5 grid gap-3 lg:grid-cols-[1.2fr_1fr]">
          <div className="flex items-center justify-between rounded-2xl border bg-muted/40 p-4">
            <div className="flex items-center gap-3">
              <div className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <Award className="size-6" />
              </div>
              <div>
                <div className="text-sm text-muted-foreground">综合防御评级</div>
                <div className={cn("text-lg font-black", gradeTone)}>{grade}</div>
              </div>
            </div>
            <div className="text-right">
              <div className="text-4xl font-black tabular-nums text-primary">{defenseScore}</div>
              <div className="text-xs text-muted-foreground">防御分 / 100</div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Metric icon={<Target className="size-4" />} label="对话轮次" value={turns} />
            <Metric icon={<ShieldCheck className="size-4" />} label="正确应对" value={goodMoves} tone="safe" />
            <Metric icon={<TriangleAlert className="size-4" />} label="风险动作" value={riskyMoves} tone="danger" />
            <Metric icon={<TriangleAlert className="size-4" />} label="峰值风险" value={peakRisk.toFixed(1)} tone="warning" />
          </div>
        </div>

        <SectionTitle icon={<Sparkles className="size-4" />} title="DeepSeek 复盘总结" />
        <AiReportCard report={aiReport} loading={aiLoading} error={aiError} hasEvents={events.length > 0} />

        <SectionTitle icon={<ShieldCheck className="size-4" />} title="本场关键复盘" />
        <div className="grid gap-3 md:grid-cols-2">
          <ResponseReviewCard
            title="你做对了什么"
            emptyText="本场还没有记录到明确的防御回复。下次可以练习说“我先核实一下”。"
            events={safeEvents}
            tone="safe"
          />
          <ResponseReviewCard
            title="需要避免的回复"
            emptyText="本场没有记录到明显的风险回复，继续保持先核实、再决定的习惯。"
            events={riskyEvents}
            tone="danger"
          />
        </div>

        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <PeakRiskCard event={peakEvent} />
          <NextScenarioCard recommendation={nextScenario} />
        </div>

        <SectionTitle icon={<ListChecks className="size-4" />} title="评分解释" />
        <div className="grid gap-2 sm:grid-cols-2">
          {scoreReasons.map((reason) => (
            <div key={reason} className="rounded-xl border bg-muted/30 px-3 py-2 text-sm text-foreground/85">
              {reason}
            </div>
          ))}
        </div>

        <SectionTitle icon={<TriangleAlert className="size-4" />} title="本场被利用的心理弱点" />
        {triggerStats.length === 0 ? (
          <p className="rounded-xl border bg-muted/30 p-3 text-sm text-muted-foreground">
            本场没有记录到明显心理弱点触发。
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {triggerStats.map(({ name, count }) => (
              <span key={name} className="rounded-full bg-danger/10 px-3 py-1.5 text-xs font-medium text-danger">
                {name} × {count}
              </span>
            ))}
          </div>
        )}

        {audioCueStats.length > 0 && (
          <>
            <SectionTitle icon={<Volume2 className="size-4" />} title="关键声音线索" />
            <div className="rounded-2xl border bg-muted/30 p-3">
              <div className="flex flex-wrap gap-2">
                {audioCueStats.map(({ name, count }) => (
                  <span key={name} className="rounded-full bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary">
                    {name} × {count}
                  </span>
                ))}
              </div>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                以上为模拟训练线索，不保存或回放原始音频。
              </p>
            </div>
          </>
        )}

        <SectionTitle icon={<MessageSquareText className="size-4" />} title="关键轮次复盘" />
        {timeline.length === 0 ? (
          <p className="rounded-xl border bg-muted/30 p-3 text-sm text-muted-foreground">
            暂无用户回复记录。完成至少一轮应对后，报告会显示逐轮复盘。
          </p>
        ) : (
          <div className="space-y-3">
            {timeline.map((event) => (
              <TimelineCard key={`${event.turn}-${event.userText}`} event={event} />
            ))}
          </div>
        )}

        <SectionTitle icon={<CheckCircle2 className="size-4" />} title="个性化训练建议" />
        <ul className="space-y-2">
          {tips.map((tip) => (
            <li key={tip} className="flex items-start gap-2 text-sm text-foreground/90">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-safe" />
              <span className="text-pretty">{tip}</span>
            </li>
          ))}
        </ul>

        <SectionTitle icon={<UsersRound className="size-4" />} title="给子女 / 社区工作人员的简短说明" />
        <div className="rounded-2xl border bg-muted/30 p-4 text-sm leading-relaxed text-foreground/90">
          {familyBriefing}
        </div>

        <div className="mt-6 flex gap-2">
          <Button className="flex-1" onClick={onClose}>
            完成
          </Button>
        </div>
      </div>
    </div>
  )
}

function AiReportCard({
  report,
  loading,
  error,
  hasEvents,
}: {
  report: AiReport | null
  loading: boolean
  error: string | null
  hasEvents: boolean
}) {
  if (!hasEvents) {
    return <p className="rounded-xl border bg-muted/30 p-3 text-sm text-muted-foreground">完成至少一轮用户回复后生成 AI 总结。</p>
  }
  if (loading) {
    return <p className="rounded-xl border bg-primary/5 p-3 text-sm text-primary">DeepSeek 正在生成本场总结...</p>
  }
  if (error) {
    return <p className="rounded-xl border bg-muted/30 p-3 text-sm text-muted-foreground">AI 总结暂不可用：{error}。下方规则报告仍可正常使用。</p>
  }
  if (!report) return null

  return (
    <div className="rounded-2xl border border-primary/30 bg-primary/5 p-4">
      <p className="text-sm leading-relaxed text-foreground/90">{report.summary}</p>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <div>
          <div className="mb-1 text-xs font-semibold text-muted-foreground">需要改进</div>
          <ul className="space-y-1 text-sm text-foreground/90">
            {report.improvements.map((item) => <li key={item}>· {item}</li>)}
          </ul>
        </div>
        <div>
          <div className="mb-1 text-xs font-semibold text-muted-foreground">下一次训练</div>
          <p className="text-sm text-foreground/90">{report.nextTraining}</p>
        </div>
      </div>
      <div className="mt-3 rounded-xl bg-card/70 p-3 text-sm leading-relaxed text-foreground/90">
        {report.elderAdvice}
      </div>
    </div>
  )
}

function ResponseReviewCard({
  title,
  emptyText,
  events,
  tone,
}: {
  title: string
  emptyText: string
  events: ReportEvent[]
  tone: "safe" | "danger"
}) {
  const color = tone === "safe" ? "border-safe/30 bg-safe/5 text-safe" : "border-danger/30 bg-danger/5 text-danger"
  const displayed = events.slice(0, 3)

  return (
    <section className={cn("rounded-2xl border p-4", color)}>
      <h3 className="font-semibold">{title}</h3>
      {displayed.length === 0 ? (
        <p className="mt-2 text-sm leading-relaxed text-foreground/80">{emptyText}</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {displayed.map((event) => (
            <li key={`${title}-${event.turn}-${event.userText}`} className="rounded-xl bg-card/70 p-3 text-sm text-foreground/90">
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="font-mono text-xs text-muted-foreground">第 {event.turn} 轮</span>
                {event.trigger && <span className="truncate text-xs text-muted-foreground">{event.trigger}</span>}
              </div>
              <p className="line-clamp-2">“{event.userText}”</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{event.reason}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function PeakRiskCard({ event }: { event: ReportEvent | null }) {
  return (
    <section className="rounded-2xl border border-warning/40 bg-warning/10 p-4">
      <div className="flex items-center gap-2 text-warning-foreground">
        <TrendingUp className="size-4" />
        <h3 className="font-semibold">风险最高的一轮</h3>
      </div>
      {!event ? (
        <p className="mt-2 text-sm leading-relaxed text-foreground/80">训练记录还不够，完成至少一轮回复后会定位最高风险点。</p>
      ) : (
        <div className="mt-3 rounded-xl bg-card/75 p-3 text-sm text-foreground/90">
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-xs text-muted-foreground">第 {event.turn} 轮</span>
            <span className="text-xs font-semibold text-warning-foreground">风险变化 +{event.riskDelta.toFixed(1)}</span>
          </div>
          <p className="mt-2 line-clamp-2">诈骗方：{event.scammerText}</p>
          <p className="mt-1 line-clamp-2">你的回答：{event.userText}</p>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{event.reason}</p>
        </div>
      )}
    </section>
  )
}

function NextScenarioCard({ recommendation }: { recommendation: { scenario: Scenario; reason: string } }) {
  return (
    <section className="rounded-2xl border border-primary/30 bg-primary/5 p-4">
      <div className="flex items-center gap-2 text-primary">
        <Target className="size-4" />
        <h3 className="font-semibold">下一场建议练什么</h3>
      </div>
      <div className="mt-3 rounded-xl bg-card/75 p-3">
        <p className="font-semibold text-foreground">{recommendation.scenario.title}</p>
        <p className="mt-1 text-sm text-muted-foreground">{recommendation.scenario.persona}</p>
        <p className="mt-2 text-sm leading-relaxed text-foreground/85">{recommendation.reason}</p>
      </div>
    </section>
  )
}

function SectionTitle({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="mb-2 mt-5 flex items-center gap-2">
      <span className="text-primary">{icon}</span>
      <h3 className="text-sm font-semibold">{title}</h3>
    </div>
  )
}

function TimelineCard({ event }: { event: ReportEvent }) {
  const tone = {
    safe: "border-safe/30 bg-safe/5 text-safe",
    risky: "border-danger/30 bg-danger/5 text-danger",
    mixed: "border-warning/40 bg-warning/10 text-warning-foreground",
    neutral: "border-border bg-muted/30 text-muted-foreground",
  }[event.evaluation]

  const label = {
    safe: "正确应对",
    risky: "风险动作",
    mixed: "有防御也有风险",
    neutral: "中性回复",
  }[event.evaluation]
  const audioLabels = audioCueLabels(event.audioCues ?? [])

  return (
    <div className="rounded-2xl border bg-card p-4">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs text-muted-foreground">第 {event.turn} 轮</span>
        <span className={cn("rounded-full border px-2 py-0.5 text-xs font-medium", tone)}>{label}</span>
        {event.trigger ? (
          <span className="rounded-full bg-danger/10 px-2 py-0.5 text-xs font-medium text-danger">
            {event.trigger}
          </span>
        ) : null}
      </div>
      <div className="space-y-2 text-sm">
        <p>
          <span className="font-semibold text-muted-foreground">诈骗话术：</span>
          <span className="text-foreground/90">{event.scammerText}</span>
        </p>
        <p>
          <span className="font-semibold text-muted-foreground">用户回复：</span>
          <span className="text-foreground/90">{event.userText}</span>
        </p>
        {audioLabels.length > 0 && (
          <p>
            <span className="font-semibold text-muted-foreground">本轮声音线索：</span>
            <span className="text-foreground/90">{audioLabels.join("、")}</span>
          </p>
        )}
        <p className="text-muted-foreground">{event.reason}</p>
      </div>
    </div>
  )
}

function Metric({
  icon,
  label,
  value,
  tone = "primary",
}: {
  icon: React.ReactNode
  label: string
  value: number | string
  tone?: "primary" | "safe" | "danger" | "warning"
}) {
  const color = {
    primary: "text-primary",
    safe: "text-safe",
    danger: "text-danger",
    warning: "text-warning-foreground",
  }[tone]
  return (
    <div className="rounded-xl border bg-card p-2.5 text-center">
      <div className={cn("mb-1 flex justify-center", color)}>{icon}</div>
      <div className={cn("text-lg font-black tabular-nums", color)}>{value}</div>
      <div className="text-[10px] text-muted-foreground">{label}</div>
    </div>
  )
}

function countBy(values: string[]) {
  const counts = new Map<string, number>()
  values.filter(Boolean).forEach((value) => counts.set(value, (counts.get(value) ?? 0) + 1))
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
}

function buildTimeline(events: ReportEvent[]) {
  const risky = events.filter((event) => event.evaluation === "risky" || event.evaluation === "mixed")
  const safe = events.filter((event) => event.evaluation === "safe")
  const neutral = events.filter((event) => event.evaluation === "neutral")
  return [...risky.slice(0, 4), ...safe.slice(0, 3), ...neutral.slice(0, 2)].sort((a, b) => a.turn - b.turn)
}

function findPeakEvent(events: ReportEvent[]) {
  const [firstEvent, ...remainingEvents] = events
  if (!firstEvent) return null
  return remainingEvents.reduce((peak, event) => {
    const peakWeight = riskWeight(peak)
    const eventWeight = riskWeight(event)
    return eventWeight > peakWeight ? event : peak
  }, firstEvent)
}

function riskWeight(event: ReportEvent) {
  const evaluationWeight = event.evaluation === "risky" ? 3 : event.evaluation === "mixed" ? 2 : event.evaluation === "neutral" ? 1 : 0
  return Math.max(0, event.riskDelta) * 10 + evaluationWeight
}

function recommendScenario(
  currentScenario: Scenario,
  scenarios: Scenario[],
  riskyEvents: ReportEvent[],
  triggerStats: { name: string; count: number }[],
  defenseScore: number,
) {
  const retryCurrent = riskyEvents.length >= 2 || defenseScore < 55
  if (retryCurrent) {
    return {
      scenario: currentScenario,
      reason: "本场出现了多次风险应对，建议先把这一类骗局练熟，重点练习“先核实、拒绝转账、再挂断”。",
    }
  }

  const triggerText = triggerStats.map((item) => item.name).join(" ")
  const targetCodes =
    /亲情|熟人|紧急|绑架/.test(triggerText)
      ? ["SC-06", "SC-12", "SC-14"]
      : /健康|保健|专家/.test(triggerText)
        ? ["SC-04", "SC-11"]
        : /验证码|账户|征信|权威|公安|银行/.test(triggerText)
          ? ["SC-01", "SC-13", "SC-10"]
          : currentScenario.channel === "phone"
            ? ["SC-02", "SC-03", "SC-08"]
            : ["SC-01", "SC-13", "SC-04"]

  const next =
    targetCodes
      .map((code) => scenarios.find((scenario) => scenario.code === code && scenario.id !== currentScenario.id))
      .find((scenario): scenario is Scenario => Boolean(scenario)) ??
    scenarios.find((scenario) => scenario.id !== currentScenario.id && scenario.difficulty === "高") ??
    currentScenario

  return {
    scenario: next,
    reason: next.id === currentScenario.id
      ? "你已经完成了本场基础应对，可以再练一次，把安全回应说得更坚定、更完整。"
      : `本场表现已具备基础防御意识，下一步建议练习“${next.title}”，扩展对不同诈骗话术的识别能力。`,
  }
}

function buildFamilyBriefing({
  scenario,
  defenseScore,
  goodMoves,
  riskyMoves,
  riskyEvents,
  peakEvent,
}: {
  scenario: Scenario
  defenseScore: number
  goodMoves: number
  riskyMoves: number
  riskyEvents: ReportEvent[]
  peakEvent: ReportEvent | null
}) {
  const performance = defenseScore >= 80 ? "防骗意识较稳" : defenseScore >= 60 ? "已具备基础防骗意识" : "仍需要重点陪练"
  const riskNote = riskyEvents.length > 0
    ? `出现 ${riskyMoves} 次风险倾向，${peakEvent?.trigger ? `尤其要留意“${peakEvent.trigger}”话术。` : "需要继续练习先停下再核实。"}`
    : "未记录明显风险回复，可以继续巩固核实身份和拒绝转账的习惯。"
  return `本次“${scenario.title}”训练中，长辈${performance}，完成了 ${goodMoves} 次有效防御回应。${riskNote} 建议子女或社区工作人员用真实生活中的简短案例陪练，并提醒老人遇到用钱决定先挂断、再通过原号码核实。`
}

function buildScoreReasons(
  defenseScore: number,
  goodMoves: number,
  riskyMoves: number,
  peakRisk: number,
  turns: number,
) {
  const reasons = [
    `本场完成 ${turns} 轮对话，峰值风险达到 ${peakRisk.toFixed(1)} / 10。`,
    `识别到 ${goodMoves} 次有效防御动作，包含核实身份、拒绝转账、求助家人等行为。`,
  ]
  if (riskyMoves > 0) reasons.push(`出现 ${riskyMoves} 次风险动作，主要影响综合防御评分。`)
  if (peakRisk >= 7) reasons.push("峰值风险较高，说明诈骗话术已经进入强施压或转账诱导阶段。")
  if (defenseScore < 40) reasons.push("本场评分偏低，建议重点练习“先挂断、再核实、不转账”的固定流程。")
  if (defenseScore >= 80) reasons.push("本场能较稳定地识别风险，建议继续练习更复杂的复合型骗局。")
  return reasons
}

function buildTips(scenario: Scenario, triggerStats: { name: string; count: number }[], riskyEvents: ReportEvent[]) {
  const tips = [...FALLBACK_TIPS]
  const topTrigger = triggerStats[0]?.name
  if (topTrigger) tips.unshift(`本场最常被利用的弱点是“${topTrigger}”，下次遇到类似话术时先停顿 10 秒再回应。`)
  if (riskyEvents.length > 0) tips.unshift("报告中标为“风险动作”的轮次建议反复查看，重点练习把回复改成核实身份或直接拒绝。")
  if (scenario.channel === "wechat") tips.push("微信或短信场景中，不点击陌生链接，不下载陌生 App，不接受屏幕共享。")
  if (scenario.channel === "phone") tips.push("电话场景中，不在通话中做决定，先挂断，再用官方号码或家人渠道核实。")
  return [...new Set(tips)].slice(0, 6)
}
