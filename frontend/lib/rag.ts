import fs from "node:fs"
import path from "node:path"
import type { Message } from "@/components/training/simulation-stage"
import type { Scenario } from "@/lib/scenarios"

export interface RagReference {
  id: string
  sceneId: string
  sceneName: string
  source: "scenario-library" | "teleantifraud-ledger" | "supplemental-material"
  tags: string[]
  text: string
  score: number
}

interface RagDocument extends Omit<RagReference, "score"> {
  keywords: string[]
  embedding?: number[]
}

interface RagIndexFile {
  version?: string
  embeddingProvider?: string
  embeddingModel?: string
  embeddingDimensions?: number
  generatedAt?: string
  documents?: RagDocument[]
}

interface SceneLibraryFile {
  scenes?: Array<{
    id?: string
    name?: string
    core_tactics?: string
    openings?: string[]
    typical_lines?: string[]
    report_examples?: string[]
  }>
}

type JsonObject = Record<string, unknown>

export interface RagContext {
  enabled: boolean
  mode: "vector" | "lexical" | "off"
  references: RagReference[]
  error?: string
}

export interface RagRuntimeStatus {
  enabled: boolean
  mode: "vector" | "lexical" | "off"
  provider: "dashscope" | "ollama" | "none"
  documentCount: number
  lexicalFallbackReady: boolean
}

let documentCache: RagDocument[] | null = null

function envValue(key: string): string {
  return (process.env[key] ?? "").trim()
}

function envValueBase64(key: string): string {
  const value = envValue(key)
  if (!value) return ""
  try {
    const decoded = Buffer.from(value, "base64").toString("utf8").trim()
    return decoded.startsWith("sk-") ? decoded : ""
  } catch {
    return ""
  }
}

function clampNumber(value: string | undefined, min: number, max: number, fallback: number): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(min, Math.min(max, Math.floor(parsed)))
}

function normalizeEmbedProvider(value?: string): "ollama" | "dashscope" | "none" {
  const normalized = value?.trim().toLowerCase()
  if (normalized === "dashscope" || normalized === "aliyun" || normalized === "alibaba") return "dashscope"
  if (normalized === "none" || normalized === "off" || normalized === "lexical") return "none"
  return "ollama"
}

function normalizeEmbedModel(value: string | undefined, provider: "ollama" | "dashscope" | "none"): string {
  const model = value?.trim()
  if (provider === "dashscope") {
    if (!model || model.toLowerCase() === "qwen3-embedding") return "text-embedding-v4"
    return model
  }
  if (provider === "ollama") return model || "bge-m3"
  return model || "none"
}

function ragEnabled(): boolean {
  return (envValue("RAG_ENABLED") || "true").toLowerCase() !== "false"
}

function ragTopK(): number {
  return clampNumber(envValue("RAG_TOP_K"), 1, 8, 3)
}

function ragEmbedTimeoutMs(): number {
  // A training conversation should continue with lexical retrieval when the
  // remote embedding service is slow, rather than holding the voice turn open.
  return clampNumber(envValue("RAG_EMBED_TIMEOUT_MS"), 800, 12_000, 3_000)
}

function ragUseVector(): boolean {
  return (envValue("RAG_USE_VECTOR") || "true").toLowerCase() !== "false"
}

function ragEmbedProvider(): "ollama" | "dashscope" | "none" {
  return normalizeEmbedProvider(envValue("RAG_EMBED_PROVIDER"))
}

function ollamaUrl(): string {
  return envValue("OLLAMA_URL") || "http://127.0.0.1:11434"
}

function ragEmbedModel(provider = ragEmbedProvider()): string {
  return normalizeEmbedModel(envValue("RAG_EMBED_MODEL"), provider)
}

function ragEmbedDimensions(): number {
  return clampNumber(envValue("RAG_EMBED_DIMENSIONS"), 64, 4096, 1024)
}

function dashScopeApiKey(): string {
  return envValue("DASHSCOPE_API_KEY") || envValueBase64("DASHSCOPE_API_KEY_B64")
}

function dashScopeBaseUrl(): string {
  return envValue("DASHSCOPE_BASE_URL") || "https://dashscope.aliyuncs.com/compatible-mode/v1"
}

function projectRoot(): string {
  return path.resolve(process.cwd(), "..")
}

function readJson<T>(filePath: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T
  } catch {
    return null
  }
}

function normalizeText(value: unknown): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
}

function splitTags(value: unknown): string[] {
  return normalizeText(value)
    .split(/[、；;，,+/\s]+/u)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2)
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)]
}

function extractSceneId(value: unknown): string {
  const text = normalizeText(value)
  const match = text.match(/SC-\d{2}/i)
  return match ? match[0].toUpperCase() : text
}

