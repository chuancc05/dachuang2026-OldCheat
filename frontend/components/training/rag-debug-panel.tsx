"use client"

import { DatabaseZap, Tags } from "lucide-react"
import { cn } from "@/lib/utils"

export type RagDebugInfo = {
  enabled: boolean
  mode: "vector" | "lexical" | "off"
  count: number
  error?: string
  references: Array<{
    id: string
    sceneId: string
    sceneName: string
    source: "scenario-library" | "teleantifraud-ledger" | "supplemental-material"
    tags: string[]
    score: number
    excerpt: string
  }>
}

const SOURCE_LABELS: Record<RagDebugInfo["references"][number]["source"], string> = {
  "scenario-library": "场景库",
  "teleantifraud-ledger": "TeleAntiFraud 台账",
  "supplemental-material": "补充素材",
}

const MODE_LABELS: Record<RagDebugInfo["mode"], string> = {
  vector: "向量检索",
  lexical: "关键词检索",
  off: "未启用",
}

export function RagDebugPanel({ info }: { info: RagDebugInfo | null }) {
  return (
    <section className="rounded-2xl border border-primary/25 bg-primary/5 p-4">
      <div className="flex items-center gap-2">
        <DatabaseZap className="size-4 text-primary" />
        <h3 className="text-sm font-semibold text-primary">检索证据</h3>
        <span className="rounded-full border border-primary/25 bg-card px-2 py-0.5 text-[10px] font-medium text-primary">
          答辩模式
        </span>
      </div>

      {!info ? (
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">发送一条训练回复后显示本轮检索参考。</p>
      ) : (
        <>
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            <span className="rounded-full bg-card px-2.5 py-1 text-foreground/80">{MODE_LABELS[info.mode]}</span>
            <span className="rounded-full bg-card px-2.5 py-1 text-foreground/80">{info.count} 条参考</span>
          </div>
          {info.error && (
            <p className="mt-2 text-xs leading-relaxed text-warning-foreground">向量服务暂不可用，当前已自动使用关键词检索。</p>
          )}
          {info.references.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">本轮没有匹配到可展示的参考样本。</p>
          ) : (
            <div className="mt-3 space-y-2">
              {info.references.map((reference, index) => (
                <article key={`${reference.source}-${reference.id}`} className="rounded-xl border bg-card/80 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-xs font-semibold text-foreground/90">
                        {index + 1}. {SOURCE_LABELS[reference.source]} · {reference.id}
                      </p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">{reference.sceneName || reference.sceneId}</p>
                    </div>
                    <span className="shrink-0 font-mono text-[10px] text-primary">{reference.score.toFixed(2)}</span>
                  </div>
                  {reference.tags.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {reference.tags.map((tag) => (
                        <span key={tag} className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] text-primary">
                          <Tags className="mr-1 inline size-2.5" />
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                  <p className={cn("mt-2 text-xs leading-relaxed text-muted-foreground", !reference.excerpt && "hidden")}>
                    {reference.excerpt}
                  </p>
                </article>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  )
}
