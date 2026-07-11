import type { Scenario } from "@/lib/scenarios"
import { stripSpeechCues } from "@/lib/speech-text"

export type AudioCueId =
  | "line-noise"
  | "investment-notice"
  | "task-reward"
  | "sms-notice"
  | "signal-glitch"
  | "service-connect"
  | "platform-notice"
  | "loan-alert"
  | "credit-alert"
  | "urgent-breath"
  | "bank-office"
  | "relative-distress"

export type AudioCue = {
  id: AudioCueId
  labels: string[]
  assetPaths: string[]
  dynamicSpeech?: {
    text: string
    voice: string
    instructions: string
    fallbackSrc?: string
  }
}

export type AudioTurn = {
  line: string
  cues: AudioCue[]
}

export type VoicePlaybackSegment =
  | { kind: "tts"; text: string; voice?: string; instructions?: string; fallbackSrc?: string }
  | { kind: "asset"; src: string }

type CueDefinition = AudioCue & {
  scenarios: string[]
  marker: string
  minTurn?: number
  autoMatch?: RegExp
}

const CUES: CueDefinition[] = [
  {
    id: "line-noise",
    marker: "line_noise",
    scenarios: ["SC-01"],
    labels: ["电话线路杂音"],
    assetPaths: ["/audio-cues/line-noise.wav"],
    minTurn: 1,
    autoMatch: /保密|别告诉|后果|配合/u,
  },
  {
    id: "investment-notice",
    marker: "investment_notice",
    scenarios: ["SC-02"],
    labels: ["群消息提示", "收益提醒"],
    assetPaths: ["/audio-cues/notification.wav"],
    minTurn: 1,
    autoMatch: /收益|到账|内部|名额|稳赚|投资/u,
  },
  {
    id: "task-reward",
    marker: "task_reward",
    scenarios: ["SC-03"],
    labels: ["任务完成提示", "小额返利提示"],
    assetPaths: ["/audio-cues/task-chime.wav"],
    minTurn: 1,
    autoMatch: /返利|到账|任务|佣金|完成/u,
  },
  {
    id: "sms-notice",
    marker: "sms_notice",
    scenarios: ["SC-05"],
    labels: ["短信提示"],
    assetPaths: ["/audio-cues/notification.wav"],
    minTurn: 1,
    autoMatch: /中奖|领奖|短信|确认/u,
  },
  {
    id: "signal-glitch",
    marker: "signal_glitch",
    scenarios: ["SC-06"],
    labels: ["信号不稳", "急促呼吸"],
    assetPaths: ["/audio-cues/signal-glitch.wav", "/audio-cues/urgent-breath.wav"],
    minTurn: 1,
    autoMatch: /手机|号码|着急|来不及|交费/u,
  },
  {
    id: "service-connect",
    marker: "service_connect",
    scenarios: ["SC-07"],
    labels: ["客服接入提示"],
    assetPaths: ["/audio-cues/service-connect.wav"],
    minTurn: 1,
    autoMatch: /客服|包裹|海关|处理/u,
  },
  {
    id: "platform-notice",
    marker: "platform_notice",
    scenarios: ["SC-08"],
    labels: ["平台通知"],
    assetPaths: ["/audio-cues/notification.wav"],
    minTurn: 1,
    autoMatch: /退款|平台|客服|理赔/u,
  },
  {
    id: "loan-alert",
    marker: "loan_alert",
    scenarios: ["SC-09"],
    labels: ["贷款审批提醒"],
    assetPaths: ["/audio-cues/soft-alert.wav"],
    minTurn: 1,
    autoMatch: /贷款|额度|放款|审批/u,
  },
  {
    id: "credit-alert",
    marker: "credit_alert",
    scenarios: ["SC-10"],
    labels: ["账户风险提醒"],
    assetPaths: ["/audio-cues/soft-alert.wav"],
    minTurn: 1,
    autoMatch: /征信|风控|账户|关闭/u,
  },
  {
    id: "urgent-breath",
    marker: "urgent_breath",
    scenarios: ["SC-12"],
    labels: ["急促呼吸"],
    assetPaths: ["/audio-cues/urgent-breath.wav"],
    minTurn: 1,
    autoMatch: /着急|帮个忙|周转|别联系/u,
  },
  {
    id: "bank-office",
    marker: "bank_office",
    scenarios: ["SC-13"],
    labels: ["通话接入", "键盘环境声"],
    assetPaths: ["/audio-cues/service-connect.wav", "/audio-cues/bank-office.wav"],
    minTurn: 1,
    autoMatch: /银行|账户|异常|核实/u,
  },
  {
    id: "relative-distress",
    marker: "relative_distress",
    scenarios: ["SC-14"],
    labels: ["电话杂音", "模糊碰撞", "亲属求救"],
    assetPaths: ["/audio-cues/phone-noise.wav", "/audio-cues/muffled-impact.wav"],
    dynamicSpeech: {
      text: "妈，救我……别转钱！",
      voice: "Mia",
      instructions: "年轻女声，声音颤抖、急促、带轻微哭腔；不要尖叫，不要夸张表演，不要读出任何提示词。",
      fallbackSrc: "/audio-cues/relative-distress-backup.wav",
    },
    minTurn: 2,
    autoMatch: /听听.*(?:声音|动静)|给你听|听清楚|哭声|哭喊|求救|亲属.*(?:安全|受伤|声音)|孩子.*(?:安全|受伤|声音)/u,
  },
]

