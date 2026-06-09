from dataclasses import dataclass
from typing import Dict

@dataclass
class SceneDefinition:
    id: str
    name: str
    core_tactics: str
    difficulty: str
    backstory: str

SCENES: Dict[str, SceneDefinition] = {
    "SC-01": SceneDefinition(
        id="SC-01",
        name="冒充公检法",
        core_tactics="恐吓、权威施压、信息隔离",
        difficulty="高难度",
        backstory="诈骗分子冒充公安局或检察院工作人员，声称受害者的银行卡涉嫌洗钱或身份信息被盗用，要求受害者将资金转移到所谓的“安全账户”进行审查。"
    ),
    "SC-02": SceneDefinition(
        id="SC-02",
        name="投资理财诈骗",
        core_tactics="高额回报诱惑、虚假内部消息、饥饿营销",
        difficulty="高难度",
        backstory="诈骗分子包装成金融专家或内部知情人士，通过推荐所谓的“高收益、低风险”理财项目或内幕股票，诱导受害者在虚假平台上投入大量资金。"
    ),
    "SC-03": SceneDefinition(
        id="SC-03",
        name="网络刷单诈骗",
        core_tactics="小额返利建立信任、沉没成本陷阱",
        difficulty="中难度",
        backstory="以“轻松兼职，日赚百元”为噱头，最初几单给予小额返利让受害者尝到甜头，随后要求大额垫资，以各种理由拒绝返本付息。"
    ),
    "SC-04": SceneDefinition(
        id="SC-04",
        name="保健品骗局",
        core_tactics="打亲情牌、夸大功效、虚假专家问诊",
        difficulty="中难度",
        backstory="专门针对老年人，通过举办免费讲座、赠送小礼品等方式建立感情，随后夸大老年人身体问题，推销价格极其昂贵但无实际疗效的保健品。"
    ),
    "SC-05": SceneDefinition(
        id="SC-05",
        name="虚假中奖",
        core_tactics="惊喜刺激、时间压迫、预交保证金",
        difficulty="低-中难度",
        backstory="通过短信或网络平台发送中奖信息，声称受害者中了巨额大奖或贵重物品，但要求在领奖前先支付手续费、税费或公证费等。"
    ),
    "SC-06": SceneDefinition(
        id="SC-06",
        name="冒充子女",
        core_tactics="亲情软肋、紧急情况、避免核实",
        difficulty="高难度",
        backstory="通过短信或微信冒充受害者的子女，声称手机损坏换了新号码，并以交学费、培训班费用或突发急病为由，催促受害者立刻转账到指定账户。"
    )
}
