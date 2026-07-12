import { timingSafeEqual } from "node:crypto"
import { NextRequest, NextResponse } from "next/server"
import { deleteStoryVariant, readStoryVariantLibrary, upsertStoryVariant } from "@/lib/story-variant-store"
import { validateStoryVariant, type StoryVariant } from "@/lib/story-variants"

export const dynamic = "force-dynamic"

function noStore<T>(body: T, init?: ResponseInit) {
  return NextResponse.json(body, { ...init, headers: { ...init?.headers, "Cache-Control": "no-store, max-age=0" } })
}
function configuredToken(): string { return (process.env.STORY_VARIANT_ADMIN_TOKEN ?? "").trim() }
function authorized(request: NextRequest): boolean {
  const expected = configuredToken()
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/iu, "") ?? ""
  return Boolean(expected) && expected.length === supplied.length && timingSafeEqual(Buffer.from(expected), Buffer.from(supplied))
}
function requireAdmin(request: NextRequest): NextResponse | null {
  if (!configuredToken()) return noStore({ error: "服务器尚未配置 STORY_VARIANT_ADMIN_TOKEN。" }, { status: 503 })
  return authorized(request) ? null : noStore({ error: "管理令牌无效。" }, { status: 401 })
}

export async function GET(request: NextRequest) {
  const includeDisabled = request.nextUrl.searchParams.get("includeDisabled") === "1"
  if (includeDisabled) { const rejection = requireAdmin(request); if (rejection) return rejection }
  const result = await readStoryVariantLibrary()
  return noStore({ version: result.library.version, variants: includeDisabled ? result.library.variants : result.library.variants.filter((variant) => variant.enabled), source: result.source, warning: result.warning })
}

export async function POST(request: NextRequest) {
  const rejection = requireAdmin(request); if (rejection) return rejection
  let variant: StoryVariant
  try { variant = await request.json() } catch { return noStore({ error: "请求内容不是合法 JSON。" }, { status: 400 }) }
  const validation = validateStoryVariant(variant)
  if (!validation.valid) return noStore({ error: "变体校验失败。", details: validation.errors }, { status: 400 })
  try {
    const result = await upsertStoryVariant(variant)
    return noStore({ variant: result.library.variants.find((item) => item.id === variant.id), source: result.source })
  } catch (error) { return noStore({ error: error instanceof Error ? error.message : "保存变体失败。" }, { status: 500 }) }
}

export async function DELETE(request: NextRequest) {
  const rejection = requireAdmin(request); if (rejection) return rejection
  const id = request.nextUrl.searchParams.get("id")?.trim()
  if (!id) return noStore({ error: "缺少要删除的变体 ID。" }, { status: 400 })
  try {
    const result = await deleteStoryVariant(id)
    return noStore({ deleted: id, version: result.library.version, source: result.source })
  } catch (error) { return noStore({ error: error instanceof Error ? error.message : "删除变体失败。" }, { status: 404 }) }
}
