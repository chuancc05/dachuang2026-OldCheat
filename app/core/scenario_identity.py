"""Shared identity-safety helpers for the legacy Python/Gradio surface."""
from __future__ import annotations

import re
from copy import deepcopy
from typing import Any, Dict, Iterable, List, Tuple

UNKNOWN_TRAINEE_FORBIDDEN_TERMS = [
    "叔叔", "阿姨", "先生", "女士", "大哥", "大姐", "爷爷", "奶奶", "妈妈", "爸爸"
]

RELATION_TERMS = [
    "女儿", "儿子", "孙子", "孙女", "外甥", "外甥女", "侄子", "侄女",
    "父亲", "母亲", "爸爸", "妈妈", "妻子", "丈夫", "老伴", "姐姐", "妹妹",
    "哥哥", "弟弟", "孩子", "家人", "亲属",
]

KNOWN_CALLER_NAMES = [
    "小王", "小李", "小张", "小赵", "小陈", "小军", "李华", "王强", "阿强",
    "陈主任", "张主任",
]

FEMALE_VOICES = {"Mia", "Cherry", "Maia", "Serena"}
MALE_VOICES = {"Kai", "Moon", "Neil", "Ethan", "Vincent"}


def normalize_identity_contract(variant: Dict[str, Any] | None) -> Dict[str, Any]:
    variant = variant or {}
    raw = variant.get("identityContract") if isinstance(variant.get("identityContract"), dict) else {}
    trainee = raw.get("trainee") if isinstance(raw.get("trainee"), dict) else {}
    caller = raw.get("caller") if isinstance(raw.get("caller"), dict) else {}
    subject = raw.get("subject") if isinstance(raw.get("subject"), dict) else {}
    distress = raw.get("distressCue") if isinstance(raw.get("distressCue"), dict) else None
    forbidden = list(dict.fromkeys([
        *UNKNOWN_TRAINEE_FORBIDDEN_TERMS,
        *[str(item).strip() for item in raw.get("forbiddenTerms", []) if str(item).strip()],
    ]))
    contract: Dict[str, Any] = {
        "version": int(raw.get("version") or 1),
        "trainee": {"gender": trainee.get("gender", "unknown"), "address": trainee.get("address") or "您"},
        "caller": {
            "role": caller.get("role") or variant.get("persona") or "诈骗情境来电人",
            "displayName": caller.get("displayName") or "",
            "gender": caller.get("gender", "unknown"),
            "voiceProfile": caller.get("voiceProfile") or "scenario-default",
        },
        "subject": {
            "kind": subject.get("kind", "event"),
            "relation": subject.get("relation") or "",
            "name": subject.get("name") or "",
            "gender": subject.get("gender", "unknown"),
            "ageGroup": subject.get("ageGroup", "unknown"),
            "aliases": [str(item).strip() for item in subject.get("aliases", []) if str(item).strip()],
        },
        "forbiddenTerms": forbidden,
    }
    if distress is not None:
        contract["distressCue"] = deepcopy(distress)
    return contract


def _contains_term(text: str, term: str) -> bool:
    if term == "他":
        return term in text.replace("其他", "")
    return term in text


def find_identity_conflicts(text: str, contract: Dict[str, Any]) -> List[str]:
    conflicts = [term for term in contract.get("forbiddenTerms", []) if _contains_term(text, term)]
    subject = contract.get("subject", {})
    if subject.get("kind") == "relative":
        allowed = " ".join([
            str(subject.get("relation", "")),
            str(subject.get("name", "")),
            *[str(item) for item in subject.get("aliases", [])],
        ])
        conflicts.extend(term for term in RELATION_TERMS if _contains_term(text, term) and term not in allowed)
    caller = contract.get("caller", {})
    expected_name = str(caller.get("displayName", ""))
    intro = text[:80]
    if expected_name and re.search(r"(?:我是|我叫|这里是|这边是|来自)", intro):
        conflicts.extend(name for name in KNOWN_CALLER_NAMES if name != expected_name and name in intro)
    return list(dict.fromkeys(conflicts))


