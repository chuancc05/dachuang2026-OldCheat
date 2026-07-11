import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const output = resolve(here, "..", "public", "audio-cues")
const sampleRate = 24000

mkdirSync(output, { recursive: true })

function clamp(value) {
  return Math.max(-1, Math.min(1, value))
}

function writeWav(name, seconds, sample) {
  const count = Math.floor(sampleRate * seconds)
  const pcm = Buffer.alloc(count * 2)
  for (let index = 0; index < count; index += 1) {
    pcm.writeInt16LE(Math.round(clamp(sample(index / sampleRate, index, count)) * 32767), index * 2)
  }
  const header = Buffer.alloc(44)
  header.write("RIFF", 0)
  header.writeUInt32LE(36 + pcm.length, 4)
  header.write("WAVEfmt ", 8)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(sampleRate * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write("data", 36)
  header.writeUInt32LE(pcm.length, 40)
  writeFileSync(resolve(output, name), Buffer.concat([header, pcm]))
}

function envelope(t, seconds, attack = 0.02, release = 0.12) {
  if (t < attack) return t / attack
  if (t > seconds - release) return Math.max(0, (seconds - t) / release)
  return 1
}

function seededNoise(index) {
  const value = Math.sin(index * 12.9898 + 78.233) * 43758.5453
  return (value - Math.floor(value)) * 2 - 1
}

writeWav("line-noise.wav", 0.62, (t, index) => 0.025 * seededNoise(index) * envelope(t, 0.62))
writeWav("phone-noise.wav", 0.85, (t, index) => {
  const tone = Math.sin(2 * Math.PI * 180 * t) * 0.02
  return (tone + seededNoise(index) * 0.035) * envelope(t, 0.85, 0.03, 0.16)
})
writeWav("notification.wav", 0.34, (t) => {
  const active = t < 0.11 || (t > 0.17 && t < 0.3)
  const phase = t < 0.11 ? t : t - 0.17
  return active ? Math.sin(2 * Math.PI * 880 * phase) * 0.11 * envelope(phase, 0.13, 0.01, 0.06) : 0
})
writeWav("task-chime.wav", 0.52, (t) => {
  const first = Math.sin(2 * Math.PI * 660 * t) * 0.08 * envelope(t, 0.18, 0.01, 0.1)
  const secondTime = Math.max(0, t - 0.16)
  const second = t > 0.16 ? Math.sin(2 * Math.PI * 880 * secondTime) * 0.08 * envelope(secondTime, 0.28, 0.01, 0.18) : 0
  return first + second
})
writeWav("signal-glitch.wav", 0.45, (t, index) => (Math.sin(2 * Math.PI * 440 * t) * 0.035 + seededNoise(index) * 0.04) * envelope(t, 0.45, 0.01, 0.12))
writeWav("service-connect.wav", 0.4, (t) => Math.sin(2 * Math.PI * 520 * t) * 0.07 * envelope(t, 0.4, 0.01, 0.18))
writeWav("soft-alert.wav", 0.45, (t) => Math.sin(2 * Math.PI * 300 * t) * 0.07 * envelope(t, 0.45, 0.02, 0.2))
writeWav("urgent-breath.wav", 0.8, (t, index) => seededNoise(index) * 0.035 * (0.45 + 0.55 * Math.sin(2 * Math.PI * 2.4 * t) ** 2) * envelope(t, 0.8, 0.05, 0.18))
writeWav("bank-office.wav", 0.7, (t) => {
  const pulse = Math.sin(2 * Math.PI * 6.8 * t) > 0.92 ? 0.045 : 0
  return pulse * Math.sin(2 * Math.PI * 1200 * t) * envelope(t, 0.7, 0.02, 0.12)
})
writeWav("muffled-impact.wav", 0.36, (t, index) => {
  const low = Math.sin(2 * Math.PI * 82 * t) * Math.exp(-t * 13) * 0.16
  return (low + seededNoise(index) * Math.exp(-t * 21) * 0.045) * envelope(t, 0.36, 0.004, 0.2)
})

console.log(`Generated procedural audio cues in ${output}`)
