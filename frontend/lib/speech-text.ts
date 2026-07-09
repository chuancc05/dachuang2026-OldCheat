export type SpeechTextParts = {
  speechText: string
  styleHint: string
}

const STYLE_CUE_PATTERN = /^\s*[（(]\s*([^（）()]{2,120})\s*[）)]\s*/
const STYLE_KEYWORDS = [
  "语气",
  "口吻",
  "语速",
  "音调",
  "声调",
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
]

export function splitSpeechCue(rawText: string): SpeechTextParts {
  let remaining = rawText.trim()
  const cues: string[] = []

  while (remaining) {
    const match = remaining.match(STYLE_CUE_PATTERN)
    if (!match) break

    const cue = match[1]?.trim()
    if (!cue || !looksLikeStyleCue(cue)) break

    cues.push(cue)
    remaining = remaining.slice(match[0].length).trimStart()
  }

  return {
    speechText: remaining || rawText.trim(),
    styleHint: cues.join("；"),
  }
}

export function buildSpeechInstruction(styleHint: string) {
  const hint = styleHint.trim()
  if (!hint) return ""
  return `请按照以下表演语气朗读，但不要读出括号或提示词本身：${hint}`
}

function looksLikeStyleCue(text: string) {
  return STYLE_KEYWORDS.some((keyword) => text.includes(keyword))
}
