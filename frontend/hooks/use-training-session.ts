"use client"

import { useCallback, useEffect, useState } from "react"
import type { Message } from "@/components/training/simulation-stage"
import type { RagDebugInfo } from "@/components/training/rag-debug-panel"
import type { ReportEvent } from "@/components/training/report-dialog"
import type { Scenario } from "@/lib/scenarios"

export const DEFAULT_ADVICE = "保持核实身份、拒绝验证码、拒绝转账的习惯。遇到催促和恐吓，先停下，再核实。"

export type AiSource = "idle" | "deepseek" | "ollama" | "fallback"

export function useTrainingSession(initialScenario: Scenario | null) {
  const [scenario, setScenario] = useState<Scenario | null>(initialScenario)
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
  const [ragDebugEnabled, setRagDebugEnabled] = useState(false)
  const [lastRagDebug, setLastRagDebug] = useState<RagDebugInfo | null>(null)
  const [reportEvents, setReportEvents] = useState<ReportEvent[]>([])

  useEffect(() => {
    setRagDebugEnabled(new URLSearchParams(window.location.search).get("ragDebug") === "1")
  }, [])

  useEffect(() => {
    if (!started || finished) return
    const timer = setInterval(() => setDuration((value) => value + 1), 1000)
    return () => clearInterval(timer)
  }, [started, finished])

  const bumpRisk = useCallback((delta: number) => {
    setRisk((current) => {
      const next = Math.max(0, Math.min(10, current + delta))
      setPeakRisk((peak) => Math.max(peak, next))
      return next
    })
  }, [])

  const resetSession = useCallback((nextScenario: Scenario | null) => {
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
    setLastRagDebug(null)
    setReportEvents([])
  }, [])

  const defenseScore = Math.round(
    Math.max(0, Math.min(100, 100 - peakRisk * 6 - riskyMoves * 12 + goodMoves * 6)),
  )

  return {
    scenario,
    started,
    finished,
    messages,
    typing,
    scammerShown,
    risk,
    peakRisk,
    triggers,
    advice,
    goodMoves,
    riskyMoves,
    duration,
    reportOpen,
    coreCompleteNotified,
    lastAiSource,
    ragDebugEnabled,
    lastRagDebug,
    reportEvents,
    defenseScore,
    setScenario,
    setStarted,
    setFinished,
    setMessages,
    setTyping,
    setScammerShown,
    setTriggers,
    setAdvice,
    setGoodMoves,
    setRiskyMoves,
    setReportOpen,
    setCoreCompleteNotified,
    setLastAiSource,
    setLastRagDebug,
    setReportEvents,
    bumpRisk,
    resetSession,
  }
}
