from __future__ import annotations

import json
import random
import re
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Dict, Iterable, List, Tuple


DATA_PATH = Path(__file__).resolve().parents[2] / "data" / "teleantifraud_1000" / "processed_layers" / "teleantifraud_system_material_library.json"
SUPPLEMENTAL_DATA_PATH = Path(__file__).resolve().parents[2] / "data" / "teleantifraud_1000" / "processed_layers" / "teleantifraud_supplemental_scene_materials.json"


@dataclass(frozen=True)
class MaterialSample:
    sample_id: str
    subtype: str
    quality_score: int
    risk_tags: str
    opening_candidate: str
    full_text: str
    suggested_usage: str


RISK_KEYWORDS = [
    "验证码", "密码", "银行卡", "身份证", "账户", "转账", "支付", "罚款", "手续费",
    "保证金", "下载", "链接", "APP", "安全账户", "冻结", "洗钱", "公安", "警官",
    "客服", "银行", "快递", "包裹", "中奖", "投资", "收益", "贷款", "医保", "社保",
    "马上", "立即", "尽快", "不要挂", "不要告诉", "名额", "逾期",
]

EXTRA_RISK_KEYWORDS = ["刷单", "兼职", "返利", "垫付", "佣金", "保健", "健康", "专家", "体检", "讲座", "礼品", "调理", "征信", "信用修复", "征信修复", "逾期", "黑名单", "培训费", "补课费", "押金", "报名费"]

USER_SKEPTICAL_HINTS = [
    "我不", "不用", "不要", "不信", "骗子", "报警", "核实", "真的吗", "怎么证明",
    "不太对", "有点奇怪", "我先问", "我挂", "举报", "公安局工作", "我得上网",
    "我先查", "我先确认", "我需要确认", "我还是", "我觉得", "怎么知道",
    "能告诉我", "您能告诉我", "不可能", "太离谱",
]

SCENE_KEYWORDS: Dict[str, List[Tuple[str, float]]] = {
    "SC-01": [("公安", 4), ("警官", 4), ("警察", 4), ("公检法", 5), ("警局", 4), ("案件", 3), ("涉案", 4), ("洗钱", 4), ("犯罪", 3), ("调查", 2), ("身份信息", 2)],
    "SC-02": [("投资", 5), ("理财", 5), ("收益", 4), ("年化", 4), ("平台", 2), ("金融顾问", 5), ("项目", 2), ("股票", 3), ("基金", 3), ("稳赚", 4), ("高回报", 4)],
    "SC-03": [("刷单", 6), ("兼职", 4), ("做任务", 5), ("返利", 5), ("垫付", 4), ("店铺", 2), ("佣金", 3)],
    "SC-04": [("保健", 6), ("健康", 4), ("专家", 3), ("医生", 3), ("讲座", 4), ("血压", 3), ("睡眠", 3), ("礼品", 3), ("免费体检", 5), ("中药", 3)],
    "SC-05": [("中奖", 6), ("奖品", 5), ("领奖", 5), ("抽奖", 5), ("保证金", 3), ("税费", 4), ("兑奖", 5)],
    "SC-06": [("妈", 3), ("爸", 3), ("儿子", 4), ("女儿", 4), ("孩子", 3), ("家里", 2), ("手机坏了", 5), ("换号码", 5), ("亲人", 3)],
    "SC-07": [("快递", 6), ("包裹", 6), ("物流", 5), ("海关", 4), ("运单", 5), ("派送", 3), ("签收", 3), ("赔付", 3)],
    "SC-08": [("退款", 6), ("退费", 6), ("客服", 2), ("订单", 4), ("赔偿", 4), ("商品", 3), ("售后", 4), ("商家", 2)],
    "SC-09": [("贷款", 6), ("借款", 5), ("额度", 4), ("放款", 5), ("征信", 2), ("手续费", 3), ("刷流水", 4)],
    "SC-10": [("征信修复", 7), ("修复征信", 7), ("信用修复", 6), ("黑名单", 5), ("征信记录", 5), ("信用记录", 4), ("征信", 3), ("信用", 2), ("逾期", 3), ("信用分", 4), ("不良记录", 5), ("异议申诉", 5), ("信用报告", 4)],
    "SC-11": [("医保", 6), ("社保", 6), ("养老金", 5), ("医疗", 3), ("报销", 4), ("医保卡", 6), ("社保卡", 6)],
    "SC-12": [("老同学", 6), ("熟人", 5), ("朋友", 3), ("借钱", 5), ("周转", 4), ("急用钱", 5), ("还你", 2)],
    "SC-13": [("银行", 5), ("账户", 4), ("异常交易", 6), ("银行卡", 5), ("冻结", 4), ("资金安全", 4), ("客服中心", 3), ("验证码", 3)],
    "SC-14": [("绑架", 7), ("勒索", 7), ("赎金", 7), ("被绑", 7), ("扣留", 5), ("家人安全", 5), ("不利", 3), ("伤害", 4)],
}


