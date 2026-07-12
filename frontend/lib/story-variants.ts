export { applyStoryVariant, selectStoryVariant } from "@/lib/story-variant-selector.mjs"

export interface StoryVariant {
  id: string
  scenarioCode: string
  title: string
  persona: string
  source: string
  premise: string
  objective: string
  pressureTactics: string[]
  opening: string
  fallbackLines: string[]
  enabled: boolean
  version: number
  updatedAt: string
}

export interface StoryVariantLibrary {
  version: number
  variants: StoryVariant[]
}

export interface StoryVariantValidation {
  valid: boolean
  errors: string[]
}

const SCENARIO_CODE = /^SC-(0[1-9]|1[0-4])$/u
const VARIANT_ID = /^SC-(0[1-9]|1[0-4])-V[0-9A-Z-]{2,24}$/u
const UNSAFE_CONTENT = /https?:\/\/|\bwww\.|\b1[3-9]\d{9}\b|(?:账号|账户|银行卡)\s*[：:]?\s*\d{8,}/u
const HISTORY_KEY = "oldcheat.story-variant-history.v1"

interface StoryVariantHistoryEntry {
  variantId: string
  scenarioCode: string
  startedAt: string
  completedAt?: string
  defenseScore?: number
  goodMoves?: number
  riskyMoves?: number
}

function normalized(value: unknown): string {
  return String(value ?? "").replace(/\s+/gu, " ").trim()
}

function checkText(errors: string[], label: string, value: unknown, min: number, max: number) {
  const text = normalized(value)
  if (text.length < min || text.length > max) errors.push(`${label}长度应为 ${min}-${max} 个字符。`)
  if (UNSAFE_CONTENT.test(text)) errors.push(`${label}疑似包含真实链接、手机号或长账号。`)
}

export function validateStoryVariant(value: unknown): StoryVariantValidation {
  const errors: string[] = []
  if (!value || typeof value !== "object") return { valid: false, errors: ["变体必须是对象。"] }
  const variant = value as Partial<StoryVariant>
  if (!VARIANT_ID.test(normalized(variant.id))) errors.push("变体 ID 格式应类似 SC-01-V01。")
  if (!SCENARIO_CODE.test(normalized(variant.scenarioCode))) errors.push("所属场景必须是 SC-01 至 SC-14。")
  if (variant.id && variant.scenarioCode && !variant.id.startsWith(`${variant.scenarioCode}-`)) errors.push("变体 ID 必须以所属场景编号开头。")
  checkText(errors, "标题", variant.title, 4, 40)
  checkText(errors, "人物", variant.persona, 2, 50)
  checkText(errors, "来源", variant.source, 2, 60)
  checkText(errors, "事件背景", variant.premise, 10, 240)
  checkText(errors, "诈骗目标", variant.objective, 4, 120)
  checkText(errors, "开场白", variant.opening, 10, 180)
  if (!Array.isArray(variant.pressureTactics) || variant.pressureTactics.length < 1 || variant.pressureTactics.length > 6) {
    errors.push("压力手法需要 1-6 项。")
  } else {
    variant.pressureTactics.forEach((item, index) => checkText(errors, `压力手法 ${index + 1}`, item, 2, 30))
  }
  if (!Array.isArray(variant.fallbackLines) || variant.fallbackLines.length < 1 || variant.fallbackLines.length > 12) {
    errors.push("fallback 话术需要 1-12 条。")
  } else {
    variant.fallbackLines.forEach((item, index) => checkText(errors, `fallback ${index + 1}`, item, 8, 180))
  }
  if (!Number.isInteger(variant.version) || Number(variant.version) < 1) errors.push("版本号必须是正整数。")
  if (Number.isNaN(Date.parse(normalized(variant.updatedAt)))) errors.push("更新时间必须是 ISO 8601 时间。")
  return { valid: errors.length === 0, errors }
}

