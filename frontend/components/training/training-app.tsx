"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { ScenarioRail } from "@/components/training/scenario-rail"
import { SimulationStage, type Message } from "@/components/training/simulation-stage"
import { CoachPanel } from "@/components/training/coach-panel"
import { ReplyBar } from "@/components/training/reply-bar"
import { ReportDialog, type ReportEvent, type ReportEvaluation } from "@/components/training/report-dialog"
import { Button } from "@/components/ui/button"
import { evaluateReply, type Scenario } from "@/lib/scenarios"
import { ShieldHalf, Play, RotateCcw, HelpCircle } from "lucide-react"

const DEFAULT_ADVICE = "保持核实身份、拒绝验证码、拒绝转账的习惯。遇到催促和恐吓，先停下，再核实。"

const QUICK_REPLIES = [
  "这听起来像诈骗，我要挂断了",
  "我要先联系我的子女核实",
  "我不会转账，也不会给验证码",
]

type AiSource = "idle" | "deepseek" | "ollama" | "fallback"

const AI_SOURCE_LABELS: Record<AiSource, string> = {
  idle: "当前模型：待启动",
  deepseek: "当前模型：DeepSeek API",
  ollama: "当前模型：本地 Ollama",
  fallback: "当前模型：场景库兜底",
}

function parseAiSource(value: unknown): AiSource {
  return value === "deepseek" || value === "ollama" || value === "fallback" ? value : "fallback"
}

function summarizeUserMove(hitDefensive: boolean, hitRisky: boolean): { evaluation: ReportEvaluation; reason: string } {
  if (hitDefensive && hitRisky) {
    return {
      evaluation: "mixed",
      reason: "用户回复中同时出现了防御动作和风险意图。建议把回复进一步收敛为核实身份、拒绝转账或直接挂断。",
    }
  }
  if (hitDefensive) {
    return {
      evaluation: "safe",
      reason: "用户表现出防御意识，例如核实身份、拒绝转账、拒绝验证码或寻求家人/官方渠道确认。",
    }
  }
  if (hitRisky) {
    return {
      evaluation: "risky",
      reason: "用户回复中出现转账、提供信息、继续操作或相信对方的风险倾向，需要立即停下并核实。",
    }
  }
  return {
    evaluation: "neutral",
    reason: "用户回复暂未触发明显风险或防御关键词，建议继续观察对方是否引导转账、验证码或隔离核实。",
  }
}

function lastScammerText(messages: Message[], scenario: Scenario, turnIndex: number): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.sender === "scammer") return messages[index].text
  }
  return scenario.script[Math.max(0, turnIndex - 1)]?.line ?? "本轮开始前暂无诈骗话术记录。"
}

let idc = 0
const nextId = () => `m-${idc++}`