OPENING_FORBIDDEN: Dict[str, List[str]] = {
    "SC-03": ["邻居", "熟人", "老同学", "医院", "手术", "绑架"],
    "SC-09": ["朋友", "同事", "医院", "手术", "昏迷", "出事", "绑架", "赎金"],
    "SC-10": ["贷款额度", "马上放款", "贷款产品"],
}


def _clean_text(text: object) -> str:
    return re.sub(r"\s+", "", str(text or "")).strip()


def _trim(text: str, limit: int = 120) -> str:
    text = _clean_text(text)
    return text if len(text) <= limit else text[: limit - 1] + "。"


def _normalize_opening(text: str, limit: int = 110) -> str:
    text = _clean_text(text)
    if not text:
        return ""
    parts = [part for part in re.split(r"(?<=[。！？?])", text) if part]
    if not parts:
        return _trim(text, limit)
    opening = parts[0]
    if len(opening) < 26 and len(parts) > 1:
        opening += parts[1]
    return _trim(opening, limit)


def _split_sentences(text: str) -> List[str]:
    text = _clean_text(text)
    if not text:
        return []
    parts = re.split(r"(?<=[。！？?])", text)
    sentences = []
    for part in parts:
        item = _clean_text(part)
        if 16 <= len(item) <= 140:
            sentences.append(item)
    return sentences


def _looks_like_scammer_line(sentence: str) -> bool:
    if any(hint in sentence[:44] for hint in USER_SKEPTICAL_HINTS):
        return False
    if any(hint in sentence for hint in ["骗子", "举报", "公安局工作", "官方渠道核实"]):
        return False
    pressure_words = ["马上", "立即", "尽快", "不要挂", "不要告诉", "配合", "提供", "支付", "转账", "下载", "验证码", "安全账户", "名额", "逾期", "冻结", "收益", "风险", "项目", "投资", "保证", "机会", "刷单", "返利", "垫付", "佣金", "健康", "专家", "调理", "征信", "信用", "报名", "培训"]
    risk_hit = any(keyword in sentence for keyword in RISK_KEYWORDS + EXTRA_RISK_KEYWORDS)
    pressure_hit = any(word in sentence for word in pressure_words)
    identity_hit = any(word in sentence for word in ["我是", "这里是", "我们是", "客服", "警官", "银行", "快递", "平台", "专家"])
    return risk_hit and (pressure_hit or identity_hit)


def _sample_from_raw(raw: dict) -> MaterialSample:
    return MaterialSample(
        sample_id=str(raw.get("sample_id", "")).strip(),
        subtype=str(raw.get("subtype", "")).strip(),
        quality_score=int(raw.get("quality_score") or 0),
        risk_tags=str(raw.get("risk_tags", "")).strip(),
        opening_candidate=_normalize_opening(str(raw.get("opening_candidate", "")).strip(), 110),
        full_text=str(raw.get("full_text", "")).strip(),
        suggested_usage=str(raw.get("suggested_usage", "")).strip(),
    )


def _scene_score(scene_id: str, sample: MaterialSample) -> float:
    opening = sample.opening_candidate
    lead = sample.full_text[:420]
    tail = sample.full_text[420:]
    meta = f"{sample.subtype} {sample.risk_tags} {sample.suggested_usage}"
    score = 0.0
    for keyword, weight in SCENE_KEYWORDS.get(scene_id, []):
        if keyword in opening:
            score += weight * 4.0
        if keyword in lead:
            score += weight * 2.0
        if keyword in meta:
            score += weight * 0.25
        if keyword in tail:
            score += weight * 0.3
    return score


def _opening_score(scene_id: str, opening: str) -> float:
    return sum(weight for keyword, weight in SCENE_KEYWORDS.get(scene_id, []) if keyword in opening)


def _classify_scene(sample: MaterialSample, raw_scene_id: str) -> str:
    scores = {scene_id: _scene_score(scene_id, sample) for scene_id in SCENE_KEYWORDS}
    best_scene, best_score = max(scores.items(), key=lambda item: item[1])
    if best_score >= 5.0:
        return best_scene
    return ""


