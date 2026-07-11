"use client"

import { RiskGauge } from "./risk-gauge"
import { riskLevel } from "@/lib/scenarios"
import { cn } from "@/lib/utils"
import { Activity, Lightbulb, FileText, ShieldCheck, TriangleAlert, Award } from "lucide-react"
import { Button } from "@/components/ui/button"
import { RagDebugPanel, type RagDebugInfo } from "./rag-debug-panel"
import { RuntimeStatusPanel } from "./runtime-status-panel"

interface CoachPanelProps {
  risk: number
  triggers: string[]
  advice: string
  defenseScore: number
  goodMoves: number
  riskyMoves: number
  finished: boolean
  started: boolean
  onReport: () => void
  ragDebugEnabled?: boolean
  ragDebug?: RagDebugInfo | null
  aiSource?: "idle" | "deepseek" | "ollama" | "fallback"
}

export function CoachPanel({
  risk,
  triggers,
  advice,
  defenseScore,
  goodMoves,
  riskyMoves,
  finished,
  started,
  onReport,
  ragDebugEnabled = false,
  ragDebug = null,
  aiSource = "idle",
}: CoachPanelProps) {
  const { tone } = riskLevel(risk)
  const toneRing = {
    safe: "ring-safe/30 bg-safe/5",
    warning: "ring-warning/40 bg-warning/10",
    danger: "ring-danger/40 bg-danger/5",
  }[tone]

  return (
    <aside className="flex h-full flex-col gap-4 overflow-y-auto pr-1">
      <div className="flex items-center gap-2 px-1">
        <Activity className="size-5 text-primary" />
        <h2 className="text-lg font-bold">实时教练面板</h2>
      </div>

      {/* gauge */}
      <div className={cn("rounded-2xl border p-4 ring-1 transition-colors", toneRing)}>
        <RiskGauge score={risk} />
      </div>

      {/* defense stats */}
      <div className="grid grid-cols-3 gap-2">
        <StatCard label="防御分" value={defenseScore} icon={<Award className="size-4" />} accent="primary" />
        <StatCard label="正确应对" value={goodMoves} icon={<ShieldCheck className="size-4" />} accent="safe" />
        <StatCard label="风险动作" value={riskyMoves} icon={<TriangleAlert className="size-4" />} accent="danger" />
      </div>

      {/* triggers */}
      <div className="rounded-2xl border bg-card p-4">
        <div className="mb-2 flex items-center gap-2">
          <TriangleAlert className="size-4 text-danger" />
          <h3 className="text-sm font-semibold">已激活的心理弱点</h3>
        </div>
        {triggers.length === 0 ? (
          <p className="text-sm text-muted-foreground">当前未检测到明显心理弱点被激活。</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {triggers.map((t, i) => (
              <span
                key={`${t}-${i}`}
                className="rounded-full bg-danger/10 px-2.5 py-1 text-xs font-medium text-danger"
              >
                {t}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* advice */}
      <div className="rounded-2xl border border-primary/30 bg-primary/5 p-4">
        <div className="mb-2 flex items-center gap-2">
          <Lightbulb className="size-4 text-primary" />
          <h3 className="text-sm font-semibold text-primary">即时应对建议</h3>
        </div>
        <p className="text-sm leading-relaxed text-foreground/90 text-pretty">{advice}</p>
      </div>

      <RuntimeStatusPanel aiSource={aiSource} ragDebug={ragDebug} />

      {ragDebugEnabled && <RagDebugPanel info={ragDebug} />}

      {/* report */}
      <div className="mt-auto rounded-2xl border bg-card p-4">
        <div className="mb-1 flex items-center gap-2">
          <FileText className="size-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">训练报告</h3>
        </div>
        <p className="mb-3 text-xs text-muted-foreground text-pretty">
          {finished
            ? "本场训练已完成，可生成心理风险识别报告。"
            : started
              ? "完成本场对话后即可生成报告。"
              : "开始训练后将记录你的每一步应对。"}
        </p>
        <Button onClick={onReport} disabled={!started} className="w-full" variant={finished ? "default" : "secondary"}>
          <FileText className="size-4" />
          查看训练报告
        </Button>
      </div>
    </aside>
  )
}

function StatCard({
  label,
  value,
  icon,
  accent,
}: {
  label: string
  value: number
  icon: React.ReactNode
  accent: "primary" | "safe" | "danger"
}) {
  const color = {
    primary: "text-primary",
    safe: "text-safe",
    danger: "text-danger",
  }[accent]
  return (
    <div className="rounded-xl border bg-card p-2.5 text-center">
      <div className={cn("mb-1 flex justify-center", color)}>{icon}</div>
      <div className={cn("text-xl font-black tabular-nums", color)}>{value}</div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
    </div>
  )
}
