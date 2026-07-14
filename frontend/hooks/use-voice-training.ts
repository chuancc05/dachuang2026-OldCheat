"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import type { VoiceCallStatus, VoiceProvider, VoiceTranscript } from "@/components/training/voice-call-panel"
import { RealtimeVoiceClient } from "@/lib/voice/realtime-voice-client"
import type { AudioCue, AudioTurn } from "@/lib/voice/scenario-audio"

export type RealtimeTurnGate = "scammer-speaking" | "listening-user" | "submitted" | "finished"

export type BrowserSpeechRecognitionEvent = {
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

export type BrowserSpeechRecognition = {
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

export type BrowserSpeechRecognitionConstructor = new () => BrowserSpeechRecognition

export function getSpeechRecognitionConstructor(): BrowserSpeechRecognitionConstructor | null {
  if (typeof window === "undefined") return null
  const browserWindow = window as typeof window & {
    SpeechRecognition?: BrowserSpeechRecognitionConstructor
    webkitSpeechRecognition?: BrowserSpeechRecognitionConstructor
  }
  return browserWindow.SpeechRecognition ?? browserWindow.webkitSpeechRecognition ?? null
}

export function useVoiceTraining() {
  const [voicePanelOpen, setVoicePanelOpen] = useState(false)
  const [voiceStatus, setVoiceStatus] = useState<VoiceCallStatus>("idle")
  const [voiceProvider, setVoiceProvider] = useState<VoiceProvider>("unavailable")
  const [voiceTranscript, setVoiceTranscript] = useState<VoiceTranscript | null>(null)
  const [voiceError, setVoiceError] = useState("")
  const [voiceMuted, setVoiceMuted] = useState(false)

  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null)
  const realtimeClientRef = useRef<RealtimeVoiceClient | null>(null)
  const voiceLoopRef = useRef(false)
  const realtimeVoiceRef = useRef(false)
  const realtimeSubmittingRef = useRef(false)
  // Keeps delayed ASR events from a previous phase from advancing the training.
  const realtimeTurnGateRef = useRef<RealtimeTurnGate>("finished")
  const finishedRef = useRef(false)
  const transcriptRef = useRef("")
  const transcriptConfidenceRef = useRef<number | undefined>(undefined)
  const lastSpokenLineRef = useRef("")
  const lastSpokenTurnRef = useRef<AudioTurn | null>(null)
  const consumedAudioCueIdsRef = useRef<Set<AudioCue["id"]>>(new Set())
  const handleSendRef = useRef<(text: string) => Promise<AudioTurn | null>>(async () => null)
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
    realtimeTurnGateRef.current = "finished"
    realtimeClientRef.current?.close()
    realtimeClientRef.current = null
  }, [])

  const resetVoiceTraining = useCallback(() => {
    voiceLoopRef.current = false
    realtimeSubmittingRef.current = false
    realtimeTurnGateRef.current = "finished"
    stopRealtimeVoice()
    stopBrowserVoice()
    setVoicePanelOpen(false)
    setVoiceStatus("idle")
    setVoiceProvider("unavailable")
    setVoiceTranscript(null)
    setVoiceError("")
    setVoiceMuted(false)
    transcriptRef.current = ""
    transcriptConfidenceRef.current = undefined
    lastSpokenLineRef.current = ""
    lastSpokenTurnRef.current = null
    consumedAudioCueIdsRef.current.clear()
  }, [stopBrowserVoice, stopRealtimeVoice])

  const finishVoiceTraining = useCallback(() => {
    voiceLoopRef.current = false
    realtimeTurnGateRef.current = "finished"
    stopRealtimeVoice()
    stopBrowserVoice()
    setVoiceStatus("finished")
  }, [stopBrowserVoice, stopRealtimeVoice])

  useEffect(
    () => () => {
      voiceLoopRef.current = false
      stopRealtimeVoice()
      stopBrowserVoice()
    },
    [stopBrowserVoice, stopRealtimeVoice],
  )

  const voiceActive =
    voicePanelOpen && !["idle", "paused", "finished", "error"].includes(voiceStatus)

  return {
    voicePanelOpen,
    voiceStatus,
    voiceProvider,
    voiceTranscript,
    voiceError,
    voiceMuted,
    voiceActive,
    recognitionRef,
    realtimeClientRef,
    voiceLoopRef,
    realtimeVoiceRef,
    realtimeSubmittingRef,
    realtimeTurnGateRef,
    finishedRef,
    transcriptRef,
    transcriptConfidenceRef,
    lastSpokenLineRef,
    lastSpokenTurnRef,
    consumedAudioCueIdsRef,
    handleSendRef,
    startVoiceListeningRef,
    setVoicePanelOpen,
    setVoiceStatus,
    setVoiceProvider,
    setVoiceTranscript,
    setVoiceError,
    setVoiceMuted,
    stopBrowserVoice,
    stopRealtimeVoice,
    resetVoiceTraining,
    finishVoiceTraining,
  }
}