@lru_cache(maxsize=1)
def load_system_materials() -> Dict[str, List[MaterialSample]]:
    by_scene: Dict[str, List[MaterialSample]] = {}
    seen_by_scene: Dict[str, set] = {}

    for data_path in (DATA_PATH, SUPPLEMENTAL_DATA_PATH):
        if not data_path.exists():
            continue
        try:
            raw = json.loads(data_path.read_text(encoding="utf-8"))
        except Exception:
            continue

        for item in raw.values():
            raw_scene_id = str(item.get("scene_id", "")).strip()
            for raw_sample in item.get("samples", []):
                sample = _sample_from_raw(raw_sample)
                if not sample.sample_id or not sample.full_text:
                    continue
                scene_id = _classify_scene(sample, raw_scene_id)
                if not scene_id:
                    continue
                seen_key = (sample.sample_id, sample.opening_candidate)
                if seen_key in seen_by_scene.setdefault(scene_id, set()):
                    continue
                seen_by_scene[scene_id].add(seen_key)
                by_scene.setdefault(scene_id, []).append(sample)

    for samples in by_scene.values():
        samples.sort(key=lambda sample: (sample.quality_score, len(sample.full_text)), reverse=True)
    return by_scene


def get_scene_materials(scene_id: str) -> List[MaterialSample]:
    return load_system_materials().get(scene_id, [])


def material_openings(scene_id: str, limit: int = 30) -> List[str]:
    lines = []
    seen = set()
    for sample in get_scene_materials(scene_id):
        opening = _trim(sample.opening_candidate, 130)
        if len(opening) < 18 or opening in seen:
            continue
        if _opening_score(scene_id, opening) < 3.0:
            continue
        if any(term in opening for term in OPENING_FORBIDDEN.get(scene_id, [])):
            continue
        seen.add(opening)
        lines.append(opening)
        if len(lines) >= limit:
            break
    return lines


def material_typical_lines(scene_id: str, limit: int = 45) -> List[str]:
    lines = []
    seen = set()
    for sample in get_scene_materials(scene_id):
        for sentence in _split_sentences(sample.full_text):
            sentence = _trim(sentence, 120)
            if sentence in seen or not _looks_like_scammer_line(sentence):
                continue
            seen.add(sentence)
            lines.append(sentence)
            if len(lines) >= limit:
                return lines
    return lines


def material_report_examples(scene_id: str, limit: int = 8) -> List[str]:
    examples = []
    seen = set()
    for sample in get_scene_materials(scene_id):
        text = _trim(sample.full_text, 420)
        if len(text) < 80 or text in seen:
            continue
        seen.add(text)
        examples.append(text)
        if len(examples) >= limit:
            break
    return examples


def material_sample_ids(scene_id: str, limit: int = 60) -> List[str]:
    return [sample.sample_id for sample in get_scene_materials(scene_id)[:limit]]


def choose_material_reply(scene_id: str, user_text: str = "") -> str:
    openings = material_openings(scene_id, limit=30)
    lines = material_typical_lines(scene_id, limit=80)
    if not openings and len(lines) < 10:
        return ""
    if not lines:
        if not openings:
            return ""
        return random.choice(openings)

    user_text = _clean_text(user_text)
    if any(word in user_text for word in ["为什么", "怎么", "真的吗", "安全吗", "证明"]):
        candidates = [line for line in lines if any(k in line for k in ["放心", "安全", "核实", "官方", "正规", "保证"])]
    elif any(word in user_text for word in ["钱", "转", "验证码", "银行卡", "身份证"]):
        candidates = [line for line in lines if any(k in line for k in ["账户", "验证码", "银行卡", "身份", "支付", "转账"])]
    else:
        candidates = lines
    return random.choice(candidates or lines)


def augment_scene_definition(scene) -> None:
    scene_id = getattr(scene, "id", "")
    openings = material_openings(scene_id)
    typical = material_typical_lines(scene_id)
    reports = material_report_examples(scene_id)
    sample_ids = material_sample_ids(scene_id)
    if not openings and len(typical) < 10 and len(reports) < 3:
        typical = []
        reports = []
        sample_ids = []

    def merge_unique(current: Iterable[str], extra: Iterable[str], max_items: int) -> List[str]:
        merged = []
        seen = set()
        for item in list(extra) + list(current):
            text = _trim(item, 480)
            if text and text not in seen:
                seen.add(text)
                merged.append(text)
            if len(merged) >= max_items:
                break
        return merged

    scene.openings = merge_unique(getattr(scene, "openings", []), openings, 40)
    scene.typical_lines = merge_unique(getattr(scene, "typical_lines", []), typical, 70)
    scene.report_examples = merge_unique(getattr(scene, "report_examples", []), reports, 12)
    scene.source_sample_ids = merge_unique(getattr(scene, "source_sample_ids", []), sample_ids, 80)
    if openings or typical or reports:
        has_supplemental = any(str(sample_id).startswith("supp-") for sample_id in sample_ids)
        scene.source = "teleantifraud_1000+supplemental" if has_supplemental else "teleantifraud_1000"
