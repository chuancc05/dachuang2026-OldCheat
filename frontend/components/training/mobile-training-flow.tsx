"use client"

import { useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import type { Message } from "@/components/training/simulation-stage"
import type { VoiceCallStatus, VoiceProvider, VoiceTranscript } from "@/components/training/voice-call-panel"
import { riskLevel, type Difficulty, type Scenario } from "@/lib/scenarios"
import { splitSpeechCue } from "@/lib/speech-text"
import { cn } from "@/lib/utils"
import {
  ArrowLeft,
  ChevronRight,
  FileText,
  HeartHandshake,
  LifeBuoy,
  Mic,
  PhoneCall,
  PhoneOff,
  Play,
  RotateCcw,
  ShieldCheck,
  ShieldHalf,
  Square,
  Volume2,
  X,
} from "lucide-react"

type MobileTrainingStep = "scene-selection" | "scene-confirm" | "voice-call" | "text-fallback" | "result"

type ScenarioGroup = {
  title: string
  description: string
  codes: string[]
}

const SCENARIO_GROUPS: ScenarioGroup[] = [
  {
    title: "冒充身份与账户",
    description: "冒充公安、银行、医保等身份施压",
    codes: ["SC-01", "SC-10", "SC-11", "SC-13"],
  },
  {
    title: "熟人求助与紧急事件",
    description: "冒充亲友、制造紧急情况催促转账",
    codes: ["SC-06", "SC-12", "SC-14"],
  },
  {
    title: "赚钱、贷款与中奖",
    description: "以收益、兼职、贷款或中奖诱导付款",
    codes: ["SC-02", "SC-03", "SC-09", "SC-05"],
  },
  {
    title: "生活服务与健康",
    description: "围绕健康、快递和退款制造风险",
    codes: ["SC-04", "SC-07", "SC-08"],
  },
]

const DIFFICULTY_ORDER: Record<Difficulty, number> = { 高: 0, 中: 1, 低: 2 }

const DIFFICULTY_TONE: Record<Difficulty, string> = {
  高: "bg-danger/10 text-danger",
  中: "bg-warning/15 text-warning-foreground",
  低: "bg-safe/10 text-safe",
}

const VOICE_STATUS_COPY: Record<VoiceCallStatus, { title: string; detail: string }> = {
  idle: { title: "准备开始", detail: "点击开始后，系统会先播放对方的话。" },
  "requesting-permission": { title: "正在打开麦克风", detail: "请在浏览器提示里允许使用麦克风。" },
  "speaking-scammer": { title: "对方正在说话", detail: "先听完，不要着急转账或提供信息。" },
  "listening-user": { title: "请你回答", detail: "可以直接对着手机说。" },
  recognizing: { title: "正在识别", detail: "请稍等，系统正在听清你的回答。" },
  thinking: { title: "正在思考", detail: "正在分析这句话里的风险。" },
  paused: { title: "语音已暂停", detail: "可以重新开启麦克风，或改用文字训练。" },
  finished: { title: "训练完成", detail: "本次训练已经保存，可以查看结果。" },
  error: { title: "没有听清", detail: "点击重新开启麦克风，靠近手机再说一次；也可以改用文字训练。" },
}

interface MobileTrainingFlowProps {
  scenarios: Scenario[]
  scenario: Scenario | null
  activeScenarioId: string | null
  started: boolean
  finished: boolean
  messages: Message[]
  typing: boolean
  durationLabel: string
  risk: number
  defenseScore: number
  goodMoves: number
  riskyMoves: number
  advice: string
  voiceStatus: VoiceCallStatus
  voiceProvider: VoiceProvider
  voiceTranscript: VoiceTranscript | null
  voiceError: string
  voiceActive: boolean
  onSelectScenario: (scenario: Scenario) => void
  onStartVoice: () => void | Promise<void>
  onStartText: () => void
  onSendText: (text: string) => void | Promise<unknown>
  onReplay: () => void
  onHelp: () => void
  onHangup: () => void
  onStopVoice: () => void
  onOpenReport: () => void
  onRestart: () => void
}

export function MobileTrainingFlow({
  scenarios,
  scenario,
  activeScenarioId,
  started,
  finished,
  messages,
  typing,
  durationLabel,
  risk,
  defenseScore,
  goodMoves,
  riskyMoves,
  advice,
  voiceStatus,
  voiceProvider,
  voiceTranscript,
  voiceError,
  voiceActive,
  onSelectScenario,
  onStartVoice,
  onStartText,
  onSendText,
  onReplay,
  onHelp,
  onHangup,
  onStopVoice,
  onOpenReport,
  onRestart,
}: MobileTrainingFlowProps) {
  const [step, setStep] = useState<MobileTrainingStep>(() => (finished ? "result" : started ? "voice-call" : "scene-selection"))
  const [switchConfirmOpen, setSwitchConfirmOpen] = useState(false)
  const [returningToSelection, setReturningToSelection] = useState(false)
  const [textReply, setTextReply] = useState("")

  useEffect(() => {
    if (finished && started && !returningToSelection) setStep("result")
  }, [finished, returningToSelection, started])

  useEffect(() => {
    if (step === "voice-call" && voiceStatus === "error") setStep("text-fallback")
  }, [step, voiceStatus])

  const groupedScenarios = useMemo(() => groupScenarios(scenarios), [scenarios])
  const lastScammerLine = useMemo(
    () => [...messages].reverse().find((message) => message.sender === "scammer")?.text ?? scenario?.script[0]?.line ?? "",
    [messages, scenario],
  )
  const status = VOICE_STATUS_COPY[voiceStatus]
  const riskInfo = riskLevel(risk)

  function selectScenario(nextScenario: Scenario) {
    setReturningToSelection(false)
    onSelectScenario(nextScenario)
    setTextReply("")
    setStep("scene-confirm")
  }

  function startVoice() {
    setStep("voice-call")
    void onStartVoice()
  }

  function startTextTraining() {
    if (!started) onStartText()
    setStep("text-fallback")
  }

  function requestSceneSwitch() {
    if (started && !finished) {
      setSwitchConfirmOpen(true)
      return
    }
    setStep("scene-selection")
  }

  function confirmSceneSwitch() {
    setSwitchConfirmOpen(false)
    setReturningToSelection(true)
    if (!finished) onHangup()
    setStep("scene-selection")
  }

  if (step === "scene-selection") {
    return (
      <MobileFrame title="选择训练场景" subtitle="挑一个常见骗局，练习如何保护自己。">
        <div className="space-y-7 pb-6">
          {groupedScenarios.map(({ title, description, scenarios: group }) => (
            <section key={title}>
              <div className="mb-3">
                <h2 className="text-lg font-bold">{title}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{description}</p>
              </div>
              <div className="space-y-3">
                {group.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => selectScenario(item)}
                    style={{ boxSizing: "border-box" }}
                    className={cn(
                      "w-full min-w-0 overflow-hidden rounded-2xl border bg-card p-4 text-left shadow-sm transition-colors active:bg-primary/5",
                      item.id === activeScenarioId ? "border-primary ring-1 ring-primary/30" : "border-border",
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-lg font-bold text-primary">
                        {item.avatar}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex min-w-0 items-center justify-between gap-2">
                          <span className="min-w-0 truncate text-base font-bold">{item.title}</span>
                          <span className={cn("shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold", DIFFICULTY_TONE[item.difficulty])}>
                            {item.difficulty}风险
                          </span>
                        </span>
                        <span className="mt-1 block text-sm text-muted-foreground">{item.persona}</span>
                        <span className="mt-2 block max-h-[3.25rem] overflow-hidden text-sm leading-relaxed text-foreground/80">{item.tagline}</span>
                      </span>
                      <ChevronRight className="mt-3 size-5 shrink-0 text-muted-foreground" />
                    </div>
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      </MobileFrame>
    )
  }

  if (!scenario) return null

  if (step === "scene-confirm") {
    return (
      <MobileFrame title="准备开始" subtitle="确认这是一通模拟电话。" backAction={() => setStep("scene-selection")}>
        <div className="flex flex-1 flex-col justify-center gap-6 pb-10">
          <section className="rounded-3xl border bg-card p-6 shadow-sm">
            <div className="flex items-start gap-4">
              <span className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-2xl font-bold text-primary">
                {scenario.avatar}
              </span>
              <div>
                <p className="text-sm text-muted-foreground">模拟来电</p>
                <h2 className="mt-1 text-2xl font-black">{scenario.persona}</h2>
                <p className="mt-2 text-base font-semibold">{scenario.title}</p>
              </div>
            </div>
            <div className="mt-5 flex items-center justify-between rounded-2xl bg-danger/5 px-4 py-3">
              <span className="text-sm text-muted-foreground">风险等级</span>
              <span className={cn("rounded-full px-3 py-1 text-sm font-bold", DIFFICULTY_TONE[scenario.difficulty])}>
                {scenario.difficulty}风险
              </span>
            </div>
            <p className="mt-5 text-base leading-relaxed text-foreground/85">{scenario.tagline}</p>
          </section>

          <p className="rounded-2xl border border-primary/25 bg-primary/5 px-4 py-3 text-base leading-relaxed text-foreground/85">
            先听完，遇到催促转账、索要验证码或不让核实，先停下来。
          </p>

          <div className="space-y-3">
            <Button size="lg" onClick={startVoice} className="h-16 w-full text-xl font-bold">
              <PhoneCall className="size-6" />
              开始语音训练
            </Button>
            <Button size="lg" variant="outline" onClick={startTextTraining} className="h-14 w-full text-lg">
              改用文字训练
            </Button>
            <Button size="lg" variant="ghost" onClick={() => setStep("scene-selection")} className="h-12 w-full text-base text-muted-foreground">
              换一个场景
            </Button>
          </div>
        </div>
      </MobileFrame>
    )
  }

  if (step === "result") {
    const resultTitle = defenseScore >= 80 ? "表现很稳" : defenseScore >= 60 ? "做得不错" : "再练一次会更熟练"
    const keyTip = advice || "转账前，先挂断，再用原来的号码核实。"
    return (
      <MobileFrame title="本次训练结束" subtitle={`${scenario.title} · ${scenario.persona}`}>
        <div className="space-y-5 pb-8">
          <section className="rounded-3xl border bg-card p-6 text-center shadow-sm">
            <p className="text-sm text-muted-foreground">{resultTitle}</p>
            <div className="mt-2 text-6xl font-black tabular-nums text-primary">{defenseScore}</div>
            <p className="mt-1 text-sm text-muted-foreground">防御分 / 100</p>
            <div className="mt-5 grid grid-cols-2 gap-3 text-left">
              <Metric label="正确应对" value={`${goodMoves} 次`} tone="safe" />
              <Metric label="风险动作" value={`${riskyMoves} 次`} tone="danger" />
            </div>
          </section>
          <section className="rounded-2xl border border-primary/25 bg-primary/5 p-4">
            <p className="text-sm font-semibold text-primary">记住这一句</p>
            <p className="mt-2 text-base leading-relaxed text-foreground/90">{keyTip}</p>
          </section>
          <div className="space-y-3">
            <Button size="lg" className="h-16 w-full text-xl font-bold" onClick={onOpenReport}>
              <FileText className="size-6" />
              查看训练报告
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="h-14 w-full text-lg"
              onClick={() => {
                onRestart()
                setStep("scene-confirm")
              }}
            >
              <RotateCcw className="size-5" />
              再练一次
            </Button>
            <Button size="lg" variant="ghost" className="h-12 w-full text-base text-muted-foreground" onClick={() => setStep("scene-selection")}>
              换一个场景
            </Button>
          </div>
        </div>
      </MobileFrame>
    )
  }

  if (step === "text-fallback") {
    return (
      <MobileFrame title="文字训练" subtitle="语音暂时不可用，也可以继续完成训练。" backAction={requestSceneSwitch}>
        <div className="flex min-h-0 flex-1 flex-col gap-4 pb-4">
          <CallSummary scenario={scenario} durationLabel={durationLabel} provider={voiceProvider} status={{ title: "文字训练中", detail: voiceError || "可以输入一句话回复对方。" }} />
          <SubtitleCard text={lastScammerLine} label="对方刚才说" />
          <p className="rounded-2xl border border-primary/25 bg-primary/5 p-4 text-sm leading-relaxed text-foreground/90">{advice}</p>
          <div className="mt-auto space-y-3">
            <textarea
              rows={3}
              value={textReply}
              disabled={typing || finished}
              onChange={(event) => setTextReply(event.target.value)}
              placeholder="可以在这里输入你的回答"
              className="w-full resize-none rounded-2xl border bg-card px-4 py-3 text-base outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
            />
            <Button
              size="lg"
              disabled={!textReply.trim() || typing || finished}
              className="h-16 w-full text-xl font-bold"
              onClick={() => {
                const reply = textReply.trim()
                if (!reply) return
                setTextReply("")
                void onSendText(reply)
              }}
            >
              <Play className="size-5" />
              发送回答
            </Button>
            <Button size="lg" variant="outline" className="h-16 w-full text-lg" onClick={startVoice}>
              <Mic className="size-6" />
              重新开启麦克风
            </Button>
            <div className="grid grid-cols-2 gap-3">
              <Button size="lg" variant="outline" className="h-14 border-warning/40 text-warning-foreground" onClick={onHelp}>
                <LifeBuoy className="size-5" />
                向子女求助
              </Button>
              <Button size="lg" variant="outline" className="h-14 border-danger/50 text-danger" onClick={onHangup}>
                <PhoneOff className="size-5" />
                挂断/退出
              </Button>
            </div>
          </div>
        </div>
        {switchConfirmOpen && <ConfirmDialog onCancel={() => setSwitchConfirmOpen(false)} onConfirm={confirmSceneSwitch} />}
      </MobileFrame>
    )
  }

  return (
    <MobileFrame title={scenario.title} subtitle={scenario.persona} backAction={requestSceneSwitch}>
      <div className="flex min-h-0 flex-1 flex-col gap-4 pb-4">
        <CallSummary scenario={scenario} durationLabel={durationLabel} provider={voiceProvider} status={status} />
        <SubtitleCard text={voiceTranscript?.text || lastScammerLine} label={voiceTranscript?.text ? "你刚才说" : "对方字幕"} />
        <section className="rounded-2xl border bg-card p-4">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-semibold">当前风险</span>
            <span className={cn("rounded-full px-3 py-1 text-sm font-bold", riskInfo.tone === "danger" ? "bg-danger/10 text-danger" : riskInfo.tone === "warning" ? "bg-warning/15 text-warning-foreground" : "bg-safe/10 text-safe")}>
              {riskInfo.label}
            </span>
          </div>
          <p className="mt-3 text-sm leading-relaxed text-foreground/85">{advice}</p>
        </section>
        {voiceError && <p className="rounded-2xl border border-warning/40 bg-warning/10 p-4 text-sm text-warning-foreground">{voiceError}</p>}

        <div className="mt-auto space-y-3">
          {voiceStatus === "paused" || voiceStatus === "error" ? (
            <Button size="lg" className="h-16 w-full text-xl font-bold" onClick={startVoice}>
              <Mic className="size-6" />
              重新开启麦克风
            </Button>
          ) : voiceActive ? (
            <Button size="lg" variant="outline" className="h-16 w-full text-lg" onClick={onStopVoice}>
              <Square className="size-5 fill-current" />
              暂停语音
            </Button>
          ) : null}
          <div className="grid grid-cols-2 gap-3">
            <Button size="lg" variant="outline" className="h-16 text-lg" onClick={onReplay} disabled={!lastScammerLine}>
              <Volume2 className="size-5" />
              再说一遍
            </Button>
            <Button size="lg" variant="outline" className="h-16 border-warning/40 text-warning-foreground" onClick={onHelp}>
              <HeartHandshake className="size-5" />
              向子女求助
            </Button>
          </div>
          <Button size="lg" variant="outline" className="h-16 w-full border-danger/50 text-lg text-danger" onClick={onHangup}>
            <PhoneOff className="size-6" />
            挂断/退出
          </Button>
          <Button size="lg" variant="ghost" className="h-12 w-full text-base text-muted-foreground" onClick={requestSceneSwitch}>
            换场景
          </Button>
        </div>
      </div>

      {switchConfirmOpen && (
        <ConfirmDialog
          onCancel={() => setSwitchConfirmOpen(false)}
          onConfirm={confirmSceneSwitch}
        />
      )}
    </MobileFrame>
  )
}

function MobileFrame({
  title,
  subtitle,
  backAction,
  children,
}: {
  title: string
  subtitle: string
  backAction?: () => void
  children: React.ReactNode
}) {
  return (
    <div className="min-h-dvh overflow-x-hidden bg-background">
      <header className="sticky top-0 z-10 border-b bg-card/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-lg items-center gap-3">
          {backAction ? (
            <Button size="icon" variant="ghost" aria-label="返回" onClick={backAction}>
              <ArrowLeft className="size-5" />
            </Button>
          ) : (
            <span className="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <ShieldHalf className="size-5" />
            </span>
          )}
          <div className="min-w-0">
            <h1 className="truncate text-lg font-bold">{title}</h1>
            <p className="truncate text-sm text-muted-foreground">{subtitle}</p>
          </div>
        </div>
      </header>
      <main
        className="mx-auto flex min-h-[calc(100dvh-69px)] w-full max-w-lg flex-col box-border px-4 pt-5"
        style={{ boxSizing: "border-box" }}
      >
        {children}
      </main>
    </div>
  )
}

function CallSummary({
  scenario,
  durationLabel,
  provider,
  status,
}: {
  scenario: Scenario
  durationLabel: string
  provider: VoiceProvider
  status: { title: string; detail: string }
}) {
  const providerLabel = provider === "dashscope" ? "阿里云实时语音" : provider === "browser" ? "浏览器语音" : "等待语音服务"
  return (
    <section className="rounded-3xl border bg-card p-5 text-center shadow-sm">
      <div className="mx-auto flex size-20 items-center justify-center rounded-full bg-primary/10 text-3xl font-black text-primary">
        {scenario.avatar}
      </div>
      <div className="mt-4 flex items-center justify-center gap-2 text-sm text-muted-foreground">
        <PhoneCall className="size-4 text-primary" />
        <span>{scenario.persona}</span>
        <span className="font-mono">{durationLabel}</span>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">{providerLabel}</p>
      <h2 className="mt-4 text-3xl font-black leading-tight">{status.title}</h2>
      <p className="mt-2 text-base leading-relaxed text-muted-foreground">{status.detail}</p>
    </section>
  )
}

function SubtitleCard({ text, label }: { text: string; label: string }) {
  const speechText = splitSpeechCue(text).speechText || "等待对方开始说话。"
  return (
    <section className="rounded-2xl border bg-card p-4">
      <p className="text-xs font-semibold text-muted-foreground">{label}</p>
      <p className="mt-2 text-base leading-relaxed text-foreground/90">{speechText}</p>
    </section>
  )
}

function Metric({ label, value, tone }: { label: string; value: string; tone: "safe" | "danger" }) {
  return (
    <div className={cn("rounded-2xl border p-3", tone === "safe" ? "border-safe/25 bg-safe/5" : "border-danger/25 bg-danger/5")}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("mt-1 text-xl font-black", tone === "safe" ? "text-safe" : "text-danger")}>{value}</p>
    </div>
  )
}

function ConfirmDialog({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end bg-foreground/35 p-4 sm:items-center">
      <div className="w-full rounded-3xl border bg-card p-5 shadow-xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold">要换一个训练场景吗？</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">当前这场训练会结束，已有记录可先在训练报告中查看。</p>
          </div>
          <Button size="icon" variant="ghost" aria-label="取消" onClick={onCancel}>
            <X className="size-5" />
          </Button>
        </div>
        <div className="mt-5 space-y-3">
          <Button size="lg" className="h-14 w-full text-lg" onClick={onConfirm}>
            继续换场景
          </Button>
          <Button size="lg" variant="outline" className="h-12 w-full" onClick={onCancel}>
            取消，继续训练
          </Button>
        </div>
      </div>
    </div>
  )
}

function groupScenarios(scenarios: Scenario[]) {
  const ungrouped = new Set(scenarios.map((scenario) => scenario.code))
  const groups = SCENARIO_GROUPS.map((group) => {
    const items = group.codes
      .map((code) => scenarios.find((scenario) => scenario.code === code))
      .filter((scenario): scenario is Scenario => Boolean(scenario))
      .sort((left, right) => DIFFICULTY_ORDER[left.difficulty] - DIFFICULTY_ORDER[right.difficulty])
    items.forEach((scenario) => ungrouped.delete(scenario.code))
    return { ...group, scenarios: items }
  }).filter((group) => group.scenarios.length > 0)

  const remaining = scenarios
    .filter((scenario) => ungrouped.has(scenario.code))
    .sort((left, right) => DIFFICULTY_ORDER[left.difficulty] - DIFFICULTY_ORDER[right.difficulty])

  if (remaining.length > 0) {
    groups.push({ title: "其他训练场景", description: "更多常见反诈训练", codes: [], scenarios: remaining })
  }

  return groups
}
