"use client"

import { useEffect } from "react"
import { Button } from "@/components/ui/button"
import type { Scenario } from "@/lib/scenarios"
import { cn } from "@/lib/utils"
import {
  X,
  ShieldCheck,
  TriangleAlert,
  Award,
  Target,
  CheckCircle2,
  ListChecks,
  MessageSquareText,
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
}

interface ReportDialogProps {
  open: boolean
  onClose: () => void
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
  scenario,
  defenseScore,
  goodMoves,
  riskyMoves,
  peakRisk,
  triggers,
  turns,
  events,
}: ReportDialogProps) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose()
    }
    if (open) document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [open, onClose])

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
  const riskyEvents = events.filter((event) => event.evaluation === "risky" || event.evaluation === "mixed")
  const timeline = buildTimeline(events)
  const scoreReasons = buildScoreReasons(defenseScore, goodMoves, riskyMoves, peakRisk, turns)
  const tips = buildTips(scenario, triggerStats, riskyEvents)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-foreground/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-3xl border bg-card p-6 shadow-xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="font-mono text-xs text-muted-foreground">训练报告 · {scenario.code}</p>
            <h2 className="text-2xl font-bold leading-tight">{scenario.title} · 训练复盘</h2>
            <p className="mt-1 text-sm text-muted-foreground">基于本场对话、风险动作和心理弱点触发记录生成。</p>
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

        <div className="mt-6 flex gap-2">
          <Button className="flex-1" onClick={onClose}>
            完成
          </Button>
        </div>
      </div>
    </div>
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
