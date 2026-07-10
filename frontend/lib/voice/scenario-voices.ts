import type { Scenario } from "@/lib/scenarios"

export type ScenarioVoice = {
  voice: string
  label: string
}

const DEFAULT_SCENARIO_VOICE: ScenarioVoice = {
  voice: "Cherry",
  label: "通用客服女声",
}

const SCENE_VOICE_BY_CODE: Record<string, ScenarioVoice> = {
  "SC-01": { voice: "Neil", label: "公检法权威男声" },
  "SC-02": { voice: "Kai", label: "投资顾问男声" },
  "SC-03": { voice: "Cherry", label: "兼职客服女声" },
  "SC-04": { voice: "Maia", label: "健康顾问女声" },
  "SC-05": { voice: "Cherry", label: "活动通知女声" },
  "SC-06": { voice: "Mia", label: "年轻女儿声" },
  "SC-07": { voice: "Serena", label: "快递客服女声" },
  "SC-08": { voice: "Cherry", label: "平台客服女声" },
  "SC-09": { voice: "Ethan", label: "贷款顾问男声" },
  "SC-10": { voice: "Neil", label: "征信机构男声" },
  "SC-11": { voice: "Maia", label: "医保服务女声" },
  "SC-12": { voice: "Moon", label: "熟人男性声" },
  "SC-13": { voice: "Neil", label: "银行风控男声" },
  "SC-14": { voice: "Vincent", label: "勒索压迫男声" },
}

export function getScenarioVoice(scenario: Scenario | null): ScenarioVoice {
  if (!scenario) return DEFAULT_SCENARIO_VOICE
  return SCENE_VOICE_BY_CODE[scenario.code] ?? DEFAULT_SCENARIO_VOICE
}
