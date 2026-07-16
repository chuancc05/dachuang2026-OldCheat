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

function fallbackTurns(variant, scenario) {
  const original = scenario.script
  const openingTurn = original[0]
  const identityContract = normalizeIdentityContract(variant.identityContract, variant)
  const openingText = sanitizeIdentityText(variant.opening, identityContract)
  const opening = {
    line: openingText.valid ? openingText.text : "您好，请先听我说明情况。",
    trigger: variant.pressureTactics[0] ?? openingTurn?.trigger,
    riskDelta: openingTurn?.riskDelta ?? 2,
    coach: openingTurn?.coach ?? "先核实对方身份，不透露信息，不点击链接，不转账。",
  }
  const fallback = variant.fallbackLines.flatMap((line, index) => {
    const base = original[Math.min(index + 1, Math.max(original.length - 1, 0))]
    const safe = sanitizeIdentityText(line, identityContract)
    if (!safe.valid) return []
    return [{
      line: safe.text,
      trigger: variant.pressureTactics[(index + 1) % variant.pressureTactics.length] ?? base?.trigger,
      riskDelta: base?.riskDelta ?? Math.min(4.5, 2 + index * 0.4),
      coach: base?.coach ?? "遇到催促、保密或资金要求时，先挂断并通过官方渠道核实。",
    }]
  })
  return [opening, ...fallback]
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
