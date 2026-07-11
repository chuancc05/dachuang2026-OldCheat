"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { ScenarioRail } from "@/components/training/scenario-rail"
import { SimulationStage, type Message } from "@/components/training/simulation-stage"
import { CoachPanel } from "@/components/training/coach-panel"
import { ReplyBar } from "@/components/training/reply-bar"
import { ReportDialog, type ReportEvent, type ReportEvaluation } from "@/components/training/report-dialog"
import { MobileTrainingFlow } from "@/components/training/mobile-training-flow"
import {
  VoiceCallPanel,
  type VoiceCallStatus,
  type VoiceProvider,
  type VoiceTranscript,
} from "@/components/training/voice-call-panel"
import { Button } from "@/components/ui/button"
import { evaluateReply, type Scenario } from "@/lib/scenarios"
import { splitSpeechCue } from "@/lib/speech-text"
import { RealtimeVoiceClient } from "@/lib/voice/realtime-voice-client"
import {
  buildVoicePlaybackSegments,
  createAudioTurn,
  type AudioCue,
  type AudioTurn,
} from "@/lib/voice/scenario-audio"
import { getScenarioVoice } from "@/lib/voice/scenario-voices"
import { ShieldHalf, Play, RotateCcw, HelpCircle, PhoneCall } from "lucide-react"

const DEFAULT_ADVICE = "保持核实身份、拒绝验证码、拒绝转账的习惯。遇到催促和恐吓，先停下，再核实。"

const QUICK_REPLIES = [
  "这听起来像诈骗，我要挂断了",
  "我要先联系我的子女核实",
  "我不会转账，也不会给验证码",
]

type AiSource = "idle" | "deepseek" | "ollama" | "fallback"
type TrainingReply = AudioTurn

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

const VOICE_GATEWAY_URL = process.env.NEXT_PUBLIC_VOICE_GATEWAY_URL || "ws://127.0.0.1:8787/voice"

function parseAiSource(value: unknown): AiSource {
  return value === "deepseek" || value === "ollama" || value === "fallback" ? value : "fallback"
}

function parseAudioCues(value: unknown): AudioCue[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return []
    const cue = item as Partial<AudioCue>
    if (typeof cue.id !== "string" || !Array.isArray(cue.labels) || !Array.isArray(cue.assetPaths)) return []
    return [{
      id: cue.id as AudioCue["id"],
      labels: cue.labels.filter((label): label is string => typeof label === "string" && Boolean(label.trim())),
      assetPaths: cue.assetPaths.filter((path): path is string => typeof path === "string" && Boolean(path.trim())),
      dynamicSpeech:
        cue.dynamicSpeech &&
        typeof cue.dynamicSpeech.text === "string" &&
        typeof cue.dynamicSpeech.voice === "string" &&
        typeof cue.dynamicSpeech.instructions === "string"
          ? cue.dynamicSpeech
          : undefined,
    }]
  })
}

