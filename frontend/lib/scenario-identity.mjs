const GENDERS = new Set(["unknown", "female", "male"])
const AGE_GROUPS = new Set(["unknown", "young", "adult", "senior"])
const SUBJECT_KINDS = new Set(["account", "relative", "event"])
const FALLBACK_MODES = new Set(["speech", "ambient-only", "skip"])

const RELATION_TERMS = [
  "女儿", "儿子", "孙子", "孙女", "外甥", "外甥女", "侄子", "侄女",
  "父亲", "母亲", "爸爸", "妈妈", "妻子", "丈夫", "老伴", "姐姐", "妹妹",
  "哥哥", "弟弟", "孩子", "家人", "亲属",
]

const KNOWN_CALLER_NAMES = [
  "小王", "小李", "小张", "小赵", "小陈", "小军", "李华", "王强", "阿强",
  "陈主任", "张主任",
]

const FEMALE_VOICES = new Set(["Mia", "Cherry", "Maia", "Serena"])
const MALE_VOICES = new Set(["Kai", "Moon", "Neil", "Ethan", "Vincent"])

export const UNKNOWN_TRAINEE_FORBIDDEN_TERMS = [
  "叔叔",
  "阿姨",
  "先生",
  "女士",
  "大哥",
  "大姐",
  "爷爷",
  "奶奶",
  "妈妈",
  "爸爸",
]

const SC14_DEFAULTS = {
  "SC-14-V01": {
    subject: {
      kind: "relative",
      relation: "女儿",
      name: "小雪",
      gender: "female",
      ageGroup: "young",
      aliases: ["小雪", "女儿", "您的女儿", "她"],
    },
    forbiddenTerms: ["儿子", "外甥", "孙子", "孩子他爸", "小军", "小陈", "王强", "妈", "爸"],
    distressCue: {
      enabled: true,
      text: "救救我……我好害怕……",
      voice: "Mia",
      instructions: "年轻女声，声音颤抖、急促、带轻微哭腔；不要尖叫，不要夸张表演，不要读出任何提示词。",
      fallbackMode: "speech",
    },
  },
  "SC-14-V02": {
    subject: {
      kind: "relative",
      relation: "孙子",
      gender: "male",
      ageGroup: "young",
      aliases: ["孙子", "您的孙子", "他"],
    },
    forbiddenTerms: ["女儿", "儿子", "外甥", "小雪", "她", "妈", "爸"],
    distressCue: { enabled: false, fallbackMode: "ambient-only" },
  },
  "SC-14-V03": {
    subject: {
      kind: "relative",
      relation: "亲属",
      gender: "unknown",
      ageGroup: "unknown",
      aliases: ["亲属", "您的亲属"],
    },
    forbiddenTerms: ["女儿", "儿子", "外甥", "孙子", "小雪", "小军", "他", "她", "妈", "爸"],
    distressCue: { enabled: false, fallbackMode: "ambient-only" },
  },
}

function stringValue(value) {
  return String(value ?? "").replace(/\s+/gu, " ").trim()
}

function stringArray(value) {
  if (!Array.isArray(value)) return []
  return [...new Set(value.map(stringValue).filter(Boolean))]
}

function enumValue(value, allowed, fallback) {
  const normalized = stringValue(value)
  return allowed.has(normalized) ? normalized : fallback
}

function legacyDefaults(variant = {}) {
  const special = SC14_DEFAULTS[variant.id] ?? {}
  return {
    version: 1,
    trainee: { gender: "unknown", address: "您" },
    caller: {
      role: stringValue(variant.persona) || "诈骗情境来电人",
      displayName: "",
      gender: "unknown",
      voiceProfile: "scenario-default",
    },
    subject: {
      kind: "event",
      relation: "",
      name: "",
      gender: "unknown",
      ageGroup: "unknown",
      aliases: [],
      ...(special.subject ?? {}),
    },
    forbiddenTerms: [...UNKNOWN_TRAINEE_FORBIDDEN_TERMS, ...(special.forbiddenTerms ?? [])],
    ...(special.distressCue ? { distressCue: special.distressCue } : {}),
  }
}

