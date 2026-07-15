"use client"

import type { VoicePlaybackSegment } from "@/lib/voice/scenario-audio"

type RealtimeVoiceClientOptions = {
  url?: string
  onReady?: () => void
  onPartial?: (text: string) => void
  onFinal?: (text: string) => void
  onTtsStart?: (text?: string) => void
  onTtsEnd?: () => void
  onError?: (message: string, scope?: string) => void
  onClose?: () => void
}

type GatewayEvent =
  | { type: "gateway.ready"; capabilities?: { protocolVersion?: number; ttsPrewarm?: boolean } }
  | { type: "asr.ready" }
  | { type: "asr.partial"; text?: string }
  | { type: "asr.final"; text?: string }
  | { type: "tts.ready"; voice?: string }
  | { type: "tts.started"; text?: string; utteranceId?: string }
  | { type: "tts.audio"; audio?: string; sampleRate?: number; utteranceId?: string }
  | { type: "tts.done"; utteranceId?: string }
  | { type: "error"; message?: string; scope?: string; utteranceId?: string }

type BrowserAudioContext = typeof AudioContext

const DEFAULT_GATEWAY_URL = "ws://127.0.0.1:8787/voice"
const ASR_SAMPLE_RATE = 16000
const TTS_SAMPLE_RATE = 24000
const INPUT_BUFFER_SIZE = 2048
// Mobile browsers need a modest jitter buffer. The gateway already batches PCM,
// so this remains short enough to feel like a phone conversation.
const TTS_START_BUFFER_SECONDS = 0.55
const TTS_MIN_CHUNK_LEAD_SECONDS = 0.03

export class RealtimeVoiceClient {
  private readonly url: string
  private readonly options: RealtimeVoiceClientOptions
  private socket: WebSocket | null = null
  private stream: MediaStream | null = null
  private inputContext: AudioContext | null = null
  private outputContext: AudioContext | null = null
  private outputGain: GainNode | null = null
  private sourceNode: MediaStreamAudioSourceNode | null = null
  private processorNode: ScriptProcessorNode | null = null
  private nextPlayTime = 0
  private sequenceTimer: number | null = null
  private playbackQueue: VoicePlaybackSegment[] = []
  private playbackGeneration = 0
  private audioChunkQueue: Promise<void> = Promise.resolve()
  private activeSources = new Set<AudioBufferSourceNode>()
  private activeTtsFallbackSrc: string | null = null
  private activeTtsFallbackText: string | null = null
  private activeTtsId: string | null = null
  private ttsInFlight = false
  private gatewayCapabilitiesKnown = false
  private supportsTtsPrewarm = false
  private preparedVoice = ""
  private pendingPrepareVoice = ""
  private preparePromise: Promise<void> | null = null
  private prepareResolve: (() => void) | null = null
  private prepareTimer: number | null = null
  private asrReadyResolve: (() => void) | null = null
  private asrReadyReject: ((error: Error) => void) | null = null
  private asrReadyTimer: number | null = null
  private muted = false
  private listening = false

  constructor(options: RealtimeVoiceClientOptions = {}) {
    this.url = options.url || DEFAULT_GATEWAY_URL
    this.options = options
  }

  get connected() {
    return this.socket?.readyState === WebSocket.OPEN
  }

  get isMuted() {
    return this.muted
  }

