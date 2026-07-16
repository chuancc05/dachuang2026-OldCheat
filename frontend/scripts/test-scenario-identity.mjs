import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"

import {
  findIdentityConflicts,
  findReportIdentityConflicts,
  identityPromptLines,
  normalizeIdentityContract,
  sanitizeIdentityText,
  sanitizeRagContextForIdentity,
} from "../lib/scenario-identity.mjs"
import { applyStoryVariant } from "../lib/story-variant-selector.mjs"

const library = JSON.parse(
  await readFile(new URL("../data/story-variants.json", import.meta.url), "utf8"),
)

const byId = (id) => library.variants.find((variant) => variant.id === id)

const sc13 = byId("SC-13-V03")
assert.ok(sc13, "SC-13-V03 must exist")
const sc13Identity = normalizeIdentityContract(sc13.identityContract, sc13)
assert.equal(sc13Identity.trainee.gender, "unknown")
assert.equal(sc13Identity.trainee.address, "您")
assert.deepEqual(
  findIdentityConflicts("叔叔您好，您的账户需要核实。", sc13Identity),
  ["叔叔"],
  "unknown-gender trainee must reject gendered address",
)
assert.equal(
  sanitizeIdentityText("叔叔您好，您的账户需要核实。", sc13Identity).text,
  "您好，您的账户需要核实。",
)

const sc14v1 = byId("SC-14-V01")
assert.ok(sc14v1, "SC-14-V01 must exist")
const daughterIdentity = normalizeIdentityContract(sc14v1.identityContract, sc14v1)
assert.equal(daughterIdentity.subject.relation, "女儿")
assert.equal(daughterIdentity.subject.name, "小雪")
assert.equal(daughterIdentity.distressCue?.enabled, true)
assert.equal(daughterIdentity.distressCue?.text, "救救我……我好害怕……")
assert.deepEqual(findIdentityConflicts("你儿子现在在我们手上。", daughterIdentity), ["儿子"])
assert.deepEqual(
  findReportIdentityConflicts("建议家人陪同复盘，并参考下方建议继续训练。", daughterIdentity),
  [],
  "report may use generic family and guidance wording",
)
assert.deepEqual(
  findReportIdentityConflicts("建议您联系儿子一起核实。", daughterIdentity),
  ["儿子"],
  "report must still reject a changed specific relative",
)
assert.ok(identityPromptLines(daughterIdentity).join("\n").includes("女儿小雪"))

const rag = {
  mode: "vector",
  provider: "dashscope",
  references: [{
    id: "case-1",
    text: "骗子谎称外甥被扣留，要求立即转账。",
    source: "TeleAntiFraud",
    score: 0.91,
    tags: ["绑架勒索"],
  }],
}
const safeRag = sanitizeRagContextForIdentity(rag, daughterIdentity)
assert.equal(findIdentityConflicts(JSON.stringify(safeRag), daughterIdentity).length, 0)
assert.ok(JSON.stringify(safeRag).includes("案例对象"), "conflicting RAG identity should be generalized")
assert.equal(JSON.stringify(safeRag).includes("外甥"), false)
assert.deepEqual(
  findIdentityConflicts("你侄女现在在我们手上。", daughterIdentity),
  ["侄女"],
  "unexpected relative relations must be rejected even when not manually listed",
)

const callerConflict = {
  ...daughterIdentity,
  caller: { ...daughterIdentity.caller, displayName: "王强" },
}
assert.deepEqual(
  findIdentityConflicts("我是小陈，你先别挂电话。", callerConflict),
  ["小陈"],
  "a self-introduced caller name must match the locked caller",
)
const callerSafeRag = sanitizeRagContextForIdentity({
  ...rag,
  references: [{ ...rag.references[0], text: "我是小陈，您阿姨的账户需要核验。" }],
}, callerConflict)
assert.equal(findIdentityConflicts(JSON.stringify(callerSafeRag), callerConflict).length, 0)
assert.ok(callerSafeRag.references[0].text.includes("来电人"))
assert.equal(callerSafeRag.references[0].text.includes("阿姨"), false)

const baseScenario = {
  id: "sc-14",
  code: "SC-14",
  title: "绑架勒索诈骗",
  difficulty: "高",
  channel: "phone",
  persona: "原人物",
  avatar: "急",
  source: "原来源",
  tagline: "原背景",
  method: "原手法",
  script: [
    { line: "你外甥在我手上。", trigger: "原触发", riskDelta: 2, coach: "原建议" },
    { line: "你儿子已经受伤。", trigger: "原触发2", riskDelta: 3, coach: "原建议2" },
  ],
}
const applied = applyStoryVariant(baseScenario, sc14v1)
assert.equal(applied.variant.identityContract.subject.name, "小雪")
assert.equal(applied.script.length, 6, "story variant must keep at least six recommended turns")
for (let index = 0; index < applied.script.length * 3; index += 1) {
  const line = applied.script[index % applied.script.length].line
  assert.equal(
    findIdentityConflicts(line, daughterIdentity).length,
    0,
    `fallback turn ${index + 1} must stay inside the locked identity`,
  )
}
assert.equal(
  applied.script.some((turn) => turn.line.includes("外甥") || turn.line.includes("儿子")),
  false,
  "variant fallback must never append unmanaged base script identity",
)

const sc14v2 = byId("SC-14-V02")
const grandsonIdentity = normalizeIdentityContract(sc14v2.identityContract, sc14v2)
assert.equal(grandsonIdentity.subject.relation, "孙子")
assert.equal(grandsonIdentity.distressCue?.enabled, false)
assert.equal(grandsonIdentity.distressCue?.fallbackMode, "ambient-only")

const sc14v3 = byId("SC-14-V03")
const relativeIdentity = normalizeIdentityContract(sc14v3.identityContract, sc14v3)
assert.equal(relativeIdentity.subject.relation, "亲属")
assert.equal(relativeIdentity.subject.gender, "unknown")
assert.equal(relativeIdentity.distressCue?.enabled, false)
assert.deepEqual(findIdentityConflicts("他现在被境外警方扣留。", relativeIdentity), ["他"])
assert.deepEqual(findIdentityConflicts("她现在被境外警方扣留。", relativeIdentity), ["她"])
assert.equal(findIdentityConflicts("您的亲属目前被境外警方扣留。", relativeIdentity).length, 0)

console.log("PASS scenario identity contract, RAG isolation, and safe fallback tests")