export function normalizeIdentityContract(value, variant = {}) {
  const source = value && typeof value === "object" ? value : {}
  const defaults = legacyDefaults(variant)
  const trainee = source.trainee && typeof source.trainee === "object" ? source.trainee : {}
  const caller = source.caller && typeof source.caller === "object" ? source.caller : {}
  const subject = source.subject && typeof source.subject === "object" ? source.subject : {}
  const distress = source.distressCue && typeof source.distressCue === "object"
    ? source.distressCue
    : defaults.distressCue

  const normalized = {
    version: Number.isInteger(source.version) && source.version > 0 ? source.version : 1,
    trainee: {
      gender: enumValue(trainee.gender, GENDERS, defaults.trainee.gender),
      address: stringValue(trainee.address) || defaults.trainee.address,
    },
    caller: {
      role: stringValue(caller.role) || defaults.caller.role,
      displayName: stringValue(caller.displayName) || defaults.caller.displayName,
      gender: enumValue(caller.gender, GENDERS, defaults.caller.gender),
      voiceProfile: stringValue(caller.voiceProfile) || defaults.caller.voiceProfile,
    },
    subject: {
      kind: enumValue(subject.kind, SUBJECT_KINDS, defaults.subject.kind),
      relation: stringValue(subject.relation) || defaults.subject.relation,
      name: stringValue(subject.name) || defaults.subject.name,
      gender: enumValue(subject.gender, GENDERS, defaults.subject.gender),
      ageGroup: enumValue(subject.ageGroup, AGE_GROUPS, defaults.subject.ageGroup),
      aliases: stringArray(subject.aliases).length ? stringArray(subject.aliases) : stringArray(defaults.subject.aliases),
    },
    forbiddenTerms: [...new Set([
      ...(enumValue(trainee.gender, GENDERS, defaults.trainee.gender) === "unknown" ? UNKNOWN_TRAINEE_FORBIDDEN_TERMS : []),
      ...stringArray(defaults.forbiddenTerms),
      ...stringArray(source.forbiddenTerms),
    ])],
  }

  if (distress) {
    normalized.distressCue = {
      enabled: distress.enabled === true,
      text: stringValue(distress.text),
      voice: stringValue(distress.voice),
      instructions: stringValue(distress.instructions),
      fallbackMode: enumValue(distress.fallbackMode, FALLBACK_MODES, distress.enabled === true ? "speech" : "ambient-only"),
    }
  }
  return normalized
}

export function validateIdentityContract(value, variant = {}) {
  const errors = []
  if (!value || typeof value !== "object") {
    return { valid: false, errors: ["缺少身份契约。"] }
  }
  const contract = normalizeIdentityContract(value, variant)
  if (!contract.caller.role) errors.push("来电人角色不能为空。")
  if (contract.trainee.gender === "unknown" && contract.trainee.address !== "您") {
    errors.push("受训者性别未知时默认称谓必须为“您”。")
  }
  if (contract.subject.kind === "relative" && !contract.subject.relation) {
    errors.push("亲属事件必须声明单一关系。")
  }
  if (contract.subject.kind === "relative" && variant.opening) {
    const opening = stringValue(variant.opening)
    if (!contract.subject.aliases.some((alias) => opening.includes(alias))) {
      errors.push("亲属场景开场白必须使用身份契约允许的单一称呼。")
    }
  }
  if (contract.subject.name && !contract.subject.aliases.includes(contract.subject.name)) {
    errors.push("事件对象姓名必须包含在允许称呼中。")
  }
  if (contract.distressCue?.enabled) {
    if (!contract.distressCue.text) errors.push("启用求救人声时必须提供文本。")
    if (!contract.distressCue.voice) errors.push("启用求救人声时必须提供音色。")
    if (contract.distressCue.fallbackMode !== "speech") errors.push("启用求救人声时降级模式必须为 speech。")
    if (contract.subject.gender === "female" && MALE_VOICES.has(contract.distressCue.voice)) {
      errors.push("女性事件对象不能使用男性求救音色。")
    }
    if (contract.subject.gender === "male" && FEMALE_VOICES.has(contract.distressCue.voice)) {
      errors.push("男性事件对象不能使用女性求救音色。")
    }
  }
  const identityTexts = [
    variant.opening,
    ...(Array.isArray(variant.fallbackLines) ? variant.fallbackLines : []),
  ].filter(Boolean)
  for (const text of identityTexts) {
    const conflicts = findIdentityConflicts(text, contract)
    if (conflicts.length) errors.push(`话术包含身份冲突词：${conflicts.join("、")}`)
  }
  return { valid: errors.length === 0, errors, contract }
}

