import fs from "node:fs"
import path from "node:path"
import { TrainingApp } from "@/components/training/training-app"
import { SCENARIOS as FALLBACK_SCENARIOS, type Channel, type Difficulty, type Scenario, type ScriptTurn } from "@/lib/scenarios"
import bundledScenarioLibrary from "@/data/scenario_library.json"
import bundledStoryVariants from "@/data/story-variants.json"
import type { StoryVariantLibrary } from "@/lib/story-variants"

export const dynamic = "force-dynamic"

interface LibraryScene {
  id: string
  name: string
  difficulty?: string
  core_tactics?: string
  backstory?: string
  openings?: string[]
  typical_lines?: string[]
  report_examples?: string[]
  source_sample_ids?: string[]
}

interface ScenarioLibrary {
  scenes?: LibraryScene[]
}

const AVATAR_BY_CODE: Record<string, string> = {
  "SC-01": "警",
  "SC-02": "财",
  "SC-03": "单",
  "SC-04": "康",
  "SC-05": "奖",
  "SC-06": "亲",
  "SC-07": "递",
  "SC-08": "客",
  "SC-09": "贷",
  "SC-10": "信",
  "SC-11": "保",
  "SC-12": "友",
  "SC-13": "银",
  "SC-14": "急",
}

const PERSONA_BY_CODE: Record<string, string> = {
  "SC-01": "「公安机关」来电",
  "SC-02": "理财顾问 · 李老师",
  "SC-03": "兼职客服 · 小雨",
  "SC-04": "健康顾问 · 陈主任",
  "SC-05": "活动通知 · 官方客服",
  "SC-06": "「女儿」小雪",
  "SC-07": "快递客服 · 王专员",
  "SC-08": "平台客服 · 退款专员",
  "SC-09": "贷款顾问 · 刘经理",
  "SC-10": "征信专员 · 周老师",
  "SC-11": "医保中心 · 工作人员",
  "SC-12": "老同学 · 阿强",
  "SC-13": "银行客服 · 风控专员",
  "SC-14": "陌生来电 · 紧急威胁",
}

const PHONE_KEYWORDS = ["公检法", "保健", "客服", "贷款", "征信", "医保", "社保", "银行", "绑架", "物流", "快递"]

function normalizeDifficulty(value = "中难度"): Difficulty {
  if (value.includes("高")) return "高"
  if (value.includes("低")) return "低"
  return "中"
}

function desiredTurnCount(scene: LibraryScene): number {
  const difficulty = normalizeDifficulty(scene.difficulty)
  if (difficulty === "高") return 9
  if ((scene.difficulty ?? "").includes("低") && (scene.difficulty ?? "").includes("中")) return 7
  if (difficulty === "低") return 6
  return 8
}

function inferChannel(scene: LibraryScene): Channel {
  const text = `${scene.name} ${scene.core_tactics ?? ""}`
  return PHONE_KEYWORDS.some((keyword) => text.includes(keyword)) ? "phone" : "wechat"
}

