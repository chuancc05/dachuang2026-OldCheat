import "server-only"

import fs from "node:fs/promises"
import path from "node:path"
import { getStore } from "@netlify/blobs"
import seedLibrary from "@/data/story-variants.json"
import {
  normalizeStoryVariant,
  normalizeStoryVariantLibrary,
  validateStoryVariantLibrary,
  type StoryVariant,
  type StoryVariantLibrary,
} from "@/lib/story-variants"

const STORE_NAME = "oldcheat-story-variants"
const STORE_KEY = "library-v1"
const LOCAL_PATH = path.join(process.cwd(), ".data", "story-variants.json")
export type StoryVariantStoreSource = "netlify-blobs" | "local-override" | "seed"

export interface StoryVariantStoreResult {
  library: StoryVariantLibrary
  source: StoryVariantStoreSource
  warning?: string
}

function cloneSeed(): StoryVariantLibrary {
  return JSON.parse(JSON.stringify(seedLibrary)) as StoryVariantLibrary
}

function checkedLibrary(value: unknown): StoryVariantLibrary {
  const normalized = normalizeStoryVariantLibrary(value)
  const validation = validateStoryVariantLibrary(normalized)
  if (!validation.valid) throw new Error(validation.errors.slice(0, 6).join(" "))
  return normalized
}

function isNetlifyBlobsRuntime(): boolean {
  return process.env.NETLIFY === "true" || Boolean(process.env.NETLIFY_BLOBS_CONTEXT)
}

async function readLocalOverride(): Promise<StoryVariantLibrary | null> {
  try {
    return checkedLibrary(JSON.parse(await fs.readFile(LOCAL_PATH, "utf8")))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null
    throw error
  }
}

export async function readStoryVariantLibrary(): Promise<StoryVariantStoreResult> {
  if (isNetlifyBlobsRuntime()) {
    try {
      const stored = await getStore({ name: STORE_NAME, consistency: "strong" }).get(STORE_KEY, { type: "json" })
      if (stored) return { library: checkedLibrary(stored), source: "netlify-blobs" }
    } catch (error) {
      return { library: cloneSeed(), source: "seed", warning: `在线变体存储不可用，已使用内置种子：${error instanceof Error ? error.message : String(error)}` }
    }
  } else {
    try {
      const local = await readLocalOverride()
      if (local) return { library: local, source: "local-override" }
    } catch (error) {
      return { library: cloneSeed(), source: "seed", warning: `本地覆盖文件无效，已使用内置种子：${error instanceof Error ? error.message : String(error)}` }
    }
  }
  return { library: cloneSeed(), source: "seed" }
}

export async function writeStoryVariantLibrary(library: StoryVariantLibrary): Promise<StoryVariantStoreSource> {
  checkedLibrary(library)
  if (isNetlifyBlobsRuntime()) {
    await getStore({ name: STORE_NAME, consistency: "strong" }).setJSON(STORE_KEY, library, { metadata: { contentType: "application/json", updatedAt: new Date().toISOString() } })
    return "netlify-blobs"
  }
  await fs.mkdir(path.dirname(LOCAL_PATH), { recursive: true })
  await fs.writeFile(LOCAL_PATH, `${JSON.stringify(library, null, 2)}\n`, "utf8")
  return "local-override"
}

export async function upsertStoryVariant(variant: StoryVariant): Promise<StoryVariantStoreResult> {
  const current = await readStoryVariantLibrary()
  const index = current.library.variants.findIndex((item) => item.id === variant.id)
  const variants = [...current.library.variants]
  const next = normalizeStoryVariant({
    ...variant,
    version: index >= 0 ? variants[index].version + 1 : Math.max(1, variant.version),
    updatedAt: new Date().toISOString(),
  })
  if (index >= 0) variants[index] = next
  else variants.push(next)
  const library = { version: current.library.version + 1, variants }
  return { library, source: await writeStoryVariantLibrary(library) }
}

export async function deleteStoryVariant(id: string): Promise<StoryVariantStoreResult> {
  const current = await readStoryVariantLibrary()
  const variants = current.library.variants.filter((item) => item.id !== id)
  if (variants.length === current.library.variants.length) throw new Error(`未找到变体 ${id}。`)
  const library = { version: current.library.version + 1, variants }
  return { library, source: await writeStoryVariantLibrary(library) }
}