function containsTerm(text, term) {
  if (term === "他") return text.replaceAll("其他", "").includes(term)
  return text.includes(term)
}

function unexpectedRelationTerms(text, contract) {
  if (contract.subject.kind !== "relative") return []
  const allowedText = [
    contract.subject.relation,
    contract.subject.name,
    ...contract.subject.aliases,
  ].join(" ")
  return RELATION_TERMS.filter((term) => containsTerm(text, term) && !allowedText.includes(term))
}

function unexpectedCallerNames(text, contract) {
  const expected = contract.caller.displayName
  if (!expected || !/(?:我是|我叫|这里是|这边是|来自)/u.test(text.slice(0, 80))) return []
  return KNOWN_CALLER_NAMES.filter((name) => name !== expected && text.slice(0, 80).includes(name))
}

export function findIdentityConflicts(value, contractValue) {
  const text = stringValue(value)
  if (!text) return []
  const contract = normalizeIdentityContract(contractValue)
  return [...new Set([
    ...contract.forbiddenTerms.filter((term) => containsTerm(text, term)),
    ...unexpectedRelationTerms(text, contract),
    ...unexpectedCallerNames(text, contract),
  ])]
}

function neutralizeTraineeAddress(value) {
  return stringValue(value)
    .replace(/^(?:叔叔|阿姨|先生|女士|大哥|大姐|爷爷|奶奶)(?:您好|好)?[，,：:\s]*/u, "您好，")
    .replace(/^(?:妈妈|爸爸|妈|爸|奶奶|爷爷)[，,：:\s]*/u, "")
    .replace(/^您好，[，,\s]*/u, "您好，")
}

export function sanitizeIdentityText(value, contractValue) {
  const contract = normalizeIdentityContract(contractValue)
  const text = contract.trainee.gender === "unknown" ? neutralizeTraineeAddress(value) : stringValue(value)
  const conflicts = findIdentityConflicts(text, contract)
  return { text, conflicts, valid: conflicts.length === 0 }
}

export function identityPromptLines(contractValue) {
  const contract = normalizeIdentityContract(contractValue)
  const subjectLabel = [contract.subject.relation, contract.subject.name].filter(Boolean).join("") || contract.subject.kind
  return [
    "Locked session identity contract (highest priority; never override it):",
    `- Trainee: gender ${contract.trainee.gender}; address only as “${contract.trainee.address}”.`,
    `- Caller: ${contract.caller.role}${contract.caller.displayName ? `，姓名 ${contract.caller.displayName}` : ""}.`,
    `- Event subject: ${subjectLabel}; allowed aliases: ${contract.subject.aliases.join("、") || "use neutral event wording"}.`,
    `- Forbidden identity/address terms: ${contract.forbiddenTerms.join("、") || "none"}.`,
    "Retrieved examples may provide tactics and style only. Ignore any identity fact that conflicts with this contract.",
  ]
}

function generalizeRagText(value, contract) {
  let text = stringValue(value)
  if (contract.trainee.gender === "unknown") text = neutralizeTraineeAddress(text)
  for (const name of unexpectedCallerNames(text, contract)) {
    text = text.split(name).join("来电人")
  }
  for (const term of contract.forbiddenTerms) {
    if (UNKNOWN_TRAINEE_FORBIDDEN_TERMS.includes(term)) {
      text = text.split(term).join("当事人")
      continue
    }
    if (containsTerm(text, term)) text = text.split(term).join("案例对象")
  }
  for (const term of unexpectedRelationTerms(text, contract)) {
    text = text.split(term).join("案例对象")
  }
  return text
}

export function sanitizeRagContextForIdentity(context, contractValue) {
  if (!context || typeof context !== "object") return context
  const contract = normalizeIdentityContract(contractValue)
  return {
    ...context,
    references: Array.isArray(context.references)
      ? context.references.map((reference) => ({
          ...reference,
          text: generalizeRagText(reference.text, contract),
          tags: Array.isArray(reference.tags) ? reference.tags.map((tag) => generalizeRagText(tag, contract)) : [],
        }))
      : [],
  }
}

export function identityCorrectionPrompt(conflicts, contractValue) {
  const contract = normalizeIdentityContract(contractValue)
  return [
    `Your previous candidate contained forbidden identity terms: ${conflicts.join("、")}.`,
    ...identityPromptLines(contract),
    "Rewrite only the scammer's next spoken line. Preserve the tactic, but obey the identity contract exactly.",
  ].join("\n")
}