  async connect() {
    if (this.socket?.readyState === WebSocket.OPEN) return

    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(this.url)
      const timer = window.setTimeout(() => {
        socket.close()
        reject(new Error("Voice gateway connection timed out"))
      }, 4500)

      socket.onopen = () => {
        window.clearTimeout(timer)
        this.socket = socket
        resolve()
      }

      socket.onerror = () => {
        window.clearTimeout(timer)
        reject(new Error("Voice gateway is unavailable"))
      }

      socket.onmessage = (event) => this.handleGatewayMessage(event.data)
      socket.onclose = () => {
        this.socket = null
        this.gatewayCapabilitiesKnown = false
        this.supportsTtsPrewarm = false
        this.preparedVoice = ""
        this.finishVoicePreparation()
        this.finishAsrReady(new Error("Voice gateway connection closed"))
        this.stopListening(false)
        this.cancelPlayback(false)
        this.options.onClose?.()
      }
    })
  }

  async prepareVoice(voice?: string) {
    const requestedVoice = String(voice || "").trim()
    if (!requestedVoice) return

    await this.connect()
    if (this.preparedVoice === requestedVoice) return
    if (this.gatewayCapabilitiesKnown && !this.supportsTtsPrewarm) return
    if (this.preparePromise && this.pendingPrepareVoice === requestedVoice) return this.preparePromise

    this.finishVoicePreparation()
    this.pendingPrepareVoice = requestedVoice
    this.preparePromise = new Promise<void>((resolve) => {
      this.prepareResolve = resolve
      this.prepareTimer = window.setTimeout(() => this.finishVoicePreparation(), 2500)
    })

    if (this.gatewayCapabilitiesKnown && this.supportsTtsPrewarm) {
      this.send({ type: "tts.prepare", voice: requestedVoice })
    }

    return this.preparePromise
  }

  async startListening() {
    await this.connect()
    await this.ensureInput()
    const asrReady = this.waitForAsrReady()
    this.send({ type: "asr.start" })
    await asrReady
    this.listening = true
  }

  stopListening(commit = true, releaseMedia = true) {
    const wasListening = this.listening
    this.listening = false
    this.finishAsrReady(new Error("Microphone listening was stopped"))
    if (commit && wasListening) this.send({ type: "asr.stop" })

    this.detachInputNodes()
    if (!releaseMedia) return

    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop())
      this.stream = null
    }
    if (this.inputContext) {
      void this.inputContext.close()
      this.inputContext = null
    }
  }

  private detachInputNodes() {
    if (this.processorNode) {
      this.processorNode.disconnect()
      this.processorNode.onaudioprocess = null
      this.processorNode = null
    }
    if (this.sourceNode) {
      this.sourceNode.disconnect()
      this.sourceNode = null
    }
  }

  async speak(text: string, voice?: string, instructions?: string) {
    return this.playSequence([{ kind: "tts", text, voice, instructions }])
  }

  async playSequence(segments: VoicePlaybackSegment[]) {
    const validSegments = segments.filter((segment) => segment.kind === "asset" || segment.text.trim())
    if (validSegments.length === 0) return

    await this.connect()
    // Keep the microphone track for this call, but stop forwarding audio while
    // the simulated caller speaks. Reusing it avoids a slow permission/device
    // reinitialization on every turn, especially on phones.
    this.stopListening(true, false)
    this.cancelPlayback()
    this.playbackQueue = [...validSegments]
    const firstTts = validSegments.find((segment) => segment.kind === "tts")
    this.options.onTtsStart?.(firstTts?.kind === "tts" ? firstTts.text : undefined)
    void this.playNextSegment()
  }

  setMuted(nextMuted: boolean) {
    this.muted = nextMuted
    if (this.outputGain) this.outputGain.gain.value = nextMuted ? 0 : 1
  }

  stopPlayback() {
    this.cancelPlayback()
  }

  close() {
    this.stopListening(false)
    this.cancelPlayback()
    this.send({ type: "close" })
    this.socket?.close()
    this.socket = null
  }

  private async playNextSegment() {
    const segment = this.playbackQueue.shift()
    if (!segment) {
      this.options.onTtsEnd?.()
      return
    }

    if (segment.kind === "asset") {
      try {
        await this.playAsset(segment.src)
      } catch (error) {
        this.options.onError?.("场景音效未能播放，已自动跳过。", "asset")
        console.warn("Failed to play audio cue", error)
      }
      this.scheduleQueueAdvance()
      return
    }

    this.activeTtsFallbackSrc = segment.fallbackSrc ?? null
    this.activeTtsFallbackText = segment.text.trim()
    this.activeTtsId = createUtteranceId()
    this.ttsInFlight = true
    this.send({
      type: "tts.speak",
      utteranceId: this.activeTtsId,
      text: segment.text.trim(),
      voice: segment.voice,
      instructions: segment.instructions,
    })
  }

  private scheduleQueueAdvance() {
    if (this.sequenceTimer) window.clearTimeout(this.sequenceTimer)
    const delay = this.outputContext
      ? Math.max(80, (this.nextPlayTime - this.outputContext.currentTime) * 1000 + 120)
      : 80
    this.sequenceTimer = window.setTimeout(() => {
      this.sequenceTimer = null
      void this.playNextSegment()
    }, delay)
  }

  private cancelPlayback(notifyGateway = true) {
    const cancelledTtsId = this.activeTtsId
    if (this.sequenceTimer) {
      window.clearTimeout(this.sequenceTimer)
      this.sequenceTimer = null
    }
    this.playbackGeneration += 1
    this.audioChunkQueue = Promise.resolve()
    this.playbackQueue = []
    this.activeTtsFallbackSrc = null
    this.activeTtsFallbackText = null
    this.activeTtsId = null
    const shouldStopTts = notifyGateway && this.ttsInFlight
    this.ttsInFlight = false
    this.nextPlayTime = 0
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel()
    }
    for (const source of this.activeSources) {
      try {
        source.stop()
      } catch {
        // The source may already have reached its natural end.
      }
    }
    this.activeSources.clear()
    if (this.outputContext) {
      void this.outputContext.close()
      this.outputContext = null
      this.outputGain = null
    }
    if (shouldStopTts) this.send({ type: "tts.stop", utteranceId: cancelledTtsId })
  }

  private async ensureInput() {
    const AudioContextCtor = getAudioContext()
    if (!AudioContextCtor) throw new Error("This browser does not support Web Audio")
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("This browser cannot access the microphone")

    this.detachInputNodes()
    if (!this.stream || !this.inputContext || this.inputContext.state === "closed") {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      })
      this.inputContext = new AudioContextCtor({ sampleRate: ASR_SAMPLE_RATE })
    }
    if (this.inputContext.state === "suspended") await this.inputContext.resume()
    this.sourceNode = this.inputContext.createMediaStreamSource(this.stream)
    this.processorNode = this.inputContext.createScriptProcessor(INPUT_BUFFER_SIZE, 1, 1)
    const inputRate = this.inputContext.sampleRate

    this.processorNode.onaudioprocess = (event) => {
      if (!this.listening) return
      const input = event.inputBuffer.getChannelData(0)
      const pcm = floatToPcm16(inputRate === ASR_SAMPLE_RATE ? input : resample(input, inputRate, ASR_SAMPLE_RATE))
      this.send({ type: "asr.audio", audio: bytesToBase64(new Uint8Array(pcm.buffer)) })
    }

    this.sourceNode.connect(this.processorNode)
    this.processorNode.connect(this.inputContext.destination)
  }

  private async ensureOutput() {
    const AudioContextCtor = getAudioContext()
    if (!AudioContextCtor) throw new Error("This browser does not support Web Audio")
    if (!this.outputContext || this.outputContext.state === "closed") {
      this.outputContext = new AudioContextCtor()
      this.outputGain = this.outputContext.createGain()
      this.outputGain.gain.value = this.muted ? 0 : 1
      this.outputGain.connect(this.outputContext.destination)
      this.nextPlayTime = this.outputContext.currentTime
    }
    if (this.outputContext.state === "suspended") await this.outputContext.resume()
    return this.outputContext
  }

  private enqueuePcm(base64Audio: string, sampleRate: number) {
    const generation = this.playbackGeneration
    this.audioChunkQueue = this.audioChunkQueue
      .then(() => this.playPcm(base64Audio, sampleRate, generation))
      .catch((error) => {
        if (generation !== this.playbackGeneration) return
        this.options.onError?.(readableError(error), "tts")
      })
  }

  private async playPcm(base64Audio: string, sampleRate: number, generation: number) {
    if (generation !== this.playbackGeneration) return
    const context = await this.ensureOutput()
    if (generation !== this.playbackGeneration || context.state === "closed") return
    const pcm = base64ToInt16(base64Audio)
    const buffer = context.createBuffer(1, pcm.length, sampleRate || TTS_SAMPLE_RATE)
    const channel = buffer.getChannelData(0)
    for (let index = 0; index < pcm.length; index += 1) {
      channel[index] = Math.max(-1, Math.min(1, pcm[index] / 32768))
    }

    const source = context.createBufferSource()
    source.buffer = buffer
    source.connect(this.outputGain ?? context.destination)
    source.onended = () => this.activeSources.delete(source)
    this.activeSources.add(source)
    const minimumStart = context.currentTime + TTS_MIN_CHUNK_LEAD_SECONDS
    if (this.nextPlayTime <= context.currentTime) {
      this.nextPlayTime = context.currentTime + TTS_START_BUFFER_SECONDS
    }
    const startAt = Math.max(this.nextPlayTime, minimumStart)
    source.start(startAt)
    this.nextPlayTime = startAt + buffer.duration
  }

  private async playAsset(src: string) {
    const context = await this.ensureOutput()
    const response = await fetch(src)
    if (!response.ok) throw new Error(`Audio asset returned ${response.status}`)
    const raw = await response.arrayBuffer()
    const buffer = await context.decodeAudioData(raw.slice(0))
    const source = context.createBufferSource()
    source.buffer = buffer
    source.connect(this.outputGain ?? context.destination)
    const startAt = Math.max(this.nextPlayTime, context.currentTime + 0.02)
    source.start(startAt)
    this.nextPlayTime = startAt + buffer.duration
  }

  private playBrowserSpeech(text: string) {
    return new Promise<void>((resolve) => {
      if (typeof window === "undefined" || !("speechSynthesis" in window)) {
        resolve()
        return
      }

      const utterance = new SpeechSynthesisUtterance(text)
      utterance.lang = "zh-CN"
      utterance.rate = 1
      utterance.volume = this.muted ? 0 : 1
      utterance.onend = () => resolve()
      utterance.onerror = () => resolve()
      window.speechSynthesis.cancel()
      window.speechSynthesis.speak(utterance)
    })
  }

  private handleGatewayMessage(raw: string) {
    let event: GatewayEvent
    try {
      event = JSON.parse(raw)
    } catch {
      return
    }

    switch (event.type) {
      case "gateway.ready":
        this.gatewayCapabilitiesKnown = true
        this.supportsTtsPrewarm = event.capabilities?.ttsPrewarm === true
        if (this.pendingPrepareVoice) {
          if (this.supportsTtsPrewarm) {
            this.send({ type: "tts.prepare", voice: this.pendingPrepareVoice })
          } else {
            this.finishVoicePreparation()
          }
        }
        this.options.onReady?.()
        break
      case "asr.ready":
        this.finishAsrReady()
        this.options.onReady?.()
        break
      case "asr.partial":
        if (this.listening && event.text) this.options.onPartial?.(event.text)
        break
      case "asr.final":
        if (this.listening && event.text) this.options.onFinal?.(event.text)
        break
      case "tts.ready":
        this.preparedVoice = String(event.voice || this.pendingPrepareVoice).trim()
        this.finishVoicePreparation()
        break
      case "tts.started":
        break
      case "tts.audio":
        if (event.utteranceId && event.utteranceId !== this.activeTtsId) break
        if (event.audio) this.enqueuePcm(event.audio, event.sampleRate || TTS_SAMPLE_RATE)
        break
      case "tts.done":
        if (event.utteranceId && event.utteranceId !== this.activeTtsId) break
        if (!this.ttsInFlight) break
        void this.finishCurrentTts(this.playbackGeneration, this.activeTtsId)
        break
      case "error":
        if (event.scope === "tts.prepare") {
          this.finishVoicePreparation()
          break
        }
        if (event.utteranceId && event.utteranceId !== this.activeTtsId) break
        if (event.scope === "tts" && this.activeTtsFallbackSrc) {
          this.playbackQueue.unshift({ kind: "asset", src: this.activeTtsFallbackSrc })
          this.activeTtsFallbackSrc = null
          this.activeTtsFallbackText = null
          this.activeTtsId = null
          this.ttsInFlight = false
          this.scheduleQueueAdvance()
          break
        }
        if (event.scope === "tts" && this.activeTtsFallbackText) {
          const fallbackText = this.activeTtsFallbackText
          this.activeTtsFallbackText = null
          this.activeTtsId = null
          this.ttsInFlight = false
          void this.playBrowserSpeech(fallbackText).finally(() => this.scheduleQueueAdvance())
          this.options.onError?.("阿里云语音暂不可用，已使用浏览器语音继续训练。", event.scope)
          break
        }
        if (event.scope === "tts") {
          this.activeTtsId = null
          this.ttsInFlight = false
          this.scheduleQueueAdvance()
        }
        this.options.onError?.(event.message || "Voice gateway error", event.scope)
        break
    }
  }

  private async finishCurrentTts(generation: number, utteranceId: string | null) {
    await this.audioChunkQueue
    if (generation !== this.playbackGeneration || utteranceId !== this.activeTtsId || !this.ttsInFlight) return
    this.activeTtsFallbackSrc = null
    this.activeTtsFallbackText = null
    this.activeTtsId = null
    this.ttsInFlight = false
    this.scheduleQueueAdvance()
  }

  private finishVoicePreparation() {
    if (this.prepareTimer) {
      window.clearTimeout(this.prepareTimer)
      this.prepareTimer = null
    }
    const resolve = this.prepareResolve
    this.prepareResolve = null
    this.preparePromise = null
    this.pendingPrepareVoice = ""
    resolve?.()
  }

  private waitForAsrReady() {
    this.finishAsrReady(new Error("ASR session was replaced"))
    return new Promise<void>((resolve, reject) => {
      this.asrReadyResolve = resolve
      this.asrReadyReject = reject
      this.asrReadyTimer = window.setTimeout(() => {
        this.finishAsrReady(new Error("Voice recognition connection timed out"))
      }, 4_000)
    })
  }

  private finishAsrReady(error?: Error) {
    if (this.asrReadyTimer) {
      window.clearTimeout(this.asrReadyTimer)
      this.asrReadyTimer = null
    }
    const resolve = this.asrReadyResolve
    const reject = this.asrReadyReject
    this.asrReadyResolve = null
    this.asrReadyReject = null
    if (error) reject?.(error)
    else resolve?.()
  }

  private send(payload: unknown) {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(payload))
    }
  }
}