export function validateStoryVariantLibrary(value: unknown): StoryVariantValidation {
  const errors: string[] = []
  if (!value || typeof value !== "object") return { valid: false, errors: ["变体库必须是对象。"] }
  const library = value as Partial<StoryVariantLibrary>
  if (!Array.isArray(library.variants)) return { valid: false, errors: ["变体库缺少 variants 数组。"] }
  const ids = new Set<string>()
  for (const variant of library.variants) {
    const validation = validateStoryVariant(variant)
    validation.errors.forEach((error) => errors.push(`${variant?.id ?? "未知变体"}: ${error}`))
    if (ids.has(variant.id)) errors.push(`${variant.id}: ID 重复。`)
    ids.add(variant.id)
  }
  return { valid: errors.length === 0, errors }
}

export function enabledVariants(variants: StoryVariant[], scenarioCode?: string): StoryVariant[] {
  return variants.filter((variant) => variant.enabled && (!scenarioCode || variant.scenarioCode === scenarioCode))
}

export function readVariantHistory(scenarioCode: string): string[] {
  if (typeof window === "undefined") return []
  try {
    return readHistoryEntries(scenarioCode).map((entry) => entry.variantId).slice(-12)
  } catch {
    return []
  }
}

function readHistoryEntries(scenarioCode: string): StoryVariantHistoryEntry[] {
  if (typeof window === "undefined") return []
  const parsed = JSON.parse(window.localStorage.getItem(HISTORY_KEY) ?? "{}") as Record<string, Array<StoryVariantHistoryEntry | string>>
  if (!Array.isArray(parsed[scenarioCode])) return []
  return parsed[scenarioCode].flatMap((entry) => {
    if (typeof entry === "string") return [{ variantId: entry, scenarioCode, startedAt: "" }]
    return entry && typeof entry.variantId === "string" ? [entry] : []
  }).slice(-12)
}

export function readWeakVariantHistory(scenarioCode: string): string[] {
  if (typeof window === "undefined") return []
  try {
    return readHistoryEntries(scenarioCode)
      .filter((entry) => typeof entry.defenseScore === "number")
      .sort((left, right) => Number(left.defenseScore) - Number(right.defenseScore))
      .map((entry) => entry.variantId)
  } catch {
    return []
  }
}

export function rememberStoryVariant(variant: StoryVariant) {
  if (typeof window === "undefined") return
  try {
    const raw = JSON.parse(window.localStorage.getItem(HISTORY_KEY) ?? "{}") as Record<string, Array<StoryVariantHistoryEntry | string>>
    const current = readHistoryEntries(variant.scenarioCode)
    const entry: StoryVariantHistoryEntry = { variantId: variant.id, scenarioCode: variant.scenarioCode, startedAt: new Date().toISOString() }
    raw[variant.scenarioCode] = [...current.filter((item) => item.variantId !== variant.id), entry].slice(-12)
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(raw))
  } catch {
    // Privacy settings may disable localStorage. Training still works with random selection.
  }
}

export function completeStoryVariant(
  variant: StoryVariant,
  metrics: { defenseScore: number; goodMoves: number; riskyMoves: number },
) {
  if (typeof window === "undefined") return
  try {
    const raw = JSON.parse(window.localStorage.getItem(HISTORY_KEY) ?? "{}") as Record<string, Array<StoryVariantHistoryEntry | string>>
    const current = readHistoryEntries(variant.scenarioCode)
    const index = current.findIndex((entry) => entry.variantId === variant.id)
    const completed: StoryVariantHistoryEntry = {
      variantId: variant.id,
      scenarioCode: variant.scenarioCode,
      startedAt: index >= 0 ? current[index].startedAt : new Date().toISOString(),
      completedAt: new Date().toISOString(),
      ...metrics,
    }
    if (index >= 0) current[index] = completed
    else current.push(completed)
    raw[variant.scenarioCode] = current.slice(-12)
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(raw))
  } catch {
    // Completion history is optional and must never block training.
  }
}