export function TrainingApp({ scenarios }: { scenarios: Scenario[] }) {
  const [scenario, setScenario] = useState<Scenario | null>(scenarios[0] ?? null)
  const [started, setStarted] = useState(false)
  const [finished, setFinished] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [typing, setTyping] = useState(false)
  const [scammerShown, setScammerShown] = useState(0)

  const [risk, setRisk] = useState(0)
  const [peakRisk, setPeakRisk] = useState(0)
  const [triggers, setTriggers] = useState<string[]>([])
  const [advice, setAdvice] = useState(DEFAULT_ADVICE)
  const [goodMoves, setGoodMoves] = useState(0)
  const [riskyMoves, setRiskyMoves] = useState(0)
  const [duration, setDuration] = useState(0)
  const [reportOpen, setReportOpen] = useState(false)
  const [coreCompleteNotified, setCoreCompleteNotified] = useState(false)
  const [lastAiSource, setLastAiSource] = useState<AiSource>("idle")
  const [reportEvents, setReportEvents] = useState<ReportEvent[]>([])

  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!started || finished) return
    const timer = setInterval(() => setDuration((value) => value + 1), 1000)
    return () => clearInterval(timer)
  }, [started, finished])

  useEffect(
    () => () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
    },
    [],
  )

  const bumpRisk = useCallback((delta: number) => {
    setRisk((current) => {
      const next = Math.max(0, Math.min(10, current + delta))
      setPeakRisk((peak) => Math.max(peak, next))
      return next
    })
  }, [])

  const resetSession = useCallback((nextScenario: Scenario | null) => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    setScenario(nextScenario)
    setStarted(false)
    setFinished(false)
    setMessages([])
    setTyping(false)
    setScammerShown(0)
    setRisk(0)
    setPeakRisk(0)
    setTriggers([])
    setAdvice(DEFAULT_ADVICE)
    setGoodMoves(0)
    setRiskyMoves(0)
    setDuration(0)
    setReportOpen(false)
    setCoreCompleteNotified(false)
    setLastAiSource("idle")
    setReportEvents([])
  }, [])

  const revealScammerLine = useCallback(
    (index: number, activeScenario: Scenario) => {
      const turn = activeScenario.script[index]
      if (!turn) return

      setTyping(true)
      timeoutRef.current = setTimeout(() => {
        setTyping(false)
        setMessages((items) => [
          ...items,
          { id: nextId(), sender: "scammer", text: turn.line, trigger: turn.trigger },
        ])
        setScammerShown(index + 1)
        bumpRisk(turn.riskDelta)
        setAdvice(turn.coach)
        setLastAiSource("fallback")
        if (turn.trigger) setTriggers((items) => [...items, turn.trigger as string])
      }, 900)
    },
    [bumpRisk],
  )

  const handleSelect = useCallback(
    (nextScenario: Scenario) => {
      resetSession(nextScenario)
    },
    [resetSession],
  )

  const handleStart = useCallback(() => {
    if (!scenario) return
    setStarted(true)
    revealScammerLine(0, scenario)
  }, [scenario, revealScammerLine])

  const defenseScore = Math.round(
    Math.max(0, Math.min(100, 100 - peakRisk * 6 - riskyMoves * 12 + goodMoves * 6)),
  )
  const totalTurns = scenario ? scenario.script.length : 0
  const progress = totalTurns ? Math.min(scammerShown, totalTurns) : 0
  const inputDisabled = !started || finished || typing

  const handleSend = useCallback(
    async (text: string) => {
      if (!scenario || !started || finished || typing) return

      const userMessage: Message = { id: nextId(), sender: "user", text }
      const history = messages
      const turnIndex = scammerShown
      const scammerText = lastScammerText(history, scenario, turnIndex)
      setMessages((items) => [...items, userMessage])

      const { delta, hitDefensive, hitRisky } = evaluateReply(text)
      const userMove = summarizeUserMove(hitDefensive, hitRisky)
      if (delta !== 0) bumpRisk(delta)
      if (hitDefensive) setGoodMoves((value) => value + 1)
      if (hitRisky) setRiskyMoves((value) => value + 1)

      setTyping(true)
      try {
        const response = await fetch("/api/training-chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            scenario,
            messages: history,
            userText: text,
            turnIndex,
          }),
        })

        if (!response.ok) throw new Error(`AI route returned ${response.status}`)
        const turn = await response.json()
        const source = parseAiSource(turn.source)
        const trigger = typeof turn.trigger === "string" ? turn.trigger : undefined
        const riskDelta = typeof turn.riskDelta === "number" ? turn.riskDelta : 2
        const coach = typeof turn.coach === "string" ? turn.coach : DEFAULT_ADVICE
        const fallbackLine = scenario.script[turnIndex % Math.max(scenario.script.length, 1)]?.line
        const line = typeof turn.line === "string" && turn.line.trim()
          ? turn.line.trim()
          : fallbackLine ?? "我这边再给您说明一下情况，您先别急着挂断。"

        setLastAiSource(source)
        setMessages((items) => [
          ...items,
          { id: nextId(), sender: "scammer", text: line, trigger },
        ])
        setReportEvents((items) => [
          ...items,
          {
            turn: turnIndex,
            scammerText,
            userText: text,
            trigger,
            riskDelta,
            evaluation: userMove.evaluation,
            reason: userMove.reason,
            aiSource: source,
          },
        ])
        setScammerShown((count) => count + 1)
        bumpRisk(riskDelta)
        setAdvice(coach)
        if (trigger) setTriggers((items) => [...items, trigger])

        if (totalTurns > 0 && turnIndex + 1 >= totalTurns && !coreCompleteNotified) {
          setCoreCompleteNotified(true)
          setMessages((items) => [
            ...items,
            {
              id: nextId(),
              sender: "system",
              text: "已达到建议训练轮次。你可以查看报告，也可以继续对话，练习更复杂的应对。",
            },
          ])
          setAdvice("建议轮次已完成，但训练不会自动中断。你可以继续练习，或查看报告复盘高风险话术与有效应对。")
        }
      } catch (error) {
        const fallback = scenario.script[turnIndex % Math.max(scenario.script.length, 1)]
        const trigger = fallback?.trigger
        setLastAiSource("fallback")
        setMessages((items) => [
          ...items,
          {
            id: nextId(),
            sender: "scammer",
            text: fallback?.line ?? "我这边再给您说明一下情况，您先别急着挂断。",
            trigger,
          },
          { id: nextId(), sender: "system", text: "AI 暂时未响应，本轮已使用场景库话术兜底。" },
        ])
        setReportEvents((items) => [
          ...items,
          {
            turn: turnIndex,
            scammerText,
            userText: text,
            trigger,
            riskDelta: fallback?.riskDelta ?? 2,
            evaluation: userMove.evaluation,
            reason: userMove.reason,
            aiSource: "fallback",
          },
        ])
        setScammerShown((count) => count + 1)
        bumpRisk(fallback?.riskDelta ?? 2)
        setAdvice(fallback?.coach ?? DEFAULT_ADVICE)
        if (trigger) setTriggers((items) => [...items, trigger])
        console.warn("Failed to generate AI turn", error)
      } finally {
        setTyping(false)
      }
    },
    [scenario, started, finished, typing, messages, scammerShown, bumpRisk, totalTurns, coreCompleteNotified],
  )

  const handleHelp = useCallback(() => {
    if (!scenario || !started) return
    setMessages((items) => [
      ...items,
      { id: nextId(), sender: "system", text: "你选择向子女求助并拨打 96110 核实，这是正确的做法。" },
    ])
    bumpRisk(-4)
    setGoodMoves((value) => value + 1)
    setAdvice("非常好。遇到可疑情况，第一时间联系家人、拨打 96110 反诈专线核实，是最有效的自我保护。")
  }, [scenario, started, bumpRisk])

  const handleHangup = useCallback(() => {
    if (!scenario || !started || finished) return
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    setTyping(false)
    setMessages((items) => [
      ...items,
      { id: nextId(), sender: "system", text: "你果断挂断/退出，成功脱离了这场骗局。" },
    ])
    bumpRisk(-6)
    setGoodMoves((value) => value + 1)
    setFinished(true)
    setAdvice("挂断就是最好的反诈。挂断、不回拨陌生号码、和家人确认，你已经赢了这一局。")
  }, [scenario, started, finished, bumpRisk])

  return (
    <div className="flex h-dvh flex-col bg-background">
      <header className="flex items-center justify-between gap-4 border-b bg-card px-4 py-3 sm:px-6">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <ShieldHalf className="size-6" />
          </div>
          <div>
            <h1 className="text-base font-bold leading-tight sm:text-lg">银龄反诈沉浸式心理免疫训练舱</h1>
            <p className="hidden text-xs text-muted-foreground sm:block">沉浸对话 · 心理风险识别 · 训练报告</p>
          </div>
        </div>

        <div className="hidden flex-1 items-center gap-3 px-6 md:flex">
          <span className="whitespace-nowrap text-sm font-medium text-muted-foreground">训练进度</span>
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all duration-500"
              style={{ width: `${totalTurns ? (progress / totalTurns) * 100 : 0}%` }}
            />
          </div>
          <span className="font-mono text-sm text-muted-foreground">
            {progress}/{totalTurns || 0}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <div className="hidden rounded-full border bg-muted/60 px-3 py-1 text-xs font-medium text-muted-foreground md:block">
            {AI_SOURCE_LABELS[lastAiSource]}
          </div>
          {started && (
            <Button variant="outline" size="sm" onClick={() => resetSession(scenario)}>
              <RotateCcw className="size-4" />
              <span className="hidden sm:inline">重新开始</span>
            </Button>
          )}
          <Button variant="ghost" size="sm" className="text-muted-foreground">
            <HelpCircle className="size-4" />
            <span className="hidden sm:inline">帮助</span>
          </Button>
        </div>
      </header>

      <div className="grid flex-1 grid-cols-1 gap-4 overflow-hidden p-4 lg:grid-cols-[300px_minmax(0,1fr)_320px]">
        <div className="hidden min-h-0 lg:block">
          <ScenarioRail scenarios={scenarios} activeId={scenario?.id ?? null} onSelect={handleSelect} started={started} />
        </div>

        <main className="flex min-h-0 flex-col overflow-hidden rounded-3xl border bg-muted/30 shadow-sm">
          <div className="min-h-0 flex-1 overflow-hidden">
            <SimulationStage
              scenario={scenario}
              messages={messages}
              started={started}
              finished={finished}
              typing={typing}
              duration={duration}
            />
          </div>

          {scenario && !started ? (
            <div className="border-t bg-card p-4">
              <Button size="lg" className="w-full text-base" onClick={handleStart}>
                <Play className="size-5" />
                开始训练 · {scenario.title}
              </Button>
            </div>
          ) : scenario ? (
            <ReplyBar
              disabled={inputDisabled}
              finished={finished}
              onSend={handleSend}
              onHelp={handleHelp}
              onHangup={handleHangup}
              quickReplies={QUICK_REPLIES}
            />
          ) : null}
        </main>

        <div className="hidden min-h-0 lg:block">
          <CoachPanel
            risk={risk}
            triggers={triggers}
            advice={advice}
            defenseScore={defenseScore}
            goodMoves={goodMoves}
            riskyMoves={riskyMoves}
            finished={finished}
            started={started}
            onReport={() => setReportOpen(true)}
          />
        </div>
      </div>

      <ReportDialog
        open={reportOpen}
        onClose={() => setReportOpen(false)}
        scenario={scenario}
        defenseScore={defenseScore}
        goodMoves={goodMoves}
        riskyMoves={riskyMoves}
        peakRisk={peakRisk}
        triggers={triggers}
        turns={scammerShown}
        events={reportEvents}
      />
    </div>
  )
}
