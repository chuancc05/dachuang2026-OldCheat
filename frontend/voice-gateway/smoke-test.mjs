import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"
import { WebSocket, WebSocketServer } from "ws"

const gatewayPort = 18787
const asrPort = 18788
const ttsPort = 18789
const gatewayPath = fileURLToPath(new URL("./server.mjs", import.meta.url))
const asrServer = new WebSocketServer({ port: asrPort })
const ttsServer = new WebSocketServer({ port: ttsPort })
let asrConfig = null
let ttsConnections = 0

asrServer.on("connection", (socket) => {
  socket.on("message", (raw) => {
    const event = JSON.parse(raw.toString("utf8"))
    if (event.type !== "session.update") return
    asrConfig = event.session
    socket.send(JSON.stringify({ type: "session.updated", session: event.session }))
  })
})

ttsServer.on("connection", (socket) => {
  ttsConnections += 1
  socket.on("message", (raw) => {
    const event = JSON.parse(raw.toString("utf8"))
    if (event.type === "session.update") {
      socket.send(JSON.stringify({ type: "session.updated", session: event.session }))
      return
    }
    if (event.type === "input_text_buffer.commit") {
      const audio = Buffer.from(new Int16Array([0, 1200, -1200, 0]).buffer).toString("base64")
      socket.send(JSON.stringify({ type: "response.audio.delta", delta: audio }))
      socket.send(JSON.stringify({ type: "response.audio.done" }))
    }
  })
})

const gateway = spawn(process.execPath, [gatewayPath], {
  env: {
    ...process.env,
    NODE_ENV: "development",
    VOICE_GATEWAY_PORT: String(gatewayPort),
    VOICE_GATEWAY_HOST: "127.0.0.1",
    DASHSCOPE_API_KEY: "test-only-key",
    DASHSCOPE_ASR_WS_URL: `ws://127.0.0.1:${asrPort}`,
    DASHSCOPE_TTS_WS_URL: `ws://127.0.0.1:${ttsPort}`,
    VOICE_ASR_VAD_THRESHOLD: "0.2",
    VOICE_ASR_SILENCE_DURATION_MS: "400",
  },
  stdio: ["ignore", "pipe", "pipe"],
})

try {
  await waitForOutput(gateway.stdout, "listening on")
  const client = new WebSocket(`ws://127.0.0.1:${gatewayPort}/voice`)
  const inbox = createInbox(client)
  await new Promise((resolve, reject) => {
    client.once("open", resolve)
    client.once("error", reject)
  })

  const ready = await inbox.waitFor((event) => event.type === "gateway.ready")
  assert.equal(ready.capabilities?.protocolVersion, 2)
  assert.equal(ready.capabilities?.ttsPrewarm, true)

  client.send(JSON.stringify({ type: "asr.start" }))
  await inbox.waitFor((event) => event.type === "asr.ready")
  assert.equal(asrConfig?.turn_detection?.threshold, 0.2)
  assert.equal(asrConfig?.turn_detection?.silence_duration_ms, 400)

  client.send(JSON.stringify({ type: "tts.prepare", voice: "Cherry" }))
  await inbox.waitFor((event) => event.type === "tts.ready")

  for (const utteranceId of ["utterance_one", "utterance_two"]) {
    client.send(JSON.stringify({ type: "tts.speak", utteranceId, text: "测试语音", voice: "Cherry" }))
    const audio = await inbox.waitFor((event) => event.type === "tts.audio" && event.utteranceId === utteranceId)
    const done = await inbox.waitFor((event) => event.type === "tts.done" && event.utteranceId === utteranceId)
    assert.ok(audio.audio)
    assert.equal(done.utteranceId, utteranceId)
  }

  assert.equal(ttsConnections, 1, "TTS should reuse one upstream WebSocket across turns")
  client.close()
  console.log("voice gateway smoke test passed")
} finally {
  gateway.kill()
  await Promise.all([closeServer(asrServer), closeServer(ttsServer)])
}

function createInbox(socket) {
  const events = []
  const waiters = []

  socket.on("message", (raw) => {
    const event = JSON.parse(raw.toString("utf8"))
    const waiterIndex = waiters.findIndex((waiter) => waiter.predicate(event))
    if (waiterIndex >= 0) {
      const [waiter] = waiters.splice(waiterIndex, 1)
      clearTimeout(waiter.timer)
      waiter.resolve(event)
      return
    }
    events.push(event)
  })

  return {
    waitFor(predicate, timeoutMs = 5000) {
      const eventIndex = events.findIndex(predicate)
      if (eventIndex >= 0) return Promise.resolve(events.splice(eventIndex, 1)[0])
      return new Promise((resolve, reject) => {
        const waiter = { predicate, resolve, timer: null }
        waiter.timer = setTimeout(() => {
          const index = waiters.indexOf(waiter)
          if (index >= 0) waiters.splice(index, 1)
          reject(new Error("Timed out waiting for gateway event"))
        }, timeoutMs)
        waiters.push(waiter)
      })
    },
  }
}

function waitForOutput(stream, expected, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    let output = ""
    const timer = setTimeout(() => reject(new Error(`Gateway did not start: ${output}`)), timeoutMs)
    stream.on("data", (chunk) => {
      output += chunk.toString("utf8")
      if (!output.includes(expected)) return
      clearTimeout(timer)
      resolve()
    })
  })
}

function closeServer(server) {
  return new Promise((resolve) => server.close(resolve))
}
