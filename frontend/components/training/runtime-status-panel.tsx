"use client"

import { useCallback, useEffect, useState } from "react"
import { Bot, DatabaseZap, Radio, RefreshCw, ShieldCheck, TriangleAlert } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { RagDebugInfo } from "@/components/training/rag-debug-panel"
import type { VoiceProvider } from "@/components/training/voice-call-panel"

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

function voiceStatusCopy(status: RuntimeStatus | null, provider: VoiceProvider) {
  if (provider === "dashscope" || provider === "aliyun") {
    return {
      value: "阿里云实时语音已连接",
      detail: "当前会话正在使用公网 WSS 网关",
    }
  }

  if (provider === "browser") {
    return {
      value: "浏览器语音",
      detail: "当前会话使用浏览器 ASR/TTS",
    }
  }

  if (status?.voice.mode === "gateway") {
    return {
      value: "实时语音网关已配置",
      detail: "开始语音训练后会尝试连接",
    }
  }

  return {
    value: "浏览器语音优先",
    detail: "网关不可用时保留文字训练",
  }
}

export function RuntimeStatusPanel({
  aiSource,
  ragDebug,
  voiceProvider,
}: {
  aiSource: AiSource
  ragDebug: RagDebugInfo | null
  voiceProvider: VoiceProvider
}) {
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
  const voiceCopy = voiceStatusCopy(status, voiceProvider)

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
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          状态检查暂不可用，训练仍会保留场景库和文字训练兜底。
        </p>
      ) : (
        <div className="mt-3 space-y-2 text-xs">
          <StatusRow icon={<Bot className="size-3.5" />} label="本轮 AI" value={displayedAi ? AI_LABEL[displayedAi] : "正在检查"} />
          <StatusRow
            icon={<DatabaseZap className="size-3.5" />}
            label="RAG 检索"
            value={displayedRagMode ? RAG_MODE_LABEL[displayedRagMode] : "正在检查"}
            detail={
              ragUsesFallback
                ? "向量服务异常，已切换关键词兜底"
                : status?.rag.mode === "vector"
                  ? `${status.rag.provider === "dashscope" ? "DashScope" : "本地"} 向量`
                  : undefined
            }
          />
          <StatusRow icon={<Radio className="size-3.5" />} label="语音通话" value={voiceCopy.value} detail={voiceCopy.detail} />
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
