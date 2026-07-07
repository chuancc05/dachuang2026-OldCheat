import json
import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List
from app.core.material_library import augment_scene_definition

logger = logging.getLogger(__name__)

@dataclass
class SceneDefinition:
    id: str
    name: str
    core_tactics: str
    difficulty: str
    backstory: str
    openings: List[str] = field(default_factory=list)
    typical_lines: List[str] = field(default_factory=list)
    report_examples: List[str] = field(default_factory=list)
    source_sample_ids: List[str] = field(default_factory=list)
    source: str = "builtin"

DEFAULT_SCENES: Dict[str, SceneDefinition] = {
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


def _load_external_scenes() -> Dict[str, SceneDefinition]:
    """
    Load optional scenario definitions from data/scenario_library.json.
    This keeps new fraud types data-driven instead of hard-coding every scene.
    """
    library_path = Path(__file__).resolve().parents[2] / "data" / "scenario_library.json"
    if not library_path.exists():
        return {}

    try:
        raw = json.loads(library_path.read_text(encoding="utf-8"))
    except Exception as exc:
        logger.warning("读取动态场景库失败: %s", exc)
        return {}

    scenes: Dict[str, SceneDefinition] = {}
    for item in raw.get("scenes", []):
        try:
            scene = SceneDefinition(
                id=str(item["id"]).strip(),
                name=str(item["name"]).strip(),
                core_tactics=str(item.get("core_tactics", "")).strip(),
                difficulty=str(item.get("difficulty", "中难度")).strip(),
                backstory=str(item.get("backstory", "")).strip(),
                openings=[str(text).strip() for text in item.get("openings", []) if str(text).strip()],
                typical_lines=[str(text).strip() for text in item.get("typical_lines", []) if str(text).strip()],
                report_examples=[str(text).strip() for text in item.get("report_examples", []) if str(text).strip()],
                source_sample_ids=[str(text).strip() for text in item.get("source_sample_ids", []) if str(text).strip()],
                source="external",
            )
        except Exception as exc:
            logger.warning("跳过无效动态场景: %s", exc)
            continue
        if scene.id and scene.name and scene.backstory:
            scenes[scene.id] = scene

    return scenes



def _augment_with_system_materials(scenes: Dict[str, SceneDefinition]) -> Dict[str, SceneDefinition]:
    for scene in scenes.values():
        try:
            augment_scene_definition(scene)
        except Exception as exc:
            logger.warning("加载TeleAntiFraud素材失败: %s", exc)
    return scenes


SCENES: Dict[str, SceneDefinition] = _augment_with_system_materials({**DEFAULT_SCENES, **_load_external_scenes()})
