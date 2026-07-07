"use client"

import { riskLevel } from "@/lib/scenarios"

interface RiskGaugeProps {
  score: number // 0 - 10
}

const toneColor: Record<string, string> = {
  safe: "var(--safe)",
  warning: "var(--warning)",
  danger: "var(--danger)",
}

export function RiskGauge({ score }: RiskGaugeProps) {
  const clamped = Math.max(0, Math.min(10, score))
  const pct = clamped / 10
  const { label, tone } = riskLevel(clamped)

  // semicircle geometry
  const radius = 70
  const cx = 90
  const cy = 90
  const circumference = Math.PI * radius
  const dash = circumference * pct

  // needle angle: -90deg (left) to 90deg (right)
  const angle = -90 + pct * 180
  const needleColor = toneColor[tone]

  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 180 108" className="w-full max-w-[220px]">
        {/* track */}
        <path
          d="M 20 90 A 70 70 0 0 1 160 90"
          fill="none"
          stroke="var(--muted)"
          strokeWidth="12"
          strokeLinecap="round"
        />
        {/* value arc */}
        <path
          d="M 20 90 A 70 70 0 0 1 160 90"
          fill="none"
          stroke={needleColor}
          strokeWidth="12"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circumference}`}
          className="transition-all duration-700 ease-out"
        />
        {/* needle */}
        <g
          className="transition-transform duration-700 ease-out"
          style={{ transform: `rotate(${angle}deg)`, transformOrigin: `${cx}px ${cy}px` }}
        >
          <line x1={cx} y1={cy} x2={cx} y2="30" stroke={needleColor} strokeWidth="3" strokeLinecap="round" />
        </g>
        <circle cx={cx} cy={cy} r="7" fill={needleColor} />
        <circle cx={cx} cy={cy} r="3" fill="var(--card)" />
      </svg>
      <div className="-mt-2 flex flex-col items-center">
        <span className="text-xs font-medium text-muted-foreground">风险等级</span>
        <span className="text-2xl font-black tracking-tight" style={{ color: needleColor }}>
          {label}
        </span>
        <span className="font-mono text-sm text-muted-foreground">{clamped.toFixed(1)} / 10</span>
      </div>
    </div>
  )
}