function getAudioContext(): BrowserAudioContext | null {
  if (typeof window === "undefined") return null
  const browserWindow = window as typeof window & { webkitAudioContext?: BrowserAudioContext }
  return window.AudioContext || browserWindow.webkitAudioContext || null
}

function floatToPcm16(floatData: Float32Array) {
  const output = new Int16Array(floatData.length)
  for (let index = 0; index < floatData.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, floatData[index]))
    output[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff
  }
  return output
}

function resample(input: Float32Array, fromRate: number, toRate: number) {
  if (fromRate === toRate) return input
  const ratio = fromRate / toRate
  const length = Math.max(1, Math.round(input.length / ratio))
  const output = new Float32Array(length)
  for (let index = 0; index < length; index += 1) {
    const position = index * ratio
    const left = Math.floor(position)
    const right = Math.min(left + 1, input.length - 1)
    const weight = position - left
    output[index] = input[left] * (1 - weight) + input[right] * weight
  }
  return output
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = ""
  const chunkSize = 0x8000
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize))
  }
  return window.btoa(binary)
}

function base64ToInt16(base64: string) {
  const binary = window.atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return new Int16Array(bytes.buffer)
}

function readableError(error: unknown) {
  if (error instanceof Error) return error.message
  return String(error || "Unknown error")
}

function createUtteranceId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID()
  return `tts_${Date.now()}_${Math.random().toString(36).slice(2)}`
}
