"use client"

import { useEffect } from "react"
import { Button } from "@/components/ui/button"
import type { Scenario } from "@/lib/scenarios"
import { cn } from "@/lib/utils"
import { X, ShieldCheck, TriangleAlert, Award, Target, CheckCircle2 } from "lucide-react"

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
}

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
    defenseScore >= 80 ? "A · 反诈高手" : defenseScore >= 60 ? "B · 警觉良好" : defenseScore >= 40 ? "C · 仍需练习" : "D · 高危易受骗"
  const gradeTone =
    defenseScore >= 60 ? "text-safe" : defenseScore >= 40 ? "text-warning-foreground" : "text-danger"

  const tips = [
    "接到自称公检法/客服的电话，先挂断，用官方号码回拨核实。",
    "任何人索要短信验证码，都不要读出——验证码等于你的钱。",
    "遇到“转账、垫付、缴费才能解冻/领奖”的说法，一律是诈骗。",
    "重大用钱决定，务必先和子女或家人商量、当面或视频确认。",
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-foreground/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-3xl border bg-card p-6 shadow-xl">
        <div className="flex items-start justify-between">
          <div>
            <p className="font-mono text-xs text-muted-foreground">训练报告 · {scenario.code}</p>
            <h2 className="text-xl font-bold">{scenario.title} · 心理风险识别</h2>
          </div>
          <button
            onClick={onClose}
            aria-label="关闭"
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted"
          >
            <X className="size-5" />
          </button>
        </div>

        {/* grade */}
        <div className="mt-4 flex items-center justify-between rounded-2xl border bg-muted/40 p-4">
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
            <div className="text-3xl font-black tabular-nums text-primary">{defenseScore}</div>
            <div className="text-xs text-muted-foreground">防御分 / 100</div>
          </div>
        </div>

        {/* metrics */}
        <div className="mt-3 grid grid-cols-4 gap-2">
          <Metric icon={<Target className="size-4" />} label="对话轮次" value={turns} />
          <Metric icon={<ShieldCheck className="size-4" />} label="正确应对" value={goodMoves} tone="safe" />
          <Metric icon={<TriangleAlert className="size-4" />} label="风险动作" value={riskyMoves} tone="danger" />
          <Metric icon={<TriangleAlert className="size-4" />} label="峰值风险" value={`${peakRisk.toFixed(1)}`} tone="warning" />
        </div>

        {/* triggers */}
        <div className="mt-4">
          <h3 className="mb-2 text-sm font-semibold">本场被利用的心理弱点</h3>
          {triggers.length === 0 ? (
            <p className="text-sm text-muted-foreground">很好，未被明显利用任何心理弱点。</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {triggers.map((t, i) => (
                <span key={`${t}-${i}`} className="rounded-full bg-danger/10 px-2.5 py-1 text-xs font-medium text-danger">
                  {t}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* tips */}
        <div className="mt-4">
          <h3 className="mb-2 text-sm font-semibold">给长辈的反诈要点</h3>
          <ul className="space-y-2">
            {tips.map((t) => (
              <li key={t} className="flex items-start gap-2 text-sm text-foreground/90">
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-safe" />
                <span className="text-pretty">{t}</span>
              </li>
            ))}
          </ul>
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
