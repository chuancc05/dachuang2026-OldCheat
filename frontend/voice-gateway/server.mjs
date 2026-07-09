import { existsSync, readFileSync } from "node:fs"
import { createServer } from "node:http"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { WebSocket, WebSocketServer } from "ws"

const here = dirname(fileURLToPath(import.meta.url))
const frontendRoot = resolve(here, "..")

loadLocalEnv(resolve(frontendRoot, ".env.local"))

const PORT = Number(process.env.VOICE_GATEWAY_PORT || 8787)
const API_KEY = readSecret("DASHSCOPE_API_KEY", "DASHSCOPE_API_KEY_B64")
const WORKSPACE_ID = process.env.DASHSCOPE_WORKSPACE_ID || process.env.DASHSCOPE_WORKSPACE || ""
const ASR_URL =
  process.env.DASHSCOPE_ASR_WS_URL ||
  "wss://dashscope.aliyuncs.com/api-ws/v1/realtime?model=qwen3-asr-flash-realtime"
const TTS_URL =
  process.env.DASHSCOPE_TTS_WS_URL ||
  "wss://dashscope.aliyuncs.com/api-ws/v1/realtime?model=qwen3-tts-flash-realtime"
const TTS_VOICE = process.env.DASHSCOPE_TTS_VOICE || "Cherry"
const ASR_SAMPLE_RATE = Number(process.env.VOICE_ASR_SAMPLE_RATE || 16000)
const TTS_SAMPLE_RATE = Number(process.env.VOICE_TTS_SAMPLE_RATE || 24000)

if (!API_KEY) {
  console.error("[voice-gateway] Missing DASHSCOPE_API_KEY in environment or frontend/.env.local")
  process.exit(1)
}

const server = createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" })
    res.end(JSON.stringify({ ok: true, service: "oldcheat-voice-gateway" }))
    return
  }

  res.writeHead(404, { "content-type": "application/json" })
  res.end(JSON.stringify({ ok: false, error: "not_found" }))
})

const wss = new WebSocketServer({ server, path: "/voice" })

wss.on("connection", (client) => {
  const session = {
    asr: null,
    tts: null,
    asrReady: false,
    asrStarting: false,
    lastPartial: "",
    ttsPendingText: "",
    closed: false,
  }

  sendClient(client, { type: "gateway.ready", sampleRates: { asr: ASR_SAMPLE_RATE, tts: TTS_SAMPLE_RATE } })

  client.on("message", (raw) => {
    let event
    try {
      event = JSON.parse(raw.toString("utf8"))
    } catch {
      sendClient(client, { type: "error", scope: "gateway", message: "Invalid JSON message" })
      return
    }

    void handleClientEvent(client, session, event).catch((error) => {
      sendClient(client, { type: "error", scope: "gateway", message: readableError(error) })
    })
  })

  client.on("close", () => closeSession(session))
  client.on("error", () => closeSession(session))
})

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[voice-gateway] listening on ws://127.0.0.1:${PORT}/voice`)
  console.log("[voice-gateway] health check: http://127.0.0.1:" + PORT + "/health")
})

async function handleClientEvent(client, session, event) {
  switch (event.type) {
    case "asr.start":
      await startAsr(client, session)
      break
    case "asr.audio":
      if (session.asr?.readyState === WebSocket.OPEN && typeof event.audio === "string") {
        session.asr.send(JSON.stringify({ type: "input_audio_buffer.append", audio: event.audio }))
      }
      break
    case "asr.stop":
      if (session.asr?.readyState === WebSocket.OPEN) {
        session.asr.send(JSON.stringify({ type: "input_audio_buffer.commit" }))
      }
      break
    case "tts.speak":
      if (typeof event.text === "string" && event.text.trim()) {
        await speakText(client, session, event.text.trim())
      }
      break
    case "tts.stop":
      closeSocket(session.tts)
      session.tts = null
      sendClient(client, { type: "tts.done" })
      break
    case "close":
      closeSession(session)
      closeSocket(client)
      break
    default:
      sendClient(client, { type: "error", scope: "gateway", message: `Unknown event type: ${event.type}` })
  }
}

function startAsr(client, session) {
  if (session.asr?.readyState === WebSocket.OPEN) {
    sendClient(client, { type: "asr.ready" })
    return Promise.resolve()
  }
  if (session.asrStarting) return Promise.resolve()

  session.asrStarting = true
  session.asrReady = false
  session.lastPartial = ""

  return new Promise((resolvePromise) => {
    const asr = new WebSocket(ASR_URL, { headers: upstreamHeaders({ beta: true }) })
    session.asr = asr

    const finishStart = () => {
      session.asrStarting = false
      resolvePromise()
    }

    asr.on("open", () => {
      asr.send(
        JSON.stringify({
          event_id: eventId("asr_update"),
          type: "session.update",
          session: {
            modalities: ["text"],
            input_audio_format: "pcm",
            sample_rate: ASR_SAMPLE_RATE,
            turn_detection: {
              type: "server_vad",
              threshold: 0.0,
              silence_duration_ms: 600,
            },
          },
        }),
      )
      finishStart()
    })

    asr.on("message", (raw) => {
      const event = parseJson(raw)
      if (!event) return

      if (event.type === "session.created" || event.type === "session.updated") {
        session.asrReady = true
        sendClient(client, { type: "asr.ready" })
        return
      }

      const mapped = mapAsrEvent(event, session.lastPartial)
      if (!mapped) return

      if (mapped.final) {
        session.lastPartial = ""
        sendClient(client, { type: "asr.final", text: mapped.text, emotion: mapped.emotion })
      } else if (mapped.text !== session.lastPartial) {
        session.lastPartial = mapped.text
        sendClient(client, { type: "asr.partial", text: mapped.text, emotion: mapped.emotion })
      }
    })

    asr.on("error", (error) => {
      sendClient(client, { type: "error", scope: "asr", message: readableError(error) })
      finishStart()
    })

    asr.on("close", () => {
      session.asrReady = false
      session.asrStarting = false
      if (session.asr === asr) session.asr = null
    })
  })
}

