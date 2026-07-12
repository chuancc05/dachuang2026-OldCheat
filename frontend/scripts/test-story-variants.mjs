import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { applyStoryVariant, selectStoryVariant } from "../lib/story-variant-selector.mjs"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const library = JSON.parse(fs.readFileSync(path.join(root, "data", "story-variants.json"), "utf8"))
const ids = new Set()
const unsafe = /https?:\/\/|\bwww\.|\b1[3-9]\d{9}\b|(?:账号|账户|银行卡)\s*[：:]?\s*\d{8,}/u
assert.equal(library.variants.length, 42, "14 个场景应各有 3 个种子变体")
for (let index = 1; index <= 14; index += 1) {
  const code = `SC-${String(index).padStart(2, "0")}`
  const variants = library.variants.filter((item) => item.scenarioCode === code && item.enabled)
  assert.ok(variants.length >= 3, `${code} 至少需要 3 个启用变体`)
  for (const variant of variants) {
    assert.ok(!ids.has(variant.id), `${variant.id} 重复`); ids.add(variant.id)
    for (const field of ["title", "persona", "source", "premise", "objective", "opening"]) assert.ok(String(variant[field] ?? "").trim(), `${variant.id} 缺少 ${field}`)
    assert.ok(variant.pressureTactics?.length, `${variant.id} 缺少压力手法`); assert.ok(variant.fallbackLines?.length, `${variant.id} 缺少 fallback`)
    assert.equal(unsafe.test([variant.opening, ...variant.fallbackLines].join(" ")), false, `${variant.id} 包含疑似真实敏感内容`)
  }
}
const sc01 = library.variants.filter((variant) => variant.scenarioCode === "SC-01")
assert.equal(selectStoryVariant(sc01, "SC-01", [], () => 0)?.id, "SC-01-V01", "固定随机数应得到确定结果")
assert.equal(selectStoryVariant(sc01, "SC-01", ["SC-01-V01"], () => 0)?.id, "SC-01-V02", "应优先选择未体验变体")
assert.notEqual(
  selectStoryVariant(sc01, "SC-01", ["SC-01-V01", "SC-01-V02", "SC-01-V03"], () => 0)?.id,
  "SC-01-V03",
  "全部体验后也不得立即重复上一次",
)
assert.equal(
  selectStoryVariant(sc01, "SC-01", ["SC-01-V01", "SC-01-V02", "SC-01-V03"], () => 0.99, ["SC-01-V02", "SC-01-V01"])?.id,
  "SC-01-V02",
  "全部体验后应优先复练历史得分较低的非上一变体",
)
assert.equal(selectStoryVariant([sc01[0]], "SC-01", ["SC-01-V01"], () => 0)?.id, "SC-01-V01", "单变体时应安全退化")
assert.equal(selectStoryVariant(sc01, "SC-14", [], () => 0), null, "无匹配场景时应返回 null")
const baseScenario = {
  id: "sc-01",
  code: "SC-01",
  title: "冒充公检法",
  difficulty: "高",
  channel: "phone",
  persona: "原人物",
  avatar: "警",
  source: "原来源",
  tagline: "原背景",
  method: "原手法",
  script: [{ line: "原开场", trigger: "原触发", riskDelta: 2, coach: "原建议" }],
}
const applied = applyStoryVariant(baseScenario, sc01[0])
assert.equal(applied.persona, sc01[0].persona, "会话人物必须来自锁定变体")
assert.equal(applied.tagline, sc01[0].premise, "会话背景必须来自锁定变体")
assert.equal(applied.script[0].line, sc01[0].opening, "首句必须来自锁定变体")
assert.equal(applied.script[1].line, sc01[0].fallbackLines[0], "模型失败时必须优先使用同变体 fallback")
assert.equal(applied.variant.id, sc01[0].id, "会话必须保留变体快照")
console.log("PASS 42 个故事变体结构、安全与可执行防重复门禁")