def sanitize_identity_text(text: str, contract: Dict[str, Any]) -> Tuple[str, List[str]]:
    value = re.sub(r"\s+", " ", str(text or "")).strip()
    if contract.get("trainee", {}).get("gender") == "unknown":
        value = re.sub(r"^(?:叔叔|阿姨|先生|女士|大哥|大姐|爷爷|奶奶)(?:您好|好)?[，,：:\s]*", "您好，", value)
        value = re.sub(r"^(?:妈妈|爸爸|妈|爸|奶奶|爷爷)[，,：:\s]*", "", value)
    return value, find_identity_conflicts(value, contract)


def identity_prompt_lines(contract: Dict[str, Any]) -> Iterable[str]:
    subject = contract.get("subject", {})
    subject_label = f"{subject.get('relation', '')}{subject.get('name', '')}" or subject.get("kind", "事件")
    aliases = "、".join(subject.get("aliases", [])) or "使用中性事件称呼"
    forbidden = "、".join(contract.get("forbiddenTerms", [])) or "无"
    yield "以下身份契约优先级最高，任何参考语料都不得覆盖："
    yield f"- 受训者性别：{contract.get('trainee', {}).get('gender', 'unknown')}；只能称呼为“{contract.get('trainee', {}).get('address', '您')}”。"
    yield f"- 来电人：{contract.get('caller', {}).get('role', '')}。"
    yield f"- 事件对象：{subject_label}；允许称呼：{aliases}。"
    yield f"- 禁止身份与称谓：{forbidden}。"


def normalize_story_variant(variant: Dict[str, Any]) -> Dict[str, Any]:
    normalized = deepcopy(variant)
    contract = normalize_identity_contract(normalized)
    opening, opening_conflicts = sanitize_identity_text(normalized.get("opening", ""), contract)
    if opening_conflicts:
        raise ValueError(f"{normalized.get('id')} opening identity conflict: {'、'.join(opening_conflicts)}")
    subject = contract.get("subject", {})
    if subject.get("kind") == "relative":
        aliases = [str(item) for item in subject.get("aliases", []) if str(item)]
        if not aliases or not any(alias in opening for alias in aliases):
            raise ValueError(f"{normalized.get('id')} relative opening must use an allowed alias")
    distress = contract.get("distressCue", {})
    if distress.get("enabled"):
        voice = str(distress.get("voice", ""))
        if not str(distress.get("text", "")) or not voice:
            raise ValueError(f"{normalized.get('id')} enabled distress cue requires text and voice")
        if subject.get("gender") == "female" and voice in MALE_VOICES:
            raise ValueError(f"{normalized.get('id')} female subject cannot use a male distress voice")
        if subject.get("gender") == "male" and voice in FEMALE_VOICES:
            raise ValueError(f"{normalized.get('id')} male subject cannot use a female distress voice")
    fallback_lines = []
    for line in normalized.get("fallbackLines", []):
        safe_line, conflicts = sanitize_identity_text(line, contract)
        if conflicts:
            raise ValueError(f"{normalized.get('id')} fallback identity conflict: {'、'.join(conflicts)}")
        fallback_lines.append(safe_line)
    normalized["opening"] = opening
    normalized["fallbackLines"] = fallback_lines
    normalized["identityContract"] = contract
    return normalized


def safe_variant_reply(variant: Dict[str, Any] | None, text: str, fallback_index: int = 0) -> str:
    contract = normalize_identity_contract(variant)
    safe, conflicts = sanitize_identity_text(text, contract)
    if not conflicts:
        return safe
    lines = (variant or {}).get("fallbackLines", [])
    if lines:
        candidate, candidate_conflicts = sanitize_identity_text(lines[fallback_index % len(lines)], contract)
        if not candidate_conflicts:
            return candidate
    return "您好，请先不要进行任何转账或提供敏感信息。"
