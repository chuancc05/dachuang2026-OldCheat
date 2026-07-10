"use client"

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
  | { type: "gateway.ready" }
  | { type: "asr.ready" }
  | { type: "asr.partial"; text?: string }
  | { type: "asr.final"; text?: string }
  | { type: "tts.started"; text?: string }
  | { type: "tts.audio"; audio?: string; sampleRate?: number }
  | { type: "tts.done" }
  | { type: "error"; message?: string; scope?: string }

type BrowserAudioContext = typeof AudioContext

const DEFAULT_GATEWAY_URL = "ws://127.0.0.1:8787/voice"
const ASR_SAMPLE_RATE = 16000
const TTS_SAMPLE_RATE = 24000

export class RealtimeVoiceClient {
  private readonly url: string
  private readonly options: RealtimeVoiceClientOptions
  private socket: WebSocket | null = null
  private stream: MediaStream | null = null
  private inputContext: AudioContext | null = null
  private outputContext: AudioContext | null = null
  private sourceNode: MediaStreamAudioSourceNode | null = null
  private processorNode: ScriptProcessorNode | null = null
  private nextPlayTime = 0
  private ttsEndTimer: number | null = null
  private listening = false

  constructor(options: RealtimeVoiceClientOptions = {}) {
    this.url = options.url || DEFAULT_GATEWAY_URL
    this.options = options
  }

  get connected() {
    return this.socket?.readyState === WebSocket.OPEN
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
        this.stopListening(false)
        this.options.onClose?.()
      }
    })
  }

  async startListening() {
    await this.connect()
    await this.ensureInput()
    this.send({ type: "asr.start" })
    this.listening = true
  }

  stopListening(commit = true) {
    this.listening = false
    if (commit) this.send({ type: "asr.stop" })

    if (this.processorNode) {
      this.processorNode.disconnect()
      this.processorNode.onaudioprocess = null
      this.processorNode = null
    }
    if (this.sourceNode) {
      this.sourceNode.disconnect()
      this.sourceNode = null
    }
    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop())
      this.stream = null
    }
    if (this.inputContext) {
      void this.inputContext.close()
      this.inputContext = null
    }
  }

  async speak(text: string, voice?: string) {
    const trimmed = text.trim()
    if (!trimmed) return
    await this.connect()
    this.stopListening(false)
    this.stopPlayback()
    this.send({ type: "tts.speak", text: trimmed, voice })
  }

  stopPlayback() {
    if (this.ttsEndTimer) {
      window.clearTimeout(this.ttsEndTimer)
      this.ttsEndTimer = null
    }
    this.nextPlayTime = 0
    if (this.outputContext) {
      void this.outputContext.close()
      this.outputContext = null
    }
    this.send({ type: "tts.stop" })
  }

  close() {
    this.stopListening(false)
    this.stopPlayback()
    this.send({ type: "close" })
    this.socket?.close()
    this.socket = null
  }

  private async ensureInput() {
    const AudioContextCtor = getAudioContext()
    if (!AudioContextCtor) throw new Error("This browser does not support Web Audio")
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("This browser cannot access the microphone")

    this.stopListening(false)
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    })
    this.inputContext = new AudioContextCtor({ sampleRate: ASR_SAMPLE_RATE })
    this.sourceNode = this.inputContext.createMediaStreamSource(this.stream)
    this.processorNode = this.inputContext.createScriptProcessor(4096, 1, 1)
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

  private async playPcm(base64Audio: string, sampleRate: number) {
    const AudioContextCtor = getAudioContext()
    if (!AudioContextCtor) throw new Error("This browser does not support Web Audio")
    if (!this.outputContext || this.outputContext.state === "closed") {
      this.outputContext = new AudioContextCtor()
      this.nextPlayTime = this.outputContext.currentTime
    }
    if (this.outputContext.state === "suspended") await this.outputContext.resume()

    const pcm = base64ToInt16(base64Audio)
    const buffer = this.outputContext.createBuffer(1, pcm.length, sampleRate || TTS_SAMPLE_RATE)
    const channel = buffer.getChannelData(0)
    for (let index = 0; index < pcm.length; index += 1) {
      channel[index] = Math.max(-1, Math.min(1, pcm[index] / 32768))
    }

    const source = this.outputContext.createBufferSource()
    source.buffer = buffer
    source.connect(this.outputContext.destination)
    const startAt = Math.max(this.nextPlayTime, this.outputContext.currentTime + 0.02)
    source.start(startAt)
    this.nextPlayTime = startAt + buffer.duration
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
      case "asr.ready":
        this.options.onReady?.()
        break
      case "asr.partial":
        if (event.text) this.options.onPartial?.(event.text)
        break
      case "asr.final":
        if (event.text) this.options.onFinal?.(event.text)
        break
      case "tts.started":
        this.options.onTtsStart?.(event.text)
        break
      case "tts.audio":
        if (event.audio) {
          void this.playPcm(event.audio, event.sampleRate || TTS_SAMPLE_RATE).catch((error) => {
            this.options.onError?.(readableError(error), "tts")
          })
        }
        break
      case "tts.done":
        this.notifyTtsEndAfterPlayback()
        break
      case "error":
        this.options.onError?.(event.message || "Voice gateway error", event.scope)
        break
    }
  }

  private notifyTtsEndAfterPlayback() {
    if (this.ttsEndTimer) window.clearTimeout(this.ttsEndTimer)
    const delay = this.outputContext
      ? Math.max(80, (this.nextPlayTime - this.outputContext.currentTime) * 1000 + 120)
      : 80
    this.ttsEndTimer = window.setTimeout(() => {
      this.ttsEndTimer = null
      this.options.onTtsEnd?.()
    }, delay)
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
    const chunk = bytes.subarray(index, index + chunkSize)
    binary += String.fromCharCode(...chunk)
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