function speakText(client, session, text) {
  closeSocket(session.tts)
  session.ttsPendingText = text

  return new Promise((resolvePromise) => {
    const tts = new WebSocket(TTS_URL, { headers: upstreamHeaders() })
    session.tts = tts
    let sentText = false
    let sentDone = false

    const sendText = () => {
      if (sentText || tts.readyState !== WebSocket.OPEN) return
      sentText = true
      sendClient(client, { type: "tts.started", text })
      tts.send(JSON.stringify({ event_id: eventId("tts_append"), type: "input_text_buffer.append", text }))
      tts.send(JSON.stringify({ event_id: eventId("tts_commit"), type: "input_text_buffer.commit" }))
    }

    const finishTts = () => {
      if (sentDone) return
      sentDone = true
      sendClient(client, { type: "tts.done" })
      if (tts.readyState === WebSocket.OPEN) {
        tts.send(JSON.stringify({ event_id: eventId("tts_finish"), type: "session.finish" }))
      }
    }

    tts.on("open", () => {
      tts.send(
        JSON.stringify({
          event_id: eventId("tts_update"),
          type: "session.update",
          session: {
            voice: TTS_VOICE,
            mode: "server_commit",
            language_type: "Chinese",
            response_format: "pcm",
            sample_rate: TTS_SAMPLE_RATE,
            instructions: "",
            optimize_instructions: false,
          },
        }),
      )
      resolvePromise()
    })

    tts.on("message", (raw) => {
      const event = parseJson(raw)
      if (!event) return

      if (event.type === "session.updated") {
        sendText()
        return
      }

      const audio = event.delta || event.audio || event.data?.audio || event.output?.audio
      if (event.type === "response.audio.delta" && typeof audio === "string") {
        sendClient(client, { type: "tts.audio", audio, sampleRate: TTS_SAMPLE_RATE })
        return
      }

      if (event.type === "response.audio.done" || event.type === "response.done") {
        finishTts()
        return
      }

      if (event.type === "session.finished") {
        closeSocket(tts)
      }
    })

    tts.on("error", (error) => {
      sendClient(client, { type: "error", scope: "tts", message: readableError(error) })
      resolvePromise()
    })

    tts.on("close", () => {
      if (session.tts === tts) session.tts = null
    })
  })
}

function mapAsrEvent(event, lastPartial) {
  const type = String(event.type || "")
  const text =
    firstString(
      event.text,
      event.transcript,
      event.delta,
      event.item?.content?.[0]?.transcript,
      event.item?.content?.[0]?.text,
      event.output?.text,
      event.output?.sentence?.text,
      event.payload?.output?.text,
      event.payload?.output?.sentence?.text,
      event.payload?.output?.choices?.[0]?.message?.content,
    ) || ""
  const trimmed = text.trim()
  const emotion = firstString(event.emotion, event.output?.emotion, event.payload?.output?.emotion)
  const final =
    type.includes("completed") ||
    type.includes("committed") ||
    type.includes("transcription.done") ||
    event.is_final === true ||
    event.sentence_end === true ||
    event.output?.sentence?.end === true ||
    event.payload?.output?.sentence?.end === true

  if (!trimmed && final && lastPartial) return { text: lastPartial, final: true, emotion }
  if (!trimmed) return null
  return { text: trimmed, final, emotion }
}

function upstreamHeaders({ beta = false } = {}) {
  const headers = {
    Authorization: `Bearer ${API_KEY}`,
  }
  if (WORKSPACE_ID) headers["X-DashScope-WorkSpace"] = WORKSPACE_ID
  if (beta) headers["OpenAI-Beta"] = "realtime=v1"
  return headers
}

function sendClient(client, event) {
  if (client.readyState === WebSocket.OPEN) {
    client.send(JSON.stringify(event))
  }
}

function closeSession(session) {
  if (session.closed) return
  session.closed = true
  closeSocket(session.asr)
  closeSocket(session.tts)
  session.asr = null
  session.tts = null
}

function closeSocket(socket) {
  try {
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
      socket.close()
    }
  } catch {
    // Ignore socket shutdown races.
  }
}

function parseJson(raw) {
  try {
    return JSON.parse(raw.toString("utf8"))
  } catch {
    return null
  }
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value
  }
  return ""
}

function eventId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}`
}

function readableError(error) {
  if (error instanceof Error) return error.message
  return String(error || "Unknown error")
}

function readSecret(name, b64Name) {
  const direct = process.env[name]
  if (direct && direct.trim()) return direct.trim()
  const encoded = process.env[b64Name]
  if (encoded && encoded.trim()) {
    return Buffer.from(encoded.trim(), "base64").toString("utf8").trim()
  }
  return ""
}

function loadLocalEnv(path) {
  if (!existsSync(path)) return
  const text = readFileSync(path, "utf8")
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith("#")) continue
    const equalIndex = line.indexOf("=")
    if (equalIndex < 1) continue
    const key = line.slice(0, equalIndex).trim()
    let value = line.slice(equalIndex + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (!process.env[key]) process.env[key] = value
  }
}