function consumeOneShotAudioCues(turn: TrainingReply, consumedCueIds: Set<AudioCue["id"]>): TrainingReply {
  const cues = turn.cues.filter((cue) => {
    if (cue.id !== "relative-distress") return true
    if (consumedCueIds.has(cue.id)) return false
    consumedCueIds.add(cue.id)
    return true
  })
  return cues.length === turn.cues.length ? turn : { ...turn, cues }
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

function useMobileViewport() {
  const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 767px)")
    const updateViewport = () => setIsMobile(mediaQuery.matches)
    updateViewport()
    mediaQuery.addEventListener("change", updateViewport)
    return () => mediaQuery.removeEventListener("change", updateViewport)
  }, [])

  return isMobile
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
  const isMobileViewport = useMobileViewport()
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
  const [voiceMuted, setVoiceMuted] = useState(false)

  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null)
  const realtimeClientRef = useRef<RealtimeVoiceClient | null>(null)
  const voiceLoopRef = useRef(false)
  const realtimeVoiceRef = useRef(false)
  const realtimeSubmittingRef = useRef(false)
  const finishedRef = useRef(false)
  const transcriptRef = useRef("")
  const transcriptConfidenceRef = useRef<number | undefined>(undefined)
  const lastSpokenLineRef = useRef("")
  const lastSpokenTurnRef = useRef<TrainingReply | null>(null)
  const consumedAudioCueIdsRef = useRef<Set<AudioCue["id"]>>(new Set())
  const handleSendRef = useRef<(text: string) => Promise<TrainingReply | null>>(async () => null)
  const startVoiceListeningRef = useRef<() => void>(() => {})

  const stopBrowserVoice = useCallback(() => {
    recognitionRef.current?.abort()
    recognitionRef.current = null
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel()
    }
  }, [])

  const stopRealtimeVoice = useCallback(() => {
    realtimeVoiceRef.current = false
    realtimeClientRef.current?.close()
    realtimeClientRef.current = null
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
      stopRealtimeVoice()
      stopBrowserVoice()
      setVoiceStatus("finished")
    }
  }, [finished, stopBrowserVoice, stopRealtimeVoice])

  useEffect(
    () => () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
      voiceLoopRef.current = false
      stopRealtimeVoice()
      stopBrowserVoice()
    },
    [stopBrowserVoice, stopRealtimeVoice],
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
    stopRealtimeVoice()
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
    setVoiceMuted(false)
    lastSpokenLineRef.current = ""
    lastSpokenTurnRef.current = null
    consumedAudioCueIdsRef.current.clear()
  }, [stopBrowserVoice, stopRealtimeVoice])

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
    async (text: string): Promise<TrainingReply | null> => {
      if (!scenario || !started || finished || typing) return null

      const userMessage: Message = { id: nextId(), sender: "user", text }
      const history = messages
      const turnIndex = scammerShown
      const scammerText = lastScammerText(history, scenario, turnIndex)
      let nextScammerTurn: TrainingReply | null = null
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
        const parsedAudioTurn: TrainingReply = { line, cues: parseAudioCues(turn.audioCues) }
        const audioTurn = realtimeVoiceRef.current
          ? consumeOneShotAudioCues(parsedAudioTurn, consumedAudioCueIdsRef.current)
          : parsedAudioTurn
        nextScammerTurn = audioTurn
        const reportAudioCues = realtimeVoiceRef.current ? audioTurn.cues : []

        setLastAiSource(source)
        setMessages((items) => [
          ...items,
          { id: nextId(), sender: "scammer", text: audioTurn.line, trigger },
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
            audioCues: reportAudioCues,
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
        const parsedAudioTurn = createAudioTurn(scenario, fallbackLine, turnIndex)
        const audioTurn = realtimeVoiceRef.current
          ? consumeOneShotAudioCues(parsedAudioTurn, consumedAudioCueIdsRef.current)
          : parsedAudioTurn
        nextScammerTurn = audioTurn
        const reportAudioCues = realtimeVoiceRef.current ? audioTurn.cues : []
        setLastAiSource("fallback")
        setMessages((items) => [
          ...items,
          {
            id: nextId(),
            sender: "scammer",
            text: audioTurn.line,
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
            audioCues: reportAudioCues,
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
      return nextScammerTurn
    },
    [scenario, started, finished, typing, messages, scammerShown, bumpRisk, totalTurns, coreCompleteNotified],
  )

  useEffect(() => {
    handleSendRef.current = handleSend
  }, [handleSend])

  const speakScammerLine = useCallback(
    (line: string) => {
      const text = splitSpeechCue(line).speechText.trim()
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
        const nextTurn = await handleSendRef.current(text)
        if (!voiceLoopRef.current || finishedRef.current) return
        if (nextTurn) {
          speakScammerLine(nextTurn.line)
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
    stopRealtimeVoice()
    stopBrowserVoice()
    setVoiceStatus("paused")
    setVoiceError("")
  }, [stopBrowserVoice, stopRealtimeVoice])

  const handleReplayVoice = useCallback(() => {
    if (!scenario || !started || finished) return
    const line = lastSpokenLineRef.current || lastScammerText(messages, scenario, scammerShown)
    if (!line.trim()) return
    const scenarioVoice = getScenarioVoice(scenario)
    setVoicePanelOpen(true)
    voiceLoopRef.current = true
    if (realtimeVoiceRef.current && realtimeClientRef.current) {
      setVoiceProvider("dashscope")
      lastSpokenLineRef.current = line
      const replayTurn = lastSpokenTurnRef.current ?? createAudioTurn(scenario, line, scammerShown)
      void realtimeClientRef.current.playSequence(buildVoicePlaybackSegments(replayTurn, scenarioVoice.voice))
      return
    }
    speakScammerLine(line)
  }, [scenario, started, finished, messages, scammerShown, speakScammerLine])

  const handleToggleMute = useCallback(() => {
    const client = realtimeClientRef.current
    if (!client || !realtimeVoiceRef.current) {
      setVoiceError("静音仅在阿里云实时语音训练中可用。")
      return
    }
    const nextMuted = !client.isMuted
    client.setMuted(nextMuted)
    setVoiceMuted(nextMuted)
    setVoiceError("")
  }, [])

  const handleStartBrowserVoice = useCallback(async () => {
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

  const handleStartRealtimeVoice = useCallback(async () => {
    if (!scenario) return false
    const scenarioVoice = getScenarioVoice(scenario)
    if (typing) {
      setVoicePanelOpen(true)
      setVoiceStatus("paused")
      setVoiceError("请等对方这句话说完后，再继续语音训练。")
      return true
    }

    setVoicePanelOpen(true)
    setVoiceProvider("dashscope")
    setVoiceStatus("requesting-permission")
    setVoiceError("")
    setVoiceTranscript(null)
    stopBrowserVoice()
    stopRealtimeVoice()

    const client = new RealtimeVoiceClient({
      url: VOICE_GATEWAY_URL,
      onPartial: (text) => {
        if (!realtimeVoiceRef.current || !text.trim()) return
        setVoiceTranscript({ text: text.trim(), provider: "dashscope" })
      },
      onFinal: (text) => {
        const transcript = text.trim()
        if (!realtimeVoiceRef.current || !transcript || realtimeSubmittingRef.current) return

        realtimeSubmittingRef.current = true
        client.stopListening(false)
        setVoiceTranscript({ text: transcript, provider: "dashscope" })
        setVoiceStatus("thinking")

        void (async () => {
          try {
            const nextTurn = await handleSendRef.current(transcript)
            if (!realtimeVoiceRef.current || finishedRef.current) return
            if (nextTurn) {
              lastSpokenLineRef.current = nextTurn.line
              lastSpokenTurnRef.current = nextTurn
              await client.playSequence(buildVoicePlaybackSegments(nextTurn, scenarioVoice.voice))
            } else {
              voiceLoopRef.current = false
              realtimeVoiceRef.current = false
              setVoiceStatus("paused")
            }
          } catch (error) {
            voiceLoopRef.current = false
            realtimeVoiceRef.current = false
            setVoiceStatus("error")
            setVoiceError("实时语音提交失败，请先改用文字训练或浏览器语音。")
            console.warn("Realtime voice turn failed", error)
          } finally {
            realtimeSubmittingRef.current = false
          }
        })()
      },
      onTtsStart: () => {
        if (!realtimeVoiceRef.current) return
        setVoiceProvider("dashscope")
        setVoiceStatus("speaking-scammer")
        setVoiceError("")
      },
      onTtsEnd: () => {
        if (!realtimeVoiceRef.current || finishedRef.current) return
        setVoiceStatus("listening-user")
        setVoiceTranscript(null)
        void client.startListening().catch((error) => {
          if (!realtimeVoiceRef.current) return
          voiceLoopRef.current = false
          realtimeVoiceRef.current = false
          setVoiceStatus("error")
          setVoiceError("实时语音识别启动失败，已保留文字训练入口。")
          console.warn("Realtime ASR failed", error)
        })
      },
      onError: (message, scope) => {
        console.warn("Realtime voice gateway error", scope, message)
        if (scope === "asset") return
        if (!realtimeVoiceRef.current) return
        voiceLoopRef.current = false
        realtimeVoiceRef.current = false
        setVoiceStatus("error")
        setVoiceError("阿里云实时语音暂时不可用，已保留文字训练入口，也可以再次点击改用浏览器语音。")
      },
    })

    try {
      realtimeClientRef.current = client
      realtimeVoiceRef.current = true
      voiceLoopRef.current = true
      await client.connect()
      client.setMuted(voiceMuted)

      if (!started) {
        const firstTurn = scenario.script[0]
        if (!firstTurn) {
          voiceLoopRef.current = false
          realtimeVoiceRef.current = false
          setVoiceStatus("error")
          setVoiceError("当前场景没有可播放的话术，请切换场景。")
          return true
        }

        setStarted(true)
        setMessages((items) => [
          ...items,
          { id: nextId(), sender: "scammer", text: firstTurn.line, trigger: firstTurn.trigger },
        ])
        setScammerShown(1)
        bumpRisk(firstTurn.riskDelta)
        setAdvice(firstTurn.coach)
        setLastAiSource("fallback")
        if (firstTurn.trigger) setTriggers((items) => [...items, firstTurn.trigger as string])
        const firstAudioTurn = createAudioTurn(scenario, firstTurn.line, 0)
        lastSpokenLineRef.current = firstAudioTurn.line
        lastSpokenTurnRef.current = firstAudioTurn
        await client.playSequence(buildVoicePlaybackSegments(firstAudioTurn, scenarioVoice.voice))
        return true
      }

      const line = lastScammerText(messages, scenario, scammerShown)
      lastSpokenLineRef.current = line
      const resumeTurn = lastSpokenTurnRef.current ?? createAudioTurn(scenario, line, scammerShown)
      lastSpokenTurnRef.current = resumeTurn
      await client.playSequence(buildVoicePlaybackSegments(resumeTurn, scenarioVoice.voice))
      return true
    } catch (error) {
      console.warn("Realtime voice gateway unavailable, falling back to browser voice", error)
      realtimeVoiceRef.current = false
      realtimeClientRef.current?.close()
      realtimeClientRef.current = null
      return false
    }
  }, [
    scenario,
    started,
    typing,
    messages,
    scammerShown,
    bumpRisk,
    stopBrowserVoice,
    stopRealtimeVoice,
    voiceMuted,
  ])

  const handleStartVoice = useCallback(async () => {
    const realtimeStarted = await handleStartRealtimeVoice()
    if (!realtimeStarted) await handleStartBrowserVoice()
  }, [handleStartRealtimeVoice, handleStartBrowserVoice])

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
    stopRealtimeVoice()
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
  }, [scenario, started, finished, bumpRisk, stopBrowserVoice, stopRealtimeVoice])

  if (isMobileViewport) {
    return (
      <>
        <MobileTrainingFlow
          scenarios={scenarios}
          scenario={scenario}
          activeScenarioId={scenario?.id ?? null}
          started={started}
          finished={finished}
          messages={messages}
          typing={typing}
          durationLabel={voiceDurationLabel}
          risk={risk}
          defenseScore={defenseScore}
          goodMoves={goodMoves}
          riskyMoves={riskyMoves}
          advice={advice}
          voiceStatus={voiceStatus}
          voiceProvider={voiceProvider}
          voiceTranscript={voiceTranscript}
          voiceError={voiceError}
          voiceActive={voiceActive}
          onSelectScenario={handleSelect}
          onStartVoice={handleStartVoice}
          onStartText={handleStart}
          onSendText={handleSend}
          onReplay={handleReplayVoice}
          onHelp={handleHelp}
          onHangup={handleHangup}
          onStopVoice={handlePauseVoice}
          onOpenReport={() => setReportOpen(true)}
          onRestart={() => resetSession(scenario)}
        />
        <ReportDialog
          open={reportOpen}
          onClose={() => setReportOpen(false)}
          scenarios={scenarios}
          scenario={scenario}
          defenseScore={defenseScore}
          goodMoves={goodMoves}
          riskyMoves={riskyMoves}
          peakRisk={peakRisk}
          triggers={triggers}
          turns={scammerShown}
          events={reportEvents}
        />
      </>
    )
  }

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
            muted={voiceMuted}
            muteAvailable={voiceProvider === "dashscope" && Boolean(realtimeClientRef.current)}
            onStart={handleStartVoice}
            onToggleMute={handleToggleMute}
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
        scenarios={scenarios}
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
