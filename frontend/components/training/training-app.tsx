"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { ScenarioRail } from "@/components/training/scenario-rail"
import { SimulationStage, type Message } from "@/components/training/simulation-stage"
import { CoachPanel } from "@/components/training/coach-panel"
import { ReplyBar } from "@/components/training/reply-bar"
import { ReportDialog, type ReportEvent, type ReportEvaluation } from "@/components/training/report-dialog"
import {
  VoiceCallPanel,
  type VoiceCallStatus,
  type VoiceProvider,
  type VoiceTranscript,
} from "@/components/training/voice-call-panel"
import { Button } from "@/components/ui/button"
import { evaluateReply, type Scenario } from "@/lib/scenarios"
import { ShieldHalf, Play, RotateCcw, HelpCircle, PhoneCall } from "lucide-react"

const DEFAULT_ADVICE = "保持核实身份、拒绝验证码、拒绝转账的习惯。遇到催促和恐吓，先停下，再核实。"

const QUICK_REPLIES = [
  "这听起来像诈骗，我要挂断了",
  "我要先联系我的子女核实",
  "我不会转账，也不会给验证码",
]

type AiSource = "idle" | "deepseek" | "ollama" | "fallback"

type BrowserSpeechRecognitionEvent = {
  resultIndex: number
  results: {
    length: number
    [index: number]: {
      isFinal?: boolean
      [index: number]: {
        transcript: string
        confidence?: number
      }
    }
  }
}

