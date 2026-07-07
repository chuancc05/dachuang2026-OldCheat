"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { ScenarioRail } from "@/components/training/scenario-rail"
import { SimulationStage, type Message } from "@/components/training/simulation-stage"
import { CoachPanel } from "@/components/training/coach-panel"
import { ReplyBar } from "@/components/training/reply-bar"
import { ReportDialog } from "@/components/training/report-dialog"
import { Button } from "@/components/ui/button"
import { evaluateReply, type Scenario } from "@/lib/scenarios"
import { ShieldHalf, Play, RotateCcw, HelpCircle } from "lucide-react"

const DEFAULT_ADVICE = "保持“核实身份、拒绝验证码、拒绝转账”的习惯。遇到催促和恐吓，先停下、再核实。"

const QUICK_REPLIES = [
  "这听起来像诈骗，我要挂断了",
  "我要先联系我的子女核实",
  "我不会转账，也不会给验证码",
]

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

  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // session timer
  useEffect(() => {
    if (!started || finished) return
    const t = setInterval(() => setDuration((d) => d + 1), 1000)
    return () => clearInterval(t)
  }, [started, finished])

  useEffect(
    () => () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
    },
    [],
  )

  const bumpRisk = useCallback((delta: number) => {
    setRisk((r) => {
      const next = Math.max(0, Math.min(10, r + delta))
      setPeakRisk((p) => Math.max(p, next))
      return next
    })
  }, [])

  const resetSession = useCallback((s: Scenario | null) => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    setScenario(s)
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
    setCoreCompleteNotified(false)
  }, [])

  const revealScammerLine = useCallback(
    (index: number, s: Scenario) => {
      const turn = s.script[index]
      if (!turn) return
      setTyping(true)
      timeoutRef.current = setTimeout(() => {
        setTyping(false)
        setMessages((m) => [
          ...m,
          { id: nextId(), sender: "scammer", text: turn.line, trigger: turn.trigger },
        ])
        setScammerShown(index + 1)
        bumpRisk(turn.riskDelta)
        setAdvice(turn.coach)
        if (turn.trigger) setTriggers((t) => [...t, turn.trigger as string])
      }, 900)
    },
    [bumpRisk],
  )

  const handleSelect = useCallback(
    (s: Scenario) => {
      resetSession(s)
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
      setMessages((m) => [...m, userMessage])

      const { delta, hitDefensive, hitRisky } = evaluateReply(text)
      if (delta !== 0) bumpRisk(delta)
      if (hitDefensive) setGoodMoves((g) => g + 1)
      if (hitRisky) setRiskyMoves((r) => r + 1)

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
        const trigger = typeof turn.trigger === "string" ? turn.trigger : undefined
        const riskDelta = typeof turn.riskDelta === "number" ? turn.riskDelta : 2
        const coach = typeof turn.coach === "string" ? turn.coach : DEFAULT_ADVICE
        const line = typeof turn.line === "string" && turn.line.trim()
          ? turn.line.trim()
          : scenario.script[turnIndex % Math.max(scenario.script.length, 1)]?.line ?? "我这边再给您说明一下情况，您先别急着挂断。"

        setMessages((m) => [
          ...m,
          { id: nextId(), sender: "scammer", text: line, trigger },
        ])
        setScammerShown((count) => count + 1)
        bumpRisk(riskDelta)
        setAdvice(coach)
        if (trigger) setTriggers((t) => [...t, trigger])

        if (turnIndex + 1 >= totalTurns && !coreCompleteNotified) {
          setCoreCompleteNotified(true)
          setMessages((m) => [
            ...m,
            { id: nextId(), sender: "system", text: "已达到建议训练轮次。你可以查看报告，也可以继续对话练习更复杂的应对。" },
          ])
          setAdvice("建议轮次已完成，但训练不会自动中断。你可以继续练习，或查看报告复盘高风险话术与有效应对。")
        }
      } catch (error) {
        const fallback = scenario.script[turnIndex % Math.max(scenario.script.length, 1)]
        const trigger = fallback?.trigger
        setMessages((m) => [
          ...m,
          {
            id: nextId(),
            sender: "scammer",
            text: fallback?.line ?? "我这边再给您说明一下情况，您先别急着挂断。",
            trigger,
          },
          { id: nextId(), sender: "system", text: "AI 暂时未响应，本轮已使用场景库话术兜底。" },
        ])
        setScammerShown((count) => count + 1)
        bumpRisk(fallback?.riskDelta ?? 2)
        setAdvice(fallback?.coach ?? DEFAULT_ADVICE)
        if (trigger) setTriggers((t) => [...t, trigger])
        console.warn("Failed to generate AI turn", error)
      } finally {
        setTyping(false)
      }
    },
    [scenario, started, finished, typing, messages, scammerShown, bumpRisk, totalTurns, coreCompleteNotified],
  )

  const handleHelp = useCallback(() => {
    if (!scenario || !started) return
    setMessages((m) => [
      ...m,
      { id: nextId(), sender: "system", text: "你选择向子女求助并拨打 96110 核实 —— 正确的做法！" },
    ])
    bumpRisk(-4)
    setGoodMoves((g) => g + 1)
    setAdvice("非常好！遇到可疑情况，第一时间联系家人、拨打 96110 反诈专线核实，是最有效的自我保护。")
  }, [scenario, started, bumpRisk])

  const handleHangup = useCallback(() => {
    if (!scenario || !started || finished) return
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    setTyping(false)
    setMessages((m) => [
      ...m,
      { id: nextId(), sender: "system", text: "你果断挂断/退出，成功脱离了这场骗局。" },
    ])
    bumpRisk(-6)
    setGoodMoves((g) => g + 1)
    setFinished(true)
    setAdvice("挂断就是最好的反诈。挂断、不回拨陌生号、和家人确认，你已经赢了这一局。")
  }, [scenario, started, finished, bumpRisk])


  return (
    <div className="flex h-dvh flex-col bg-background">
      {/* top bar */}
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

      {/* body */}
      <div className="grid flex-1 grid-cols-1 gap-4 overflow-hidden p-4 lg:grid-cols-[300px_minmax(0,1fr)_320px]">
        {/* left rail */}
        <div className="hidden min-h-0 lg:block">
          <ScenarioRail scenarios={scenarios} activeId={scenario?.id ?? null} onSelect={handleSelect} started={started} />
        </div>

        {/* center stage */}
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

        {/* right coach */}
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
      />
    </div>
  )
}
