import fs from "node:fs"
import path from "node:path"

loadEnvFile(path.resolve(process.cwd(), ".env.local"))

const projectRoot = path.resolve(process.cwd(), "..")
const outputPath = path.resolve(process.cwd(), "data", "rag-index.json")
const ollamaUrl = process.env.OLLAMA_URL ?? "http://127.0.0.1:11434"
const embeddingProvider = normalizeEmbedProvider(process.env.RAG_EMBED_PROVIDER)
const embeddingModel = normalizeEmbedModel(process.env.RAG_EMBED_MODEL, embeddingProvider)
const embeddingDimensions = clampNumber(process.env.RAG_EMBED_DIMENSIONS, 64, 4096, 1024)
const dashscopeApiKey = process.env.DASHSCOPE_API_KEY?.trim() ?? ""
const dashscopeBaseUrl = process.env.DASHSCOPE_BASE_URL ?? "https://dashscope.aliyuncs.com/compatible-mode/v1"
const batchSize = clampNumber(process.env.RAG_EMBED_BATCH_SIZE, 1, embeddingProvider === "dashscope" ? 10 : 64, embeddingProvider === "dashscope" ? 10 : 1)
const embeddingPrecision = clampNumber(process.env.RAG_EMBED_PRECISION, 2, 8, 4)

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/)
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const index = trimmed.indexOf("=")
    if (index < 0) continue
    const key = trimmed.slice(0, index).trim()
    const value = trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, "")
    if (key && process.env[key] === undefined) process.env[key] = value
  }
}

function clampNumber(value, min, max, fallback) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(min, Math.min(max, Math.floor(parsed)))
}

function normalizeEmbedProvider(value) {
  const normalized = value?.trim().toLowerCase()
  if (normalized === "dashscope" || normalized === "aliyun" || normalized === "alibaba") return "dashscope"
  if (normalized === "none" || normalized === "off" || normalized === "lexical") return "none"
  return "ollama"
}

function normalizeEmbedModel(value, provider) {
  const model = value?.trim()
  if (provider === "dashscope") {
    if (!model || model.toLowerCase() === "qwen3-embedding") return "text-embedding-v4"
    return model
  }
  if (provider === "ollama") return model || "bge-m3"
  return model || "none"
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"))
  } catch {
    return null
  }
}

function normalizeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim()
}

function splitTags(value) {
  return normalizeText(value)
    .split(/[、；;，,+/\s]+/u)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2)
}

function unique(items) {
  return [...new Set(items)]
}

function extractSceneId(value) {
  const text = normalizeText(value)
  const match = text.match(/SC-\d{2}/i)
  return match ? match[0].toUpperCase() : text
}

function tokenize(text) {
  const normalized = normalizeText(text).toLowerCase()
  const chinese = Array.from(normalized.matchAll(/[\u4e00-\u9fff]{2,}/gu)).flatMap((match) => {
    const word = match[0]
    const grams = []
    for (let size = 2; size <= 4; size += 1) {
      for (let index = 0; index <= word.length - size; index += 1) grams.push(word.slice(index, index + size))
    }
    return grams
  })
  const latin = normalized.match(/[a-z0-9]{2,}/g) ?? []
  return unique([...chinese, ...latin])
}

function makeDocument(input) {
  const text = normalizeText(input.text).slice(0, 520)
  if (text.length < 12) return null
  const tags = unique(input.tags.map(normalizeText).filter(Boolean))
  return {
    ...input,
    text,
    tags,
    keywords: tokenize(`${input.sceneName} ${tags.join(" ")} ${text}`),
  }
}

function pushDoc(target, input) {
  const doc = makeDocument(input)
  if (doc) target.push(doc)
}

function buildScenarioDocuments() {
  const library = readJson(path.join(projectRoot, "data", "scenario_library.json"))
  const docs = []
  for (const scene of library?.scenes ?? []) {
    const sceneId = extractSceneId(scene.id)
    const sceneName = normalizeText(scene.name)
    const tags = splitTags(scene.core_tactics)
    const lines = [...(scene.openings ?? []), ...(scene.typical_lines ?? []), ...(scene.report_examples ?? [])]
    lines.slice(0, 18).forEach((line, index) => {
      pushDoc(docs, {
        id: `${sceneId}-library-${index}`,
        sceneId,
        sceneName,
        source: "scenario-library",
        tags,
        text: line,
      })
    })
  }
  return docs
}

