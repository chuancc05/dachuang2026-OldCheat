"""受控故事变体加载与抽取；异常时返回 None，让旧场景逻辑继续工作。"""
from __future__ import annotations

import json
import logging
import os
import random
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, List

logger = logging.getLogger(__name__)
_last_selected: Dict[str, str] = {}


@lru_cache(maxsize=1)
def load_story_variants() -> List[Dict[str, Any]]:
    path = Path(__file__).resolve().parents[2] / "frontend" / "data" / "story-variants.json"
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
        return [item for item in payload.get("variants", []) if isinstance(item, dict) and item.get("enabled") is True and str(item.get("id", "")).startswith(f"{item.get('scenarioCode', '')}-V") and str(item.get("opening", "")).strip()]
    except Exception as exc:
        logger.warning("故事变体加载失败，继续使用原场景: %s", exc)
        return []


def choose_story_variant(scene_id: str) -> Dict[str, Any] | None:
    if os.getenv("STORY_VARIANTS_ENABLED", "true").strip().lower() == "false":
        return None
    pool = [item for item in load_story_variants() if item.get("scenarioCode") == scene_id]
    if not pool:
        return None
    previous = _last_selected.get(scene_id)
    selected = random.choice([item for item in pool if item.get("id") != previous] or pool)
    _last_selected[scene_id] = str(selected.get("id"))
    return json.loads(json.dumps(selected, ensure_ascii=False))
