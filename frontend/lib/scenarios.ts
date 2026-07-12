import type { StoryVariant } from "@/lib/story-variants"

export type Difficulty = "低" | "中" | "高"
export type Channel = "phone" | "wechat"

export interface ScriptTurn {
  /** 骗子这一轮说的话 */
  line: string
  /** 这一轮被激活的心理弱点 */
  trigger?: string
  /** 这一轮结束后，风险的基础走向（正数升高，负数降低） */
  riskDelta: number
  /** 教练给出的即时应对建议 */
  coach: string
}

export interface Scenario {
  id: string
  code: string
  title: string
  difficulty: Difficulty
  channel: Channel
  /** 来电/对话对象显示名 */
  persona: string
  /** 头像文字 */
  avatar: string
  /** 归属地/来源标签 */
  source: string
  /** 一句话简介 */
  tagline: string
  /** 场景核心套路 */
  method: string
  script: ScriptTurn[]
  /** 本轮训练锁定的故事变体；旧场景和旧请求可不提供。 */
  variant?: StoryVariant
}

export const SCENARIOS: Scenario[] = [
  {
    id: "sc-01",
    code: "SC-01",
    title: "冒充公检法",
    difficulty: "高",
    channel: "phone",
    persona: "「XX市公安局」来电",
    avatar: "警",
    source: "显示归属地：北京 · 座机来电",
    tagline: "自称警官，声称你涉嫌洗钱，要求配合“资金清查”。",
    method: "制造恐惧 + 伪造权威 + 要求转账到“安全账户”",
    script: [
      {
        line: "喂，是张桂芬女士吗？这里是XX市公安局经侦大队，我姓王，警号058812。核实一下，你的身份证号是不是尾号3027？",
        trigger: "权威身份施压",
        riskDelta: 2,
        coach: "真正的公安不会通过电话核对身份、更不会办案。先别报出任何个人信息。",
      },
      {
        line: "现在有一起特大洗钱案，涉案银行卡是你名下开的。这是刑事案件，我们已经对你发起了逮捕令，你今天必须配合，否则马上上门抓人。",
        trigger: "恐惧与紧迫感",
        riskDelta: 3,
        coach: "“逮捕令、马上抓人”是典型恐吓话术。逮捕不会电话通知，情绪越急越要停。",
      },
      {
        line: "为了证明你的清白，需要把你银行卡里的钱转到我们指定的‘国家安全账户’做资金清查，查完原路退回。你现在方便去银行吗？",
        trigger: "利用信任 + 转账诱导",
        riskDelta: 4,
        coach: "世界上没有“安全账户”。任何要求转账的“清查”都是诈骗，此刻应立即挂断。",
      },
      {
        line: "这个案子是保密的，不能告诉任何家人，包括你的子女，否则算妨碍司法，你也要一起判刑。加我这个QQ，我把逮捕令发给你看。",
        trigger: "隔离亲友",
        riskDelta: 4,
        coach: "“不许告诉家人”是最危险的信号。正规办案从不要求保密，请立刻联系子女。",
      },
      {
        line: "你怎么不说话了？时间来不及了！你要是不配合，后果你自己承担！现在报一下你收到的手机验证码，我帮你走绿色通道！",
        trigger: "验证码窃取",
        riskDelta: 5,
        coach: "验证码 = 你的钱。任何人索要验证码都是诈骗，绝不能读出，直接挂断报警。",
      },
    ],
  },
  {
    id: "sc-02",
    code: "SC-02",
    title: "投资理财诈骗",
    difficulty: "高",
    channel: "wechat",
    persona: "理财导师 · 李老师",
    avatar: "财",
    source: "微信好友 · 来自“稳健盈”投资群",
    tagline: "拉你进“内部群”，晒收益截图，诱导下载假投资App。",
    method: "小额返利 + 从众心理 + 高收益诱惑",
    script: [
      {
        line: "阿姨您好！我是群里的李老师。看您一直在群里学习很认真，今天带大家做一支内部票，稳赚不亏，先带您体验一下。",
        trigger: "低门槛诱导",
        riskDelta: 2,
        coach: "“稳赚不亏”违背基本常识。凡是承诺保本高收益的投资都是骗局。",
      },
      {
        line: "您看群里其他叔叔阿姨，昨天跟单的都赚了，这是王姐的收益截图，一天8个点。您先投2000试试水，明天就能看到回报。",
        trigger: "从众 + 收益截图",
        riskDelta: 3,
        coach: "截图和群友都可能是“托”。真实盈利不会靠拉人进群，别被气氛带动。",
      },
      {
        line: "小赚了吧？说明我们平台是真的。现在有个原始股名额，投10万三个月翻倍，机会难得，名额今晚就没了。",
        trigger: "沉没成本 + 稀缺感",
        riskDelta: 4,
        coach: "先给甜头再放大投入是经典套路。“名额今晚就没”是逼你冲动，务必停下。",
      },
      {
        line: "怎么提现失败了？哦，您账户被风控了，需要先缴纳20%保证金解冻，解冻后本金收益一起到账。快点操作别耽误了。",
        trigger: "提现障碍收割",
        riskDelta: 5,
        coach: "提现要交钱=100%诈骗。此刻钱已进骗子口袋，立刻停止转账并报警。",
      },
    ],
  },
  {
    id: "sc-03",
    code: "SC-03",
    title: "网络刷单诈骗",
    difficulty: "中",
    channel: "wechat",
    persona: "兼职客服 · 小雨",
    avatar: "单",
    source: "微信 · “轻松居家兼职”",
    tagline: "在家动动手指就能赚钱，先返小利再诱导垫付大单。",
    method: "小额返现 + 任务升级 + 垫付话术",
    script: [
      {
        line: "阿姨在家闲着也是闲着，做点手机兼职吧~ 关注店铺截图给我就返5块，做几单一天轻松赚一两百，不耽误带孙子。",
        trigger: "轻松赚钱诱惑",
        riskDelta: 2,
        coach: "“动动手指就赚钱”是刷单诈骗开场白。刷单本身违法，正规兼职不会先返利。",
      },
      {
        line: "看，5块到账了吧？您做得真好！现在升级做组合任务，垫付198元拍3单，完成后连本带佣金216元一起返，秒到的。",
        trigger: "小利建立信任",
        riskDelta: 3,
        coach: "小额返现是诱饵，目的是让你相信平台。一旦要你垫付本金就要警觉。",
      },
      {
        line: "哎呀您这单没做完整，系统卡单了，要再做一组连续任务才能激活提现，这次垫付2980，做完全部退还，别放弃前面的努力呀。",
        trigger: "沉没成本套牢",
        riskDelta: 5,
        coach: "“卡单、再充才能提现”是收割信号。已投入的钱不要用新投入去追，立即止损。",
      },
    ],
  },
  {
    id: "sc-04",
    code: "SC-04",
    title: "保健品骗局",
    difficulty: "中",
    channel: "phone",
    persona: "健康顾问 · 陈主任",
    avatar: "康",
    source: "来电 · “老年健康关爱中心”",
    tagline: "免费体检查出“大病”，高价推销包治百病的保健品。",
    method: "健康焦虑 + 亲情攻势 + 权威包装",
    script: [
      {
        line: "叔叔您好，我是健康关爱中心的陈主任。上次免费体检您的报告出来了，指标有点不太好，血管堵塞比较严重，得赶紧调理啊。",
        trigger: "健康焦虑",
        riskDelta: 2,
        coach: "免费体检查出“重病”多是话术。身体问题请到正规医院复查，别信电话诊断。",
      },
      {
        line: "我们有一款进口的专利产品，专门通血管，好多老领导都在吃，一个疗程八千八，您的病拖不得，为了健康这钱不能省啊。",
        trigger: "权威背书 + 恐吓",
        riskDelta: 3,
        coach: "“包治百病、老领导都吃”都是虚假宣传。保健品不是药，不能治病。",
      },
      {
        line: "叔叔您就当我是您孩子，我是真心为您好。今天订三个疗程还送按摩仪，名额有限，您先把钱转过来我给您留货。",
        trigger: "亲情攻势",
        riskDelta: 4,
        coach: "用“干儿子干女儿”博感情是套路。买前先和真正的子女商量，别当场付款。",
      },
    ],
  },
  {
    id: "sc-05",
    code: "SC-05",
    title: "虚假中奖",
    difficulty: "低",
    channel: "wechat",
    persona: "活动通知 · 官方客服",
    avatar: "奖",
    source: "短信/微信 · 中奖链接",
    tagline: "恭喜中大奖，先交“手续费/个人所得税”才能领取。",
    method: "意外之财 + 先交后领 + 链接钓鱼",
    script: [
      {
        line: "【恭喜】尊敬的用户，您的手机号在周年庆抽中二等奖：华为笔记本一台+现金8888元！请点击链接登记领取。",
        trigger: "意外惊喜",
        riskDelta: 2,
        coach: "没参加过的抽奖突然中奖，一定是假的。不点陌生链接、不填个人信息。",
      },
      {
        line: "您好，领奖需要先缴纳个人所得税和保价运费共600元，缴费后奖品当天寄出，费用最后会随奖金一起返还给您。",
        trigger: "先交后领",
        riskDelta: 4,
        coach: "正规中奖绝不会让你先交钱。“先交税费再领奖”100%是诈骗，直接删除。",
      },
    ],
  },
  {
    id: "sc-06",
    code: "SC-06",
    title: "冒充子女",
    difficulty: "高",
    channel: "wechat",
    persona: "「女儿」小雪",
    avatar: "亲",
    source: "陌生微信 · 头像盗用你女儿照片",
    tagline: "盗用子女身份，谎称手机坏了急需用钱交学费/押金。",
    method: "冒充亲人 + 制造急事 + 阻止核实",
    script: [
      {
        line: "妈，我手机摔坏了，这是我同学的微信先加你。我这边报培训班要交学费，老师催得急，你先帮我转1万5，回头我给你。",
        trigger: "亲情信任",
        riskDelta: 3,
        coach: "陌生号码自称子女要转账，务必先用原来的电话打回去核实身份。",
      },
      {
        line: "别打我旧号码啦，摔坏了打不通，你打了我也接不了，耽误交费我就没名额了。你就把钱转到老师这个账户，账号我发你。",
        trigger: "阻止核实",
        riskDelta: 5,
        coach: "“别打电话、直接转账”是最强警报。越是不让核实，越要坚持当面或视频确认。",
      },
      {
        line: "妈你怎么还不信我呀，我是你女儿啊！再晚就来不及了，你是不是不心疼我了？先转5000也行，剩下的我想办法。",
        trigger: "情感绑架",
        riskDelta: 4,
        coach: "用“不爱我了”施压是冒充者惯用手段。稳住情绪，核实身份前一分钱都不转。",
      },
    ],
  },
]

