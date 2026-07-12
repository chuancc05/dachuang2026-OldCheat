"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { Send, Mic, Square, LifeBuoy, PhoneOff, Volume2 } from "lucide-react"

interface ReplyBarProps {
  disabled: boolean
  finished: boolean
  onSend: (text: string) => void
  onHelp: () => void
  onHangup: () => void
  onVoiceStart?: () => void
  voiceActive?: boolean
  inputLocked?: boolean
  quickReplies: string[]
}

export function ReplyBar({
  disabled,
  finished,
  onSend,
  onHelp,
  onHangup,
  onVoiceStart,
  voiceActive = false,
  inputLocked = false,
  quickReplies,
}: ReplyBarProps) {
  const [value, setValue] = useState("")
  const replyDisabled = disabled || inputLocked

  function submit() {
    const text = value.trim()
    if (!text || replyDisabled) return
    onSend(text)
    setValue("")
  }

  return (
    <div className="border-t bg-card/60 p-3 sm:p-4">
      {/* quick replies */}
      {!finished && quickReplies.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-2">
          <span className="self-center text-xs text-muted-foreground">建议话术：</span>
          {quickReplies.map((q) => (
            <button
              key={q}
              onClick={() => !replyDisabled && onSend(q)}
              disabled={replyDisabled}
              className="rounded-full border border-primary/30 bg-primary/5 px-3 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/10 disabled:opacity-50"
            >
              {q}
            </button>
          ))}
        </div>
      )}

      <div className="flex items-end gap-2">
        <button
          onClick={onVoiceStart}
          disabled={disabled}
          aria-label="语音训练"
          className={cn(
            "flex size-11 shrink-0 items-center justify-center rounded-xl border transition-colors disabled:opacity-50",
            voiceActive
              ? "border-danger bg-danger/10 text-danger"
              : "border-border bg-background text-muted-foreground hover:text-foreground",
          )}
        >
          {voiceActive ? <Square className="size-4 fill-current" /> : <Mic className="size-5" />}
        </button>

        <div className="flex flex-1 items-end rounded-xl border bg-background focus-within:ring-2 focus-within:ring-ring">
          <textarea
            rows={1}
            value={value}
            disabled={replyDisabled}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                if (e.nativeEvent.isComposing || e.keyCode === 229) return
                e.preventDefault()
                submit()
              }
            }}
            placeholder={
              finished
                ? "本场对话已结束，可切换新场景"
                : inputLocked
                  ? "对方正在说话，请先听完..."
                  : voiceActive
                    ? "语音训练进行中，也可以在这里手动输入..."
                    : "输入你的回复，练习如何应对..."
            }
            className="max-h-32 flex-1 resize-none bg-transparent px-3 py-3 text-[15px] outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
          />
        </div>

        <Button onClick={submit} disabled={replyDisabled || !value.trim()} className="h-11 shrink-0 px-4">
          <Send className="size-4" />
          <span className="hidden sm:inline">发送</span>
        </Button>
      </div>

      {inputLocked && !finished && (
        <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-primary" role="status">
          <Volume2 className="size-3.5" />
          对方正在说话，请先听完；需要退出时可直接挂断。
        </p>
      )}

      {/* action row */}
      <div className="mt-3 flex items-center justify-between gap-2">
        <p className="hidden text-xs text-muted-foreground sm:block">
          公检法、银行和客服不会要求转账、索要验证码或共享屏幕。
        </p>
        <div className="flex w-full gap-2 sm:w-auto">
          <Button
            variant="outline"
            onClick={onHelp}
            disabled={finished}
            className="flex-1 border-warning/50 text-warning-foreground hover:bg-warning/10 sm:flex-none"
          >
            <LifeBuoy className="size-4" />
            向子女求助
          </Button>
          <Button
            variant="outline"
            onClick={onHangup}
            disabled={finished}
            className="flex-1 border-danger/50 text-danger hover:bg-danger/10 sm:flex-none"
          >
            <PhoneOff className="size-4" />
            挂断/退出
          </Button>
        </div>
      </div>
    </div>
  )
}
