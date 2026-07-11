"use client"

import type React from "react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { Scenario } from "@/lib/scenarios"
import {
  Bot,
  Ear,
  Loader2,
  Mic,
  Phone,
  PhoneCall,
  PhoneOff,
  Play,
  Radio,
  RotateCcw,
  VolumeX,
  Volume2,
} from "lucide-react"

export type VoiceCallStatus =
  | "idle"
  | "requesting-permission"
  | "speaking-scammer"
  | "listening-user"
  | "recognizing"
  | "thinking"
  | "paused"
  | "finished"
  | "error"

export type VoiceProvider = "browser" | "dashscope" | "aliyun" | "unavailable"

export type VoiceTranscript = {
  text: string
  confidence?: number
  provider: VoiceProvider
}

interface VoiceCallPanelProps {
  scenario: Scenario | null
  active: boolean
  started: boolean
  finished: boolean
  status: VoiceCallStatus
  provider: VoiceProvider
  transcript: VoiceTranscript | null
  error: string
  durationLabel: string
  muted: boolean
  muteAvailable: boolean
  onStart: () => void
  onToggleMute: () => void
  onReplay: () => void
  onStopVoice: () => void
  onHelp: () => void
  onHangup: () => void
}

const STATUS_COPY: Record<VoiceCallStatus, { title: string; detail: string; icon: React.ReactNode }> = {
  idle: {
    title: "语音训练待开始",
    detail: "点击开始后，系统会像电话一样播放诈骗话术，并等待你开口回应。",
    icon: <PhoneCall className="size-8" />,
  },
  "requesting-permission": {
    title: "正在请求麦克风",
    detail: "请在浏览器弹窗中允许使用麦克风。",
    icon: <Mic className="size-8" />,
  },
  "speaking-scammer": {
    title: "对方正在说话",
    detail: "先听完，不要转账，不要提供验证码。",
    icon: <Volume2 className="size-8" />,
  },
  "listening-user": {
    title: "请你回答",
    detail: "直接开口说你的应对，系统会自动识别并提交。",
    icon: <Ear className="size-8" />,
  },
  recognizing: {
    title: "正在识别",
    detail: "正在把你的语音转成文字。",
    icon: <Radio className="size-8" />,
  },
  thinking: {
    title: "正在思考",
    detail: "正在生成下一句诈骗话术和风险提示。",
    icon: <Loader2 className="size-8 animate-spin" />,
  },
  paused: {
    title: "语音训练已暂停",
    detail: "可以继续语音训练，也可以改用文字输入。",
    icon: <Bot className="size-8" />,
  },
  finished: {
    title: "训练完成",
    detail: "可以查看训练报告，复盘本场应对表现。",
    icon: <PhoneOff className="size-8" />,
  },
  error: {
    title: "没听清，请再说一遍",
    detail: "可以重新说一次，或临时改用文字输入。",
    icon: <Mic className="size-8" />,
  },
}

const PROVIDER_COPY: Record<VoiceProvider, string> = {
  browser: "浏览器语音",
  dashscope: "阿里云实时语音",
  aliyun: "阿里云语音",
  unavailable: "语音不可用",
}

export function VoiceCallPanel({
  scenario,
  active,
  started,
  finished,
  status,
  provider,
  transcript,
  error,
  durationLabel,
  muted,
  muteAvailable,
  onStart,
  onToggleMute,
  onReplay,
  onStopVoice,
  onHelp,
  onHangup,
}: VoiceCallPanelProps) {
  if (!active) return null

  const copy = STATUS_COPY[finished ? "finished" : status]
  const canReplay = started && !finished && status !== "speaking-scammer" && status !== "thinking"
  const isScammerSpeaking = started && !finished && status === "speaking-scammer"
  const startLabel = status === "error" ? "重新开启麦克风" : status === "paused" ? "继续语音训练" : "开始语音"

  return (
    <section className="border-b bg-card px-4 py-4 sm:px-6">
      <div className="grid gap-4 rounded-2xl border bg-background p-4 shadow-sm sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
        <div className="flex min-w-0 items-center gap-4">
          <div
            className={cn(
              "relative flex size-20 shrink-0 items-center justify-center rounded-full text-primary ring-8 ring-primary/10",
              status === "listening-user" && "text-safe ring-safe/20",
              status === "speaking-scammer" && "text-danger ring-danger/15",
            )}
          >
            {started && !finished && status !== "idle" && (
              <span className="absolute inset-0 rounded-full bg-primary/20 animate-ping-ring" />
            )}
            <div className="relative flex size-16 items-center justify-center rounded-full bg-primary/10">
              {copy.icon}
            </div>
          </div>

          <div className="min-w-0">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">
                语音通话训练
              </span>
              <span className="rounded-full bg-muted px-2.5 py-1 font-mono text-xs text-muted-foreground">
                {durationLabel}
              </span>
              <span className="rounded-full border px-2.5 py-1 text-xs text-muted-foreground">
                {PROVIDER_COPY[provider]}
              </span>
            </div>
            <h2 className="text-2xl font-black leading-tight text-balance sm:text-3xl">{copy.title}</h2>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground text-pretty">
              {error || copy.detail}
            </p>
            {isScammerSpeaking && (
              <p className="mt-2 flex items-center gap-1.5 text-sm font-semibold text-primary" role="status">
                <Volume2 className="size-4" />
                正在播放对方话术，回复输入已暂时锁定。
              </p>
            )}
            {scenario && (
              <p className="mt-2 truncate text-sm font-medium">
                {scenario.title} · {scenario.persona}
              </p>
            )}
            {transcript?.text && (
              <p className="mt-2 rounded-xl bg-muted px-3 py-2 text-sm text-foreground/90">
                你刚才说：{transcript.text}
              </p>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:w-52 sm:grid-cols-1">
          {!started || status === "idle" || status === "paused" || status === "error" ? (
            <Button size="lg" onClick={onStart} className="h-12 text-base">
              <Play className="size-5" />
              {startLabel}
            </Button>
          ) : (
            <Button size="lg" variant="secondary" onClick={onStopVoice} className="h-12 text-base">
              <Phone className="size-5" />
              暂停语音
            </Button>
          )}
          <Button size="lg" variant="outline" onClick={onToggleMute} disabled={!muteAvailable} className="h-12 text-base">
            {muted ? <Volume2 className="size-5" /> : <VolumeX className="size-5" />}
            {muted ? "恢复声音" : "静音"}
          </Button>
          <Button size="lg" variant="outline" onClick={onReplay} disabled={!canReplay} className="h-12 text-base">
            <RotateCcw className="size-5" />
            再说一遍
          </Button>
          <Button size="lg" variant="outline" onClick={onHelp} disabled={!started} className="h-12 text-base">
            向子女求助
          </Button>
          <Button
            size="lg"
            variant="outline"
            onClick={onHangup}
            disabled={!started || finished}
            className="h-12 border-danger/50 text-danger hover:bg-danger/10"
          >
            <PhoneOff className="size-5" />
            挂断/退出
          </Button>
        </div>
      </div>
    </section>
  )
}
