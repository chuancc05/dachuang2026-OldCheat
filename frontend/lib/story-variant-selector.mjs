/**
 * Select an enabled story variant while preferring unseen entries and avoiding
 * an immediate repeat after the whole pool has been visited.
 */
export function selectStoryVariant(variants, scenarioCode, recentIds = [], random = Math.random, priorityIds = []) {
  const pool = variants.filter((variant) => variant.enabled && variant.scenarioCode === scenarioCode)
  if (pool.length === 0) return null
  const unvisited = pool.filter((variant) => !recentIds.includes(variant.id))
  const previous = recentIds.at(-1)
  const candidates = unvisited.length > 0 ? unvisited : pool.filter((variant) => variant.id !== previous)
  const safeCandidates = candidates.length > 0 ? candidates : pool
  if (unvisited.length === 0 && priorityIds.length > 0) {
    const prioritized = [...safeCandidates].sort((left, right) => {
      const leftIndex = priorityIds.indexOf(left.id)
      const rightIndex = priorityIds.indexOf(right.id)
      return (leftIndex < 0 ? Number.MAX_SAFE_INTEGER : leftIndex) - (rightIndex < 0 ? Number.MAX_SAFE_INTEGER : rightIndex)
    })
    if (priorityIds.includes(prioritized[0]?.id)) return prioritized[0]
  }
  const index = Math.min(safeCandidates.length - 1, Math.max(0, Math.floor(random() * safeCandidates.length)))
  return safeCandidates[index] ?? null
}

import { normalizeIdentityContract, sanitizeIdentityText } from "./scenario-identity.mjs"

const GENERIC_ESCALATION_LINES = [
  "这件事需要您现在配合核验，先不要中断电话，按我说的步骤处理。",
  "系统记录显示这个环节有时间限制，拖延会让后续处理变得更麻烦。",
  "您先完成当前核验，后续流程我会继续说明，不需要您自己判断怎么操作。",
  "我理解您会担心，但现在最重要的是保持通话，先把这一步处理完成。",
  "如果您暂时拿不定主意，也请先不要挂断，听我把需要处理的事项说清楚。",
  "这个流程已经进入待处理状态，请您按提示继续，不要因为犹豫错过处理时间。",
  "您不用着急找资料，我会继续指导您完成核验，先保持电话畅通。",
  "现在先配合完成这一项确认，后续结果会在流程结束后再向您说明。",
]

function safeLine(value, identityContract) {
  const safe = sanitizeIdentityText(value, identityContract)
  return safe.valid ? safe.text : ""
}

function fallbackTurns(variant, scenario) {
  const original = Array.isArray(scenario.script) ? scenario.script : []
  const openingTurn = original[0]
  const identityContract = normalizeIdentityContract(variant.identityContract, variant)
  const targetTurns = Math.max(original.length, 6)
  const openingText = safeLine(variant.opening, identityContract)
  const opening = {
    line: openingText || "您好，请先听我说明情况。",
    trigger: variant.pressureTactics[0] ?? openingTurn?.trigger,
    riskDelta: openingTurn?.riskDelta ?? 2,
    coach: openingTurn?.coach ?? "先核实对方身份，不透露信息，不点击链接，不转账。",
  }
  const candidates = [
    ...(variant.fallbackLines ?? []),
    ...original.slice(1).map((turn) => turn?.line),
    ...GENERIC_ESCALATION_LINES,
  ].map((line) => safeLine(line, identityContract)).filter(Boolean)

  const turns = [opening]
  for (let index = 1; index < targetTurns; index += 1) {
    const base = original[index] ?? original[original.length - 1]
    const line = candidates[(index - 1) % Math.max(candidates.length, 1)]
      || GENERIC_ESCALATION_LINES[(index - 1) % GENERIC_ESCALATION_LINES.length]
    turns.push({
      line,
      trigger: variant.pressureTactics[index % Math.max(variant.pressureTactics.length, 1)] ?? base?.trigger,
      riskDelta: base?.riskDelta ?? Math.min(4.5, 2 + index * 0.4),
      coach: base?.coach ?? "遇到催促、保密或资金要求时，先挂断并通过官方渠道核实。",
    })
  }
  return turns
}

export function applyStoryVariant(scenario, variant) {
  return {
    ...scenario,
    persona: variant.persona,
    source: variant.source,
    tagline: variant.premise,
    method: Array.from(new Set([...variant.pressureTactics, scenario.method])).join(" + "),
    script: fallbackTurns(variant, scenario),
    variant: {
      ...variant,
      pressureTactics: [...variant.pressureTactics],
      fallbackLines: [...variant.fallbackLines],
      identityContract: normalizeIdentityContract(variant.identityContract, variant),
    },
  }
}
