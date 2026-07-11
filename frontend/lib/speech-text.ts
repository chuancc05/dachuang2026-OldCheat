export type SpeechTextParts = {
  speechText: string
  styleHint: string
}

const LEADING_STYLE_CUE_PATTERN = /^\s*[（(]\s*([^（）()]{2,120})\s*[）)]\s*/
const ANY_CUE_PATTERN = /[（(]\s*([^（）()]{2,160})\s*[）)]/gu
const STYLE_KEYWORDS = [
  "语气",
  "口吻",
  "语速",
  "音调",
  "声调",
  "声音",
  "低声",
  "压低",
  "严肃",
  "急促",
  "情绪",
  "情感",
  "严肃",
  "急切",
  "威胁",
  "恐吓",
  "温柔",
  "机械",
  "不耐烦",
  "压迫",
  "冷静",
  "停顿",
  "播放",
  "音效",
  "背景",
  "环境",
  "哭声",
  "哭喊",
  "求救",
  "碰撞",
  "模糊",
]

export function splitSpeechCue(rawText: string): SpeechTextParts {
  let remaining = rawText.trim()
  const cues: string[] = []

  while (remaining) {
    const match = remaining.match(LEADING_STYLE_CUE_PATTERN)
    if (!match) break

    const cue = match[1]?.trim()
    if (!cue || !looksLikeStyleCue(cue)) break

    cues.push(cue)
    remaining = remaining.slice(match[0].length).trimStart()
  }

  return {
    speechText: stripSpeechCues(remaining || rawText.trim()),
    styleHint: cues.join("；"),
  }
}

export function stripSpeechCues(rawText: string) {
  return rawText
    .replace(ANY_CUE_PATTERN, (full, cue) => (looksLikeStyleCue(String(cue || "")) ? "" : full))
    .replace(/\s+/gu, " ")
    .trim()
}

export function buildSpeechInstruction(styleHint: string) {
  const hint = styleHint.trim()
  if (!hint) return ""
  return `请按照以下表演语气朗读，但不要读出括号或提示词本身：${hint}`
}

function looksLikeStyleCue(text: string) {
  return STYLE_KEYWORDS.some((keyword) => text.includes(keyword))
}
