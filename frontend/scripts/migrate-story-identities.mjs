import { readFile, writeFile } from "node:fs/promises"

import { normalizeIdentityContract, sanitizeIdentityText } from "../lib/scenario-identity.mjs"

const target = new URL("../data/story-variants.json", import.meta.url)
const library = JSON.parse(await readFile(target, "utf8"))

const callerOverrides = {
  "SC-04-V03": { displayName: "陈主任" },
  "SC-06-V01": { gender: "female", voiceProfile: "young-female" },
  "SC-06-V02": { gender: "male", voiceProfile: "young-male" },
  "SC-06-V03": { gender: "male", voiceProfile: "young-male" },
  "SC-12-V01": { displayName: "王强", gender: "male", voiceProfile: "adult-male" },
  "SC-12-V02": { displayName: "小李", gender: "male", voiceProfile: "adult-male" },
  "SC-12-V03": { displayName: "张主任", gender: "male", voiceProfile: "adult-male" },
}

const contentOverrides = {
  "SC-14-V01": {
    opening: "你先别挂电话。你的女儿小雪现在在我们这里。想让她平安，就按我说的做，不准报警。",
    fallbackLines: [
      "你一联系其他人，小雪的安全就无法保证。先准备模拟赎金。",
      "时间不多，不要试图核实。想让你的女儿平安，就按我说的做。",
    ],
  },
  "SC-14-V02": {
    opening: "您好，您的孙子刚出了交通事故，人现在被我们看着。想私下解决，就马上准备一笔钱。",
    fallbackLines: [
      "不处理我们就把事情闹大，您的孙子也会有麻烦。",
      "先按模拟方式交一部分，之后再让您和孙子通话。",
    ],
  },
  "SC-14-V03": {
    opening: "您好，这里是境外执法机构。您的亲属因证件问题被临时扣留，需要家属尽快办理保证手续。",
    fallbackLines: [
      "跨境案件不能通过国内号码核实，请按我们提供的模拟流程处理。",
      "您亲属的保证手续有时间限制，超时后会进入正式拘留程序。",
    ],
  },
}

library.variants = library.variants.map((variant) => {
  const overridden = { ...variant, ...(contentOverrides[variant.id] ?? {}) }
  const identityContract = normalizeIdentityContract(overridden.identityContract, overridden)
  identityContract.caller = { ...identityContract.caller, ...(callerOverrides[variant.id] ?? {}) }
  const opening = sanitizeIdentityText(overridden.opening, identityContract).text
  const fallbackLines = overridden.fallbackLines.map((line) => sanitizeIdentityText(line, identityContract).text)
  return { ...overridden, opening, fallbackLines, identityContract }
})

await writeFile(target, `${JSON.stringify(library, null, 2)}\n`, "utf8")
console.log(`Migrated ${library.variants.length} story variants with session identity contracts.`)