/** 用户防御性回复关键词——命中会降低风险 */
export const DEFENSIVE_KEYWORDS = [
  "不", "假", "骗", "挂", "报警", "110", "核实", "不转", "不给", "不信",
  "子女", "儿子", "女儿", "银行", "亲自", "当面", "视频", "不可能", "拒绝",
]

/** 用户风险性回复关键词——命中会升高风险 */
export const RISKY_KEYWORDS = [
  "好的", "转", "验证码", "银行卡", "密码", "多少钱", "怎么弄", "相信",
  "马上", "现在就", "我这就", "账号", "同意", "买",
]

export function evaluateReply(text: string): { delta: number; hitDefensive: boolean; hitRisky: boolean } {
  const hitDefensive = DEFENSIVE_KEYWORDS.some((k) => text.includes(k))
  const hitRisky = RISKY_KEYWORDS.some((k) => text.includes(k))
  let delta = 0
  if (hitDefensive) delta -= 2.5
  if (hitRisky) delta += 2.5
  return { delta, hitDefensive, hitRisky }
}

export function riskLevel(score: number): { label: string; tone: "safe" | "warning" | "danger" } {
  if (score < 3.5) return { label: "低", tone: "safe" }
  if (score < 6.5) return { label: "中", tone: "warning" }
  return { label: "高", tone: "danger" }
}
