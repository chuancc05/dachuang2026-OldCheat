"use client"

import { type Difficulty, type Scenario } from "@/lib/scenarios"
import { Phone, MessageCircle, ShieldCheck, Play } from "lucide-react"
import { cn } from "@/lib/utils"

interface ScenarioRailProps {
  scenarios: Scenario[]
  activeId: string | null
  onSelect: (s: Scenario) => void
  started: boolean
}

const diffStyle: Record<Difficulty, string> = {
  低: "bg-safe/15 text-safe",
  中: "bg-warning/20 text-warning-foreground",
  高: "bg-danger/15 text-danger",
}

export function ScenarioRail({ scenarios, activeId, onSelect, started }: ScenarioRailProps) {
  return (
    <aside className="flex h-full flex-col gap-4">
      <div className="px-1">
        <h2 className="text-lg font-bold">选择训练场景</h2>
        <p className="mt-1 text-sm text-muted-foreground text-pretty">
          挑一种常见骗局，进入沉浸式模拟。点击卡片即可切换。
        </p>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto pr-1">
        {scenarios.map((s) => {
          const active = s.id === activeId
          return (
            <button
              key={s.id}
              onClick={() => onSelect(s)}
              className={cn(
                "group w-full rounded-2xl border p-4 text-left transition-all",
                active
                  ? "border-primary bg-primary/5 shadow-sm ring-1 ring-primary/30"
                  : "border-border bg-card hover:border-primary/40 hover:bg-accent/40",
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      "flex size-9 items-center justify-center rounded-xl text-sm font-bold",
                      active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
                    )}
                  >
                    {s.avatar}
                  </span>
                  <div>
                    <div className="flex items-center gap-1.5 font-mono text-xs text-muted-foreground">
                      {s.code}
                      {s.channel === "phone" ? (
                        <Phone className="size-3" />
                      ) : (
                        <MessageCircle className="size-3" />
                      )}
                    </div>
                    <div className="font-semibold leading-tight">{s.title}</div>
                  </div>
                </div>
                <span
                  className={cn(
                    "shrink-0 rounded-full px-2 py-0.5 text-xs font-medium",
                    diffStyle[s.difficulty],
                  )}
                >
                  {s.difficulty}难度
                </span>
              </div>
              <p className="mt-2.5 text-sm leading-relaxed text-muted-foreground text-pretty">
                {s.tagline}
              </p>
              {active && (
                <div className="mt-3 flex items-center gap-1.5 text-sm font-medium text-primary">
                  {started ? (
                    <>
                      <ShieldCheck className="size-4" /> 训练进行中
                    </>
                  ) : (
                    <>
                      <Play className="size-4" /> 已选中，点击右侧开始
                    </>
                  )}
                </div>
              )}
            </button>
          )
        })}
      </div>
    </aside>
  )
}