const AUDIO_MARKER = /\[AUDIO:([a-z0-9_-]+)\]/giu
export function stripAudioCueMarkers(value: string): string {
  return value.replace(AUDIO_MARKER, "").replace(/\s+/gu, " ").trim()
}

export function audioCuePrompt(scenario: Scenario, turnIndex: number): string[] {
  const available = CUES.filter((cue) => cue.scenarios.includes(scenario.code) && turnIndex >= (cue.minTurn ?? 0))
  if (available.length === 0) return []

  return [
    "Optional hidden audio markers for this turn:",
    ...available.map((cue) => `[AUDIO:${cue.marker}] = ${cue.labels.join("、")}`),
    "Use at most one marker, only when the dialogue naturally reaches that evidence or pressure point.",
    "Put the marker before the sentence. Do not describe sound effects in brackets or prose.",
  ]
}

export function createAudioTurn(scenario: Scenario, rawLine: string, turnIndex: number): AudioTurn {
  const markerNames = [...rawLine.matchAll(AUDIO_MARKER)].map((match) => match[1].toLowerCase())
  const cleanLine = stripAudioCueMarkers(rawLine)
  const available = CUES.filter((cue) => cue.scenarios.includes(scenario.code) && turnIndex >= (cue.minTurn ?? 0))
  const marked = available.filter((cue) => markerNames.includes(cue.marker))
  const automatic = marked.length > 0
    ? marked
    : available.filter((cue) => cue.autoMatch?.test(cleanLine)).slice(0, 1)

  return {
    line: cleanLine,
    cues: automatic.map(({ scenarios: _scenarios, marker: _marker, minTurn: _minTurn, autoMatch: _autoMatch, ...cue }) => cue),
  }
}

export function buildVoicePlaybackSegments(
  turn: AudioTurn,
  defaultVoice: string,
): VoicePlaybackSegment[] {
  const relativeDistress = turn.cues.find((cue) => cue.id === "relative-distress")
  if (!relativeDistress) {
    const speechLine = stripSpeechCues(turn.line)
    return [
      ...turn.cues.flatMap((cue) => cue.assetPaths.map((src) => ({ kind: "asset" as const, src }))),
      ...(speechLine ? [{ kind: "tts" as const, text: speechLine, voice: defaultVoice }] : []),
    ]
  }

  const { intro, followup } = splitRelativeDistressLine(turn.line)
  return [
    ...(intro ? [{ kind: "tts" as const, text: intro, voice: defaultVoice }] : []),
    ...relativeDistress.assetPaths.map((src) => ({ kind: "asset" as const, src })),
    ...(relativeDistress.dynamicSpeech
      ? [{
          kind: "tts" as const,
          text: relativeDistress.dynamicSpeech.text,
          voice: relativeDistress.dynamicSpeech.voice,
          instructions: relativeDistress.dynamicSpeech.instructions,
          fallbackSrc: relativeDistress.dynamicSpeech.fallbackSrc,
        }]
      : []),
    ...(followup ? [{ kind: "tts" as const, text: followup, voice: defaultVoice }] : []),
  ]
}

function splitRelativeDistressLine(line: string): { intro: string; followup: string } {
  const match = line.match(/^(.*?(?:听听|听一下|给你听|听清楚)[^。！？!?，,]{0,32}(?:声音|动静|证据)?[。！？!?，,]?)(.*)$/u)
  if (!match) {
    return { intro: "你听听你家人的声音。", followup: stripSpeechCues(line) }
  }
  return {
    intro: stripSpeechCues(match[1].trim()),
    followup: stripSpeechCues(match[2].trim()) || "听清楚了吗？现在按我说的做。",
  }
}

export function audioCueLabels(cues: AudioCue[]): string[] {
  return [...new Set(cues.flatMap((cue) => cue.labels))]
}