function tokenize(text: string): string[] {
  const normalized = normalizeText(text).toLowerCase()
  const chinese = Array.from(normalized.matchAll(/[\u4e00-\u9fff]{2,}/gu)).flatMap((match) => {
    const word = match[0]
    const grams: string[] = []
    for (let size = 2; size <= 4; size += 1) {
      for (let index = 0; index <= word.length - size; index += 1) grams.push(word.slice(index, index + size))
    }
    return grams
  })
  const latin = normalized.match(/[a-z0-9]{2,}/g) ?? []
  return unique([...chinese, ...latin])
}

function makeDocument(input: Omit<RagDocument, "keywords">): RagDocument | null {
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

function pushDoc(target: RagDocument[], input: Omit<RagDocument, "keywords">): void {
  const doc = makeDocument(input)
  if (doc) target.push(doc)
}

function buildDocumentsFromScenarioLibrary(root: string): RagDocument[] {
  const library = readJson<SceneLibraryFile>(path.join(root, "data", "scenario_library.json"))
  const docs: RagDocument[] = []
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

function buildDocumentsFromLedger(root: string): RagDocument[] {
  const ledgerPath = path.join(
    root,
    "data",
    "teleantifraud_1000",
    "processed_layers",
    "teleantifraud_1000_data_ledger.jsonl",
  )
  const docs: RagDocument[] = []
  try {
    const lines = fs.readFileSync(ledgerPath, "utf8").split(/\r?\n/).filter(Boolean)
    for (const line of lines) {
      const row = JSON.parse(line) as JsonObject
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
  } catch {
    return docs
  }
  return docs
}

function buildDocumentsFromSupplemental(root: string): RagDocument[] {
  const supplemental = readJson<Record<string, JsonObject>>(
    path.join(root, "data", "teleantifraud_1000", "processed_layers", "teleantifraud_supplemental_scene_materials.json"),
  )
  const docs: RagDocument[] = []
  for (const material of Object.values(supplemental ?? {})) {
    const sceneId = extractSceneId(material.scene_id)
    const sceneName = normalizeText(material.scene_name)
    const samples = Array.isArray(material.samples) ? material.samples : []
    for (const sample of samples) {
      const row = sample as JsonObject
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

function loadPrebuiltIndex(root: string): RagDocument[] | null {
  const index = readJson<RagIndexFile>(path.join(process.cwd(), "data", "rag-index.json"))
  if (!index?.documents?.length) return null
  const provider = ragEmbedProvider()
  if (ragUseVector() && provider !== "none") {
    const providerMatches = (index.embeddingProvider ?? "ollama") === provider
    const modelMatches = index.embeddingModel === ragEmbedModel(provider)
    const dimensionsMatch = !index.embeddingDimensions || index.embeddingDimensions === ragEmbedDimensions()
    if (!providerMatches || !modelMatches || !dimensionsMatch) return null
  }
  return index.documents.map((doc) => ({ ...doc, keywords: doc.keywords?.length ? doc.keywords : tokenize(doc.text) }))
}

function loadDocuments(): RagDocument[] {
  if (documentCache) return documentCache
  const root = projectRoot()
  const prebuilt = loadPrebuiltIndex(root)
  documentCache =
    prebuilt ??
    [
      ...buildDocumentsFromScenarioLibrary(root),
      ...buildDocumentsFromLedger(root),
      ...buildDocumentsFromSupplemental(root),
    ]
  return documentCache
}

/** Returns configuration-safe RAG readiness without calling an embedding provider. */
export function getRagRuntimeStatus(): RagRuntimeStatus {
  const enabled = ragEnabled()
  const provider = ragEmbedProvider()
  const documentCount = loadDocuments().length
  const vectorRequested = enabled && ragUseVector() && provider !== "none"
  const providerConfigured = provider === "dashscope" ? Boolean(dashScopeApiKey()) : Boolean(ollamaUrl())

  return {
    enabled,
    mode: !enabled ? "off" : vectorRequested && providerConfigured ? "vector" : "lexical",
    provider,
    documentCount,
    lexicalFallbackReady: enabled && documentCount > 0,
  }
}

function scenarioTerms(scenario: Scenario): string[] {
  return unique([
    scenario.code,
    scenario.id.toUpperCase(),
    scenario.title,
    ...splitTags(scenario.method),
  ].filter(Boolean))
}

function lexicalScore(doc: RagDocument, queryKeywords: string[], terms: string[]): number {
  const keywordHits = queryKeywords.reduce((sum, keyword) => sum + (doc.keywords.includes(keyword) ? 1 : 0), 0)
  const tagHits = terms.reduce((sum, term) => sum + (doc.tags.some((tag) => tag.includes(term) || term.includes(tag)) ? 1 : 0), 0)
  return keywordHits * 1.2 + tagHits * 2 + (doc.source === "teleantifraud-ledger" ? 1 : 0)
}

function dot(a: number[], b: number[]): number {
  const length = Math.min(a.length, b.length)
  let sum = 0
  for (let index = 0; index < length; index += 1) sum += a[index] * b[index]
  return sum
}

function norm(a: number[]): number {
  return Math.sqrt(a.reduce((sum, value) => sum + value * value, 0))
}

function cosineSimilarity(a: number[], b: number[]): number {
  const denominator = norm(a) * norm(b)
  return denominator ? dot(a, b) / denominator : 0
}

async function embedText(text: string): Promise<number[]> {
  const provider = ragEmbedProvider()
  if (provider === "none") throw new Error("Vector embedding is disabled")
  if (provider === "dashscope") return embedTextWithDashScope(text)

  const response = await fetch(`${ollamaUrl().replace(/\/$/, "")}/api/embed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: ragEmbedModel(provider), input: text.slice(0, 1200) }),
    signal: AbortSignal.timeout(ragEmbedTimeoutMs()),
  })
  if (!response.ok) throw new Error(`Ollama embed returned ${response.status}`)
  const data = await response.json()
  const embedding = data?.embeddings?.[0]
  if (!Array.isArray(embedding)) throw new Error("Ollama embed returned no vector")
  return embedding
}

async function embedTextWithDashScope(text: string): Promise<number[]> {
  const apiKey = dashScopeApiKey()
  if (!apiKey) throw new Error("DashScope API key is not configured")

  const response = await fetch(`${dashScopeBaseUrl().replace(/\/$/, "")}/embeddings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: ragEmbedModel("dashscope"),
      input: text.slice(0, 1200),
      dimensions: ragEmbedDimensions(),
      encoding_format: "float",
    }),
    signal: AbortSignal.timeout(ragEmbedTimeoutMs()),
  })

  if (!response.ok) throw new Error(`DashScope embed returned ${response.status}`)
  const data = await response.json()
  const embedding = data?.data?.[0]?.embedding
  if (!Array.isArray(embedding)) throw new Error("DashScope embed returned no vector")
  return embedding
}

function formatQuery(scenario: Scenario, messages: Message[], userText: string): string {
  const recent = messages
    .filter((message) => message.sender !== "system")
    .slice(-6)
    .map((message) => message.text)
    .join(" ")
  return `${scenario.title} ${scenario.method} ${scenario.tagline} ${recent} ${userText}`
}

export function formatRagReferences(references: RagReference[]): string {
  if (references.length === 0) return "No retrieved examples."
  return references
    .slice(0, 3)
    .map((ref, index) => {
      const tags = ref.tags.length ? ` | tags: ${ref.tags.slice(0, 4).join("、")}` : ""
      return `${index + 1}. [${ref.source}/${ref.id}${tags}] ${ref.text.slice(0, 180)}`
    })
    .join("\n")
}

export async function retrieveRagContext(
  scenario: Scenario,
  messages: Message[],
  userText: string,
): Promise<RagContext> {
  if (!ragEnabled()) return { enabled: false, mode: "off", references: [] }

  try {
    const docs = loadDocuments()
    const topK = ragTopK()
    const sceneId = scenario.code.toUpperCase()
    const terms = scenarioTerms(scenario)
    const query = formatQuery(scenario, messages, userText)
    const queryKeywords = tokenize(query)
    const scoped = docs.filter((doc) => doc.sceneId === sceneId)
    const candidates = scoped.length >= topK ? scoped : docs

    const lexicalRanked = candidates
      .map((doc) => ({ doc, score: lexicalScore(doc, queryKeywords, terms) }))
      .filter((item) => item.score > 0 || item.doc.sceneId === sceneId)
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.max(16, topK * 4))

    if (!ragUseVector() || ragEmbedProvider() === "none") {
      return {
        enabled: true,
        mode: "lexical",
        references: lexicalRanked.slice(0, topK).map(({ doc, score }) => ({ ...doc, score })),
      }
    }

    const queryEmbedding = await embedText(query)
    const vectorRanked = lexicalRanked
      .filter(({ doc }) => Array.isArray(doc.embedding) && doc.embedding.length === queryEmbedding.length)
      .map(({ doc, score }) => ({
        doc,
        score: score + (doc.embedding ? cosineSimilarity(queryEmbedding, doc.embedding) * 8 : 0),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)

    if (vectorRanked.length === 0) {
      return {
        enabled: true,
        mode: "lexical",
        references: lexicalRanked.slice(0, topK).map(({ doc, score }) => ({ ...doc, score })),
        error: "No matching vector index is available for the configured embedding provider",
      }
    }

    return {
      enabled: true,
      mode: vectorRanked.some((item) => item.doc.embedding) ? "vector" : "lexical",
      references: vectorRanked.map(({ doc, score }) => ({ ...doc, score })),
    }
  } catch (error) {
    const docs = loadDocuments()
    const topK = ragTopK()
    const queryKeywords = tokenize(formatQuery(scenario, messages, userText))
    const terms = scenarioTerms(scenario)
    const references = docs
      .filter((doc) => doc.sceneId === scenario.code.toUpperCase())
      .map((doc) => ({ doc, score: lexicalScore(doc, queryKeywords, terms) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
      .map(({ doc, score }) => ({ ...doc, score }))
    return {
      enabled: true,
      mode: "lexical",
      references,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
