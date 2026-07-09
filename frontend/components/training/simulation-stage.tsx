"use client"

import { useEffect, useRef } from "react"
import type { Scenario } from "@/lib/scenarios"
import { splitSpeechCue } from "@/lib/speech-text"
import { cn } from "@/lib/utils"
import { Phone, MessageCircle, ShieldAlert, PhoneOff, Sparkles } from "lucide-react"

export type Sender = "scammer" | "user" | "system"
export interface Message {
  id: string
  sender: Sender
  text: string
  trigger?: string
}

interface SimulationStageProps {
  scenario: Scenario | null
  messages: Message[]
  started: boolean
  finished: boolean
  typing: boolean
  duration: number
}

function formatDuration(s: number) {
  const m = Math.floor(s / 60)
  const sec = s % 60
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
}

export function SimulationStage({
  scenario,
  messages,
  started,
  finished,
  typing,
  duration,
}: SimulationStageProps) {
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" })
  }, [messages, typing])

  if (!scenario) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-10 text-center">
        <div className="flex size-16 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <Sparkles className="size-8" />
        </div>
        <div className="max-w-sm">
          <h3 className="text-xl font-bold text-balance">进入沉浸式反诈训练舱</h3>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground text-pretty">
            从左侧选择一个骗局场景，你将与“诈骗话术模拟对象”真实对话。
            右侧教练会实时分析你的心理风险，并给出应对建议。
          </p>
        </div>
      </div>
    )
  }

  const isPhone = scenario.channel === "phone"

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* call / chat header */}
      <div
        className={cn(
          "flex items-center gap-3 border-b px-5 py-3.5",
          isPhone ? "bg-foreground text-background" : "bg-card",
        )}
      >
        <div className="relative">
          {started && !finished && isPhone && (
            <span className="absolute inset-0 rounded-full bg-safe/60 animate-ping-ring" />
          )}
          <span
            className={cn(
              "relative flex size-11 items-center justify-center rounded-full text-lg font-bold",
              isPhone ? "bg-background/15 text-background" : "bg-primary/10 text-primary",
            )}
          >
            {scenario.avatar}
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-semibold">{scenario.persona}</span>
            <span
              className={cn(
                "flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium",
                isPhone ? "bg-background/15" : "bg-muted text-muted-foreground",
              )}
            >
              {isPhone ? <Phone className="size-2.5" /> : <MessageCircle className="size-2.5" />}
              {isPhone ? "模拟来电" : "模拟聊天"}
            </span>
          </div>
          <div className={cn("truncate text-xs", isPhone ? "text-background/70" : "text-muted-foreground")}>
            {scenario.source}
          </div>
        </div>
        {started && (
          <div
            className={cn(
              "flex items-center gap-2 rounded-full px-3 py-1.5 font-mono text-sm",
              isPhone ? "bg-background/15" : "bg-muted text-muted-foreground",
            )}
          >
            {isPhone && !finished && (
              <span className="size-1.5 animate-pulse rounded-full bg-safe" />
            )}
            {finished ? "已结束" : formatDuration(duration)}
          </div>
        )}
      </div>

      {/* scam method banner */}
      <div className="flex items-start gap-2 border-b border-danger/20 bg-danger/5 px-5 py-2.5 text-xs">
        <ShieldAlert className="mt-0.5 size-4 shrink-0 text-danger" />
        <p className="text-muted-foreground">
          <span className="font-semibold text-danger">套路提示：</span>
          {scenario.method}
        </p>
      </div>

      {/* messages */}
      <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto px-4 py-5 sm:px-6">
        {messages.map((m) => {
          if (m.sender === "system") {
            return (
              <div key={m.id} className="flex justify-center">
                <span className="rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">
                  {m.text}
                </span>
              </div>
            )
          }
          const mine = m.sender === "user"
          const displayText = m.sender === "scammer" ? splitSpeechCue(m.text).speechText : m.text
          return (
            <div key={m.id} className={cn("flex flex-col gap-1", mine ? "items-end" : "items-start")}>
              <div
                className={cn(
                  "max-w-[82%] rounded-2xl px-4 py-3 text-[15px] leading-relaxed shadow-sm",
                  mine
                    ? "rounded-br-md bg-primary text-primary-foreground"
                    : "rounded-bl-md bg-card text-card-foreground ring-1 ring-border",
                )}
              >
                {displayText}
              </div>
              {m.trigger && !mine && (
                <span className="flex items-center gap-1 text-[11px] font-medium text-danger">
                  <ShieldAlert className="size-3" /> 触发弱点：{m.trigger}
                </span>
              )}
            </div>
          )
        })}

        {typing && (
          <div className="flex items-start">
            <div className="flex items-center gap-1 rounded-2xl rounded-bl-md bg-card px-4 py-3.5 shadow-sm ring-1 ring-border">
              <span className="size-2 animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.3s]" />
              <span className="size-2 animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.15s]" />
              <span className="size-2 animate-bounce rounded-full bg-muted-foreground" />
            </div>
          </div>
        )}

        {finished && (
          <div className="flex flex-col items-center gap-2 pt-4">
            <div className="flex items-center gap-2 rounded-full bg-safe/15 px-4 py-2 text-sm font-medium text-safe">
              <PhoneOff className="size-4" /> 本场景对话已结束
            </div>
            <p className="text-xs text-muted-foreground">可在右侧查看训练报告，或从左侧切换新场景。</p>
          </div>
        )}
      </div>
    </div>
  )
}
