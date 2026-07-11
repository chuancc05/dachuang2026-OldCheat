"use client"

import { useCallback, useEffect, useState } from "react"
import { Bot, DatabaseZap, RefreshCw, Radio, ShieldCheck, TriangleAlert } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { RagDebugInfo } from "@/components/training/rag-debug-panel"

type AiSource = "idle" | "deepseek" | "ollama" | "fallback"

type RuntimeStatus = {
  overall: "ready" | "degraded"
  ai: {
    preferredSource: Exclude<AiSource, "idle">
    fallbackReady: boolean
  }
  rag: {
    enabled: boolean
    mode: "vector" | "lexical" | "off"
    provider: "dashscope" | "ollama" | "none"
    documentCount: number
    lexicalFallbackReady: boolean
  }
  voice: {
    mode: "gateway" | "browser-fallback"
    browserFallbackReady: boolean
    textFallbackReady: boolean
  }
}

const AI_LABEL: Record<Exclude<AiSource, "idle">, string> = {
  deepseek: "DeepSeek API",
  ollama: "本地 Ollama",
  fallback: "场景库兜底",
}

const RAG_MODE_LABEL: Record<RuntimeStatus["rag"]["mode"], string> = {
  vector: "向量检索",
  lexical: "关键词兜底",
  off: "未启用",
}

export function RuntimeStatusPanel({ aiSource, ragDebug }: { aiSource: AiSource; ragDebug: RagDebugInfo | null }) {
  const [status, setStatus] = useState<RuntimeStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch("/api/health", { cache: "no-store" })
      if (!response.ok) throw new Error(`Health returned ${response.status}`)
      setStatus(await response.json())
      setFailed(false)
    } catch {
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const displayedAi = aiSource === "idle" ? status?.ai.preferredSource : aiSource
  const displayedRagMode = ragDebug?.mode ?? status?.rag.mode
  const ragUsesFallback = ragDebug?.mode === "lexical" || Boolean(ragDebug?.error)

  return (
    <section className="rounded-2xl border border-primary/25 bg-primary/5 p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {status?.overall === "degraded" || failed ? (
            <TriangleAlert className="size-4 text-warning-foreground" />
          ) : (
            <ShieldCheck className="size-4 text-safe" />
          )}
          <h3 className="text-sm font-semibold text-primary">运行状态</h3>
        </div>
        <Button size="icon" variant="ghost" className="size-7" onClick={() => void refresh()} disabled={loading} aria-label="刷新运行状态">
          <RefreshCw className={loading ? "size-4 animate-spin" : "size-4"} />
        </Button>
      </div>

      {failed ? (
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">状态检查暂不可用，训练仍会保留场景库和文字训练兜底。</p>
      ) : (
        <div className="mt-3 space-y-2 text-xs">
          <StatusRow icon={<Bot className="size-3.5" />} label="本轮 AI" value={displayedAi ? AI_LABEL[displayedAi] : "正在检查"} />
          <StatusRow
            icon={<DatabaseZap className="size-3.5" />}
            label="RAG 检索"
            value={displayedRagMode ? RAG_MODE_LABEL[displayedRagMode] : "正在检查"}
            detail={ragUsesFallback ? "向量服务异常，已切换关键词兜底" : status?.rag.mode === "vector" ? `${status.rag.provider === "dashscope" ? "DashScope" : "本地"} 向量` : undefined}
          />
          <StatusRow
            icon={<Radio className="size-3.5" />}
            label="语音通话"
            value={status?.voice.mode === "gateway" ? "实时语音网关" : "浏览器语音优先"}
            detail="不可用时保留文字训练"
          />
        </div>
      )}
    </section>
  )
}

function StatusRow({ icon, label, value, detail }: { icon: React.ReactNode; label: string; value: string; detail?: string }) {
  return (
    <div className="flex items-start gap-2 rounded-xl bg-card/75 px-3 py-2 text-foreground/85">
      <span className="mt-0.5 text-primary">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="font-medium">{label}</span>
        <span className="ml-1 text-muted-foreground">{value}</span>
        {detail && <span className="mt-0.5 block leading-relaxed text-muted-foreground">{detail}</span>}
      </span>
    </div>
  )
}