function buildLedgerDocuments() {
  const ledgerPath = path.join(
    projectRoot,
    "data",
    "teleantifraud_1000",
    "processed_layers",
    "teleantifraud_1000_data_ledger.jsonl",
  )
  const docs = []
  const lines = fs.readFileSync(ledgerPath, "utf8").split(/\r?\n/).filter(Boolean)
  for (const line of lines) {
    const row = JSON.parse(line)
    const sceneId = extractSceneId(row["场景ID"] ?? row["映射训练场景"])
    if (!sceneId) continue
    pushDoc(docs, {
      id: normalizeText(row["样本ID"]) || `${sceneId}-ledger-${docs.length}`,
      sceneId,
      sceneName: normalizeText(row["场景名称"] ?? row["映射训练场景"]),
      source: "teleantifraud-ledger",
      tags: [...splitTags(row["风险标签"]), ...splitTags(row["建议细分标签"])],
      text: normalizeText(row["转写全文"] ?? row["文本摘要"] ?? row["开场候选句"]),
    })
  }
  return docs
}

function buildSupplementalDocuments() {
  const supplemental = readJson(
    path.join(projectRoot, "data", "teleantifraud_1000", "processed_layers", "teleantifraud_supplemental_scene_materials.json"),
  )
  const docs = []
  for (const material of Object.values(supplemental ?? {})) {
    const sceneId = extractSceneId(material.scene_id)
    const sceneName = normalizeText(material.scene_name)
    for (const row of material.samples ?? []) {
      pushDoc(docs, {
        id: normalizeText(row.sample_id) || `${sceneId}-supp-${docs.length}`,
        sceneId,
        sceneName,
        source: "supplemental-material",
        tags: splitTags(row.risk_tags),
        text: normalizeText(row.full_text ?? row.opening_candidate),
      })
    }
  }
  return docs
}

async function embedBatch(texts) {
  if (embeddingProvider === "none") throw new Error("Vector embedding is disabled")
  if (embeddingProvider === "dashscope") return embedBatchWithDashScope(texts)
  return Promise.all(texts.map(embedWithOllama))
}

function compactVector(vector) {
  const scale = 10 ** embeddingPrecision
  return vector.map((value) => Math.round(Number(value) * scale) / scale)
}

async function embedWithOllama(text) {
  const response = await fetch(`${ollamaUrl.replace(/\/$/, "")}/api/embed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: embeddingModel, input: text.slice(0, 1200) }),
  })
  if (!response.ok) throw new Error(`Ollama embed returned ${response.status}`)
  const data = await response.json()
  const vector = data?.embeddings?.[0]
  if (!Array.isArray(vector)) throw new Error("Ollama embed returned no vector")
  return vector
}

async function embedBatchWithDashScope(texts) {
  if (!dashscopeApiKey) throw new Error("DASHSCOPE_API_KEY is not configured")

  const response = await fetch(`${dashscopeBaseUrl.replace(/\/$/, "")}/embeddings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${dashscopeApiKey}`,
    },
    body: JSON.stringify({
      model: embeddingModel,
      input: texts.map((text) => text.slice(0, 1200)),
      dimensions: embeddingDimensions,
      encoding_format: "float",
    }),
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => "")
    throw new Error(`DashScope embed returned ${response.status}${detail ? `: ${detail.slice(0, 300)}` : ""}`)
  }
  const data = await response.json()
  const vectors = data?.data?.map((item) => item.embedding)
  if (!Array.isArray(vectors) || vectors.length !== texts.length || vectors.some((vector) => !Array.isArray(vector))) {
    throw new Error("DashScope embed returned invalid vectors")
  }
  return vectors
}

const documents = [...buildScenarioDocuments(), ...buildLedgerDocuments(), ...buildSupplementalDocuments()]
const seen = new Set()
const deduped = documents.filter((doc) => {
  const key = `${doc.sceneId}:${doc.text}`
  if (seen.has(key)) return false
  seen.add(key)
  return true
})

console.log(`Building RAG index with ${deduped.length} documents via ${embeddingProvider}/${embeddingModel}...`)

for (let index = 0; index < deduped.length; index += batchSize) {
  const batch = deduped.slice(index, index + batchSize)
  const vectors = await embedBatch(batch.map((doc) => `${doc.sceneName} ${doc.tags.join(" ")} ${doc.text}`))
  vectors.forEach((vector, offset) => {
    batch[offset].embedding = compactVector(vector)
  })
  const done = Math.min(index + batch.length, deduped.length)
  if (done % 25 === 0 || done === deduped.length) {
    console.log(`Embedded ${done}/${deduped.length}`)
  }
}

fs.mkdirSync(path.dirname(outputPath), { recursive: true })
fs.writeFileSync(
  outputPath,
  JSON.stringify({
    version: "0.1.0",
    embeddingProvider,
    embeddingModel,
    embeddingDimensions,
    embeddingPrecision,
    generatedAt: new Date().toISOString(),
    documents: deduped,
  }),
  "utf8",
)

console.log(`Wrote ${outputPath}`)