function splitTactics(value = ""): string[] {
  return value
    .split(/[、，,+]/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function normalizeLine(line: string): string {
  return line.replace(/\s+/g, " ").trim()
}

function pushUnique(lines: string[], incoming: string[]) {
  for (const raw of incoming) {
    const line = normalizeLine(raw)
    if (line.length < 8) continue
    if (!lines.includes(line)) lines.push(line)
  }
}

function synthesizeLine(scene: LibraryScene, trigger: string, index: number): string {
  const name = scene.name || "这个项目"
  const templates: Record<string, string[]> = {
    恐吓: [
      "这个事情已经进入处理流程，您现在不配合，后续责任可能会更严重。",
      "我再提醒一次，拖延只会让情况变复杂，您最好现在就按要求处理。",
    ],
    权威施压: [
      "我们是按正式流程通知您，电话内容都有记录，请您严肃对待。",
      "这不是普通咨询，是系统里已经触发的风险事项，需要您马上核验。",
    ],
    信息隔离: [
      "这件事暂时不要告诉家人，外人不了解情况，反而会影响处理进度。",
      "您先不要挂电话，也不要联系别人，我们会一步步指导您完成核验。",
    ],
    诱导身份核验: [
      "为了确认是本人操作，您需要把姓名、身份证尾号和银行卡信息核对一下。",
      "系统要验证您的身份，您照我说的步骤操作就可以。",
    ],
    高收益诱惑: [
      "这个名额不是人人都有，收益比普通存款高很多，错过今天就没有了。",
      "您先小额试一下，看到收益以后再决定加不加，这样最稳妥。",
    ],
    保本承诺: [
      "我们这个产品是保本承诺，后台有风控兜底，您不用担心本金。",
      "很多客户都是先观望，后来发现每天收益都很稳定，才继续追加。",
    ],
    虚假平台: [
      "您点击我发的链接下载专属平台，普通应用商店里搜不到内部版本。",
      "注册后会看到您的专属账户，资金和收益都在里面实时显示。",
    ],
    专员指导: [
      "您别担心不会操作，我会全程在线，一步一步带您完成。",
      "如果页面弹出提示，您截图发给我，我帮您判断下一步点哪里。",
    ],
    小额返利建立信任: [
      "您看，前面的小任务已经返了吧，说明平台是真实可靠的。",
      "新手都是从小单开始，熟悉流程后收益会明显提高。",
    ],
    任务升级: [
      "现在系统给您匹配到组合任务，必须连续完成，不能中途退出。",
      "这一单做完就能解锁更高佣金，前面的收益也会一起结算。",
    ],
    沉没成本陷阱: [
      "您前面已经投入时间和本金了，现在放弃就太可惜了。",
      "只差最后一步就能提现，千万不要在这个时候中断。",
    ],
    健康焦虑: [
      "您的指标不能再拖了，很多老人就是因为不重视才错过最佳调理期。",
      "这个问题早处理成本低，拖到医院检查出来就麻烦了。",
    ],
    虚假专家: [
      "我们的专家以前给很多老干部做过调理，经验非常丰富。",
      "这个方案不是普通保健品，是专家根据您的情况特别推荐的。",
    ],
    免费礼品: [
      "今天登记还能领一份健康礼包，数量有限，我先帮您保留名额。",
      "您过来听课不花钱，还有礼品拿，顺便了解身体情况。",
    ],
    夸大功效: [
      "坚持用一个疗程，血管、睡眠和免疫力都会有明显改善。",
      "很多老客户反馈用了以后身体轻松多了，复购率特别高。",
    ],
    亲情软肋: [
      "妈，真的是我，现在情况很急，你先帮我一下行不行？",
      "我不是故意瞒你，是怕你担心，但现在必须马上处理。",
    ],
    紧急情况: [
      "老师那边一直在催，晚了名额就没了，你先转过去救急。",
      "我这边真的来不及解释，先把这笔钱处理了，回头我慢慢跟你说。",
    ],
    阻止核实: [
      "你别打我原来的电话，手机坏了接不到，打了也没用。",
      "现在不方便视频，你相信我一次，先按我说的转给老师。",
    ],
    征信恐吓: [
      "如果今天不处理，您的征信记录会被上报，后面贷款和社保都可能受影响。",
      "系统已经提示异常，超过处理时间就不能人工撤回了。",
    ],
    账户关闭: [
      "您的账户存在风险，必须先完成验证，否则会被临时关闭。",
      "这个关闭流程一旦启动，后续解冻会非常麻烦。",
    ],
    转账验证: [
      "这不是转账给个人，是系统验证资金流水，完成后会原路退回。",
      "您只要按提示做一笔验证交易，就能解除当前风险。",
    ],
  }

  const direct = templates[trigger]
  if (direct) return direct[index % direct.length]

  const lowerTrigger = trigger || name
  return [
    `关于${name}，您现在最重要的是先按流程完成这一步，不要错过处理时间。`,
    `我理解您会犹豫，但这个环节就是针对“${lowerTrigger}”的必要核验。`,
    `您先照我说的做，后面如果觉得不合适，也可以再申请撤回。`,
  ][index % 3]
}

function buildCoach(trigger: string, scene: LibraryScene): string {
  const name = scene.name || "当前骗局"
  if (trigger.includes("验证码")) return "验证码就是账户控制权。任何人索要验证码，都应立即拒绝并停止沟通。"
  if (trigger.includes("转账") || trigger.includes("资金")) return "只要对方要求转账、垫付或做资金验证，就先停下，联系家人或官方渠道核实。"
  if (trigger.includes("阻止") || trigger.includes("隔离")) return "不让你告诉家人或阻止你核实，是非常危险的信号。请立刻中断并求助。"
  if (trigger.includes("高收益") || trigger.includes("保本")) return "“高收益、保本、内部名额”通常是投资诈骗组合话术。先放慢节奏，不下载陌生平台，不投入资金。"
  return `识别到“${trigger || name}”相关话术。先放慢节奏，不透露个人信息，不点击链接，不转账。`
}

function buildScript(scene: LibraryScene): ScriptTurn[] {
  const tactics = splitTactics(scene.core_tactics)
  const targetTurns = desiredTurnCount(scene)
  const lines: string[] = []

  pushUnique(lines, (scene.openings ?? []).slice(0, 2))
  pushUnique(lines, scene.typical_lines ?? [])

  let syntheticIndex = 0
  while (lines.length < targetTurns) {
    const trigger = tactics[lines.length % Math.max(tactics.length, 1)] || scene.name || "诈骗话术"
    const line = synthesizeLine(scene, trigger, syntheticIndex)
    pushUnique(lines, [line])
    syntheticIndex += 1
    if (syntheticIndex > 30) break
  }

  const usableLines = lines.slice(0, Math.max(targetTurns, Math.min(lines.length, 10)))

  return usableLines.map((line, index) => {
    const trigger = tactics[index % Math.max(tactics.length, 1)] || scene.name || "诈骗话术"
    return {
      line,
      trigger,
      riskDelta: Math.min(4.5, 1.8 + index * 0.45),
      coach: buildCoach(trigger, scene),
    }
  })
}

function toScenario(scene: LibraryScene, index: number): Scenario {
  const code = scene.id || `SC-${String(index + 1).padStart(2, "0")}`
  const channel = inferChannel(scene)
  const tactics = splitTactics(scene.core_tactics)
  return {
    id: code.toLowerCase(),
    code,
    title: scene.name || code,
    difficulty: normalizeDifficulty(scene.difficulty),
    channel,
    persona: PERSONA_BY_CODE[code] ?? `「${scene.name || code}」模拟对象`,
    avatar: AVATAR_BY_CODE[code] ?? (scene.name || code).slice(0, 1),
    source: channel === "phone" ? "模拟来电 · 动态场景库" : "模拟聊天 · 动态场景库",
    tagline: scene.backstory || `${scene.name || code}训练场景`,
    method: tactics.length > 0 ? tactics.join(" + ") : scene.core_tactics || "诈骗话术识别 + 风险应对训练",
    script: buildScript(scene),
  }
}

function mapLibraryToScenarios(library: ScenarioLibrary): Scenario[] {
    const scenes = library.scenes ?? []
    const mapped = scenes.map(toScenario).filter((scenario) => scenario.script.length > 0)
  return mapped
}

function loadScenarios(): Scenario[] {
  const bundled = mapLibraryToScenarios(bundledScenarioLibrary as ScenarioLibrary)
  if (bundled.length > 0) return bundled

  const libraryPath = path.resolve(process.cwd(), "..", "data", "scenario_library.json")
  try {
    const raw = fs.readFileSync(libraryPath, "utf8")
    const mapped = mapLibraryToScenarios(JSON.parse(raw) as ScenarioLibrary)
    return mapped.length > 0 ? mapped : FALLBACK_SCENARIOS
  } catch (error) {
    console.warn("Failed to load dynamic scenario library, using fallback scenarios.", error)
    return FALLBACK_SCENARIOS
  }
}

export default function Page() {
  const variantsEnabled = process.env.STORY_VARIANTS_ENABLED?.trim().toLowerCase() !== "false"
  const variants = variantsEnabled ? (bundledStoryVariants as StoryVariantLibrary).variants : []
  return <TrainingApp scenarios={loadScenarios()} variants={variants} />
}