type BrowserSpeechRecognition = {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  onresult: ((event: BrowserSpeechRecognitionEvent) => void) | null
  onerror: ((event: { error?: string }) => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
  abort: () => void
}

type BrowserSpeechRecognitionConstructor = new () => BrowserSpeechRecognition

const AI_SOURCE_LABELS: Record<AiSource, string> = {
  idle: "当前模型：待启动",
  deepseek: "当前模型：DeepSeek API",
  ollama: "当前模型：本地 Ollama",
  fallback: "当前模型：场景库兜底",
}

function parseAiSource(value: unknown): AiSource {
  return value === "deepseek" || value === "ollama" || value === "fallback" ? value : "fallback"
}

function getSpeechRecognitionConstructor(): BrowserSpeechRecognitionConstructor | null {
  if (typeof window === "undefined") return null
  const browserWindow = window as typeof window & {
    SpeechRecognition?: BrowserSpeechRecognitionConstructor
    webkitSpeechRecognition?: BrowserSpeechRecognitionConstructor
  }
  return browserWindow.SpeechRecognition ?? browserWindow.webkitSpeechRecognition ?? null
}

function formatDuration(s: number) {
  const m = Math.floor(s / 60)
  const sec = s % 60
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
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
  const [voicePanelOpen, setVoicePanelOpen] = useState(false)
  const [voiceStatus, setVoiceStatus] = useState<VoiceCallStatus>("idle")
  const [voiceProvider, setVoiceProvider] = useState<VoiceProvider>("unavailable")
  const [voiceTranscript, setVoiceTranscript] = useState<VoiceTranscript | null>(null)
  const [voiceError, setVoiceError] = useState("")

  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null)
  const voiceLoopRef = useRef(false)
  const finishedRef = useRef(false)
  const transcriptRef = useRef("")
  const transcriptConfidenceRef = useRef<number | undefined>(undefined)
  const lastSpokenLineRef = useRef("")
  const handleSendRef = useRef<(text: string) => Promise<string | null>>(async () => null)
  const startVoiceListeningRef = useRef<() => void>(() => {})

  const stopBrowserVoice = useCallback(() => {
    recognitionRef.current?.abort()
    recognitionRef.current = null
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel()
    }
  }, [])

  useEffect(() => {
    if (!started || finished) return
    const timer = setInterval(() => setDuration((value) => value + 1), 1000)
    return () => clearInterval(timer)
  }, [started, finished])

  useEffect(() => {
    finishedRef.current = finished
    if (finished) {
      voiceLoopRef.current = false
      stopBrowserVoice()
      setVoiceStatus("finished")
    }
  }, [finished, stopBrowserVoice])

  useEffect(
    () => () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
      voiceLoopRef.current = false
      stopBrowserVoice()
    },
    [stopBrowserVoice],
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
    voiceLoopRef.current = false
    stopBrowserVoice()
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
    setVoicePanelOpen(false)
    setVoiceStatus("idle")
    setVoiceProvider("unavailable")
    setVoiceTranscript(null)
    setVoiceError("")
    lastSpokenLineRef.current = ""
  }, [stopBrowserVoice])

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
  const voiceActive =
    voicePanelOpen && !["idle", "paused", "finished", "error"].includes(voiceStatus)
  const voiceDurationLabel = started ? formatDuration(duration) : "00:00"

  const handleSend = useCallback(
    async (text: string): Promise<string | null> => {
      if (!scenario || !started || finished || typing) return null

      const userMessage: Message = { id: nextId(), sender: "user", text }
      const history = messages
      const turnIndex = scammerShown
      const scammerText = lastScammerText(history, scenario, turnIndex)
      let nextScammerLine: string | null = null
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
        nextScammerLine = line

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
        const fallbackLine = fallback?.line ?? "我这边再给您说明一下情况，您先别急着挂断。"
        nextScammerLine = fallbackLine
        setLastAiSource("fallback")
        setMessages((items) => [
          ...items,
          {
            id: nextId(),
            sender: "scammer",
            text: fallbackLine,
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
      return nextScammerLine
    },
    [scenario, started, finished, typing, messages, scammerShown, bumpRisk, totalTurns, coreCompleteNotified],
  )

  useEffect(() => {
    handleSendRef.current = handleSend
  }, [handleSend])

  const speakScammerLine = useCallback(
    (line: string) => {
      const text = line.trim()
      if (!text) return

      recognitionRef.current?.abort()
      recognitionRef.current = null
      lastSpokenLineRef.current = text
      setVoiceError("")
      setVoiceStatus("speaking-scammer")

      if (typeof window === "undefined" || !("speechSynthesis" in window)) {
        voiceLoopRef.current = false
        setVoiceProvider("unavailable")
        setVoiceStatus("paused")
        setVoiceError("当前浏览器不能自动朗读，请暂时使用文字训练。")
        return
      }

      window.speechSynthesis.cancel()
      const utterance = new SpeechSynthesisUtterance(text)
      utterance.lang = "zh-CN"
      utterance.rate = 0.92
      utterance.pitch = 1
      utterance.onend = () => {
        if (!voiceLoopRef.current || finishedRef.current) return
        window.setTimeout(() => startVoiceListeningRef.current(), 350)
      }
      utterance.onerror = () => {
        voiceLoopRef.current = false
        setVoiceStatus("paused")
        setVoiceError("浏览器朗读失败。你可以点“再说一遍”，或改用文字输入。")
      }
      window.speechSynthesis.speak(utterance)
    },
    [],
  )

  const startVoiceListening = useCallback(() => {
    const Recognition = getSpeechRecognitionConstructor()
    if (!Recognition) {
      voiceLoopRef.current = false
      setVoiceProvider("unavailable")
      setVoiceStatus("error")
      setVoiceError("当前浏览器不支持语音识别，请使用 Edge 或 Chrome，或先改用文字输入。")
      return
    }

    recognitionRef.current?.abort()
    transcriptRef.current = ""
    transcriptConfidenceRef.current = undefined
    setVoiceError("")
    setVoiceTranscript(null)
    setVoiceProvider("browser")

    const recognition = new Recognition()
    recognition.lang = "zh-CN"
    recognition.continuous = false
    recognition.interimResults = false
    recognition.maxAlternatives = 1
    recognitionRef.current = recognition

    recognition.onresult = (event) => {
      let text = ""
      let confidence: number | undefined
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index]?.[0]
        if (result?.transcript) {
          text += result.transcript
          confidence = result.confidence
        }
      }
      transcriptRef.current = text.trim()
      transcriptConfidenceRef.current = confidence
      if (transcriptRef.current) {
        setVoiceTranscript({
          text: transcriptRef.current,
          confidence,
          provider: "browser",
        })
      }
    }

    recognition.onerror = (event) => {
      if (recognitionRef.current !== recognition) return
      recognitionRef.current = null
      voiceLoopRef.current = false
      setVoiceStatus("error")
      setVoiceError(event.error === "not-allowed" ? "麦克风权限被拒绝，请允许麦克风后再试。" : "没听清，请再说一遍。")
    }

    recognition.onend = () => {
      if (recognitionRef.current !== recognition) return
      recognitionRef.current = null
      const text = transcriptRef.current.trim()

      if (!voiceLoopRef.current || finishedRef.current) return
      if (!text) {
        voiceLoopRef.current = false
        setVoiceStatus("error")
        setVoiceError("没听清，请再说一遍。")
        return
      }

      setVoiceStatus("thinking")
      void (async () => {
        const nextLine = await handleSendRef.current(text)
        if (!voiceLoopRef.current || finishedRef.current) return
        if (nextLine) {
          speakScammerLine(nextLine)
        } else {
          voiceLoopRef.current = false
          setVoiceStatus("paused")
        }
      })()
    }

    try {
      recognition.start()
      setVoiceStatus("listening-user")
    } catch (error) {
      recognitionRef.current = null
      voiceLoopRef.current = false
      setVoiceStatus("error")
      setVoiceError("语音识别启动失败，请稍后再试，或使用文字输入。")
      console.warn("Failed to start speech recognition", error)
    }
  }, [speakScammerLine])

  useEffect(() => {
    startVoiceListeningRef.current = startVoiceListening
  }, [startVoiceListening])

  const handlePauseVoice = useCallback(() => {
    voiceLoopRef.current = false
    stopBrowserVoice()
    setVoiceStatus("paused")
    setVoiceError("")
  }, [stopBrowserVoice])

  const handleReplayVoice = useCallback(() => {
    if (!scenario || !started || finished) return
    const line = lastSpokenLineRef.current || lastScammerText(messages, scenario, scammerShown)
    if (!line.trim()) return
    setVoicePanelOpen(true)
    voiceLoopRef.current = true
    speakScammerLine(line)
  }, [scenario, started, finished, messages, scammerShown, speakScammerLine])

  const handleStartVoice = useCallback(async () => {
    if (!scenario) return

    setVoicePanelOpen(true)
    setVoiceProvider("browser")
    setVoiceError("")
    setVoiceTranscript(null)

    const Recognition = getSpeechRecognitionConstructor()
    if (!Recognition) {
      voiceLoopRef.current = false
      setVoiceProvider("unavailable")
      setVoiceStatus("error")
      setVoiceError("当前浏览器不支持语音识别，请使用 Edge 或 Chrome，或先改用文字输入。")
      return
    }

    if (typing) {
      setVoiceStatus("paused")
      setVoiceError("请等对方这句话说完后，再继续语音训练。")
      return
    }

    setVoiceStatus("requesting-permission")
    voiceLoopRef.current = true

    try {
      const stream = await navigator.mediaDevices?.getUserMedia?.({ audio: true })
      stream?.getTracks().forEach((track) => track.stop())
    } catch (error) {
      voiceLoopRef.current = false
      setVoiceStatus("error")
      setVoiceError("麦克风权限被拒绝，请允许麦克风后再试。")
      console.warn("Microphone permission was not granted", error)
      return
    }

    if (!started) {
      const firstTurn = scenario.script[0]
      if (!firstTurn) {
        voiceLoopRef.current = false
        setVoiceStatus("error")
        setVoiceError("当前场景没有可播放的话术，请切换场景。")
        return
      }

      setStarted(true)
      setTyping(true)
      timeoutRef.current = setTimeout(() => {
        setTyping(false)
        setMessages((items) => [
          ...items,
          { id: nextId(), sender: "scammer", text: firstTurn.line, trigger: firstTurn.trigger },
        ])
        setScammerShown(1)
        bumpRisk(firstTurn.riskDelta)
        setAdvice(firstTurn.coach)
        setLastAiSource("fallback")
        if (firstTurn.trigger) setTriggers((items) => [...items, firstTurn.trigger as string])
        speakScammerLine(firstTurn.line)
      }, 500)
      return
    }

    speakScammerLine(lastScammerText(messages, scenario, scammerShown))
  }, [scenario, started, finished, typing, messages, scammerShown, bumpRisk, speakScammerLine])

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
    voiceLoopRef.current = false
    stopBrowserVoice()
    setVoiceStatus("finished")
    setTyping(false)
    setMessages((items) => [
      ...items,
      { id: nextId(), sender: "system", text: "你果断挂断/退出，成功脱离了这场骗局。" },
    ])
    bumpRisk(-6)
    setGoodMoves((value) => value + 1)
    setFinished(true)
    setAdvice("挂断就是最好的反诈。挂断、不回拨陌生号码、和家人确认，你已经赢了这一局。")
  }, [scenario, started, finished, bumpRisk, stopBrowserVoice])

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
          <VoiceCallPanel
            scenario={scenario}
            active={voicePanelOpen}
            started={started}
            finished={finished}
            status={voiceStatus}
            provider={voiceProvider}
            transcript={voiceTranscript}
            error={voiceError}
            durationLabel={voiceDurationLabel}
            onStart={handleStartVoice}
            onReplay={handleReplayVoice}
            onStopVoice={handlePauseVoice}
            onHelp={handleHelp}
            onHangup={handleHangup}
          />
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
              <div className="grid gap-3 sm:grid-cols-2">
                <Button size="lg" className="h-12 text-base" onClick={handleStart}>
                  <Play className="size-5" />
                  开始训练 · {scenario.title}
                </Button>
                <Button size="lg" variant="outline" className="h-12 text-base" onClick={handleStartVoice}>
                  <PhoneCall className="size-5" />
                  开始语音训练
                </Button>
              </div>
            </div>
          ) : scenario ? (
            <ReplyBar
              disabled={inputDisabled}
              finished={finished}
              onSend={handleSend}
              onHelp={handleHelp}
              onHangup={handleHangup}
              onVoiceStart={voiceActive ? handlePauseVoice : handleStartVoice}
              voiceActive={voiceActive}
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
