"""
Generate a clear trigger-factor chart for the personalized anti-fraud report.
"""

from __future__ import annotations

import logging
import os
from typing import Dict, List, Tuple

from app.config import DATA_DIR

os.environ.setdefault("MPLCONFIGDIR", str(DATA_DIR / "matplotlib"))

import matplotlib.pyplot as plt

logger = logging.getLogger(__name__)


def _bar_color(value: float) -> str:
    if value >= 6.5:
        return "#e85d45"
    if value >= 3.5:
        return "#f3a23a"
    return "#4f9d69"


def _short_label(label: str, max_len: int = 14) -> str:
    clean = str(label).replace("：", ":").strip()
    if len(clean) <= max_len:
        return clean
    return clean[: max_len - 1] + "..."


def _rank_scores(scores: Dict[str, float], limit: int = 6) -> List[Tuple[str, float]]:
    ranked = sorted(
        ((str(label), max(0.0, min(10.0, float(value)))) for label, value in scores.items()),
        key=lambda item: item[1],
        reverse=True,
    )
    positive = [item for item in ranked if item[1] > 0]
    return (positive or ranked)[:limit]


def generate_radar_chart(scores: Dict[str, float], output_path: str = "radar_chart.png") -> str:
    """
    Keep the public function name for compatibility, but render a clearer
    horizontal chart of the strongest psychological trigger factors.
    """
    if not scores:
        logger.error("No dimension score data; cannot generate trigger chart.")
        raise ValueError("维度得分数据不能为空")

    plt.rcParams["font.sans-serif"] = ["Microsoft YaHei", "SimHei", "Arial Unicode MS", "sans-serif"]
    plt.rcParams["axes.unicode_minus"] = False

    ranked = _rank_scores(scores)
    labels = [_short_label(label) for label, _ in ranked][::-1]
    values = [value for _, value in ranked][::-1]
    colors = [_bar_color(value) for value in values]

    fig_height = max(3.6, 0.55 * len(labels) + 1.7)
    fig, ax = plt.subplots(figsize=(8.2, fig_height))
    ax.barh(labels, values, color=colors, height=0.46)

    for idx, value in enumerate(values):
        ax.text(min(value + 0.2, 9.85), idx, f"{value:.1f}/10", va="center", fontsize=11, color="#1f2a44")

    ax.set_xlim(0, 10)
    ax.set_xlabel("触发强度", fontsize=11, color="#4b5563")
    ax.set_title("主要心理触发因素排行", fontsize=16, weight="bold", pad=16)
    ax.text(
        0,
        1.03,
        "分数越高，表示本次对话越容易被该心理弱点影响。",
        transform=ax.transAxes,
        fontsize=10.5,
        color="#5b6472",
    )
    ax.axvspan(0, 3.5, color="#eef8ef", zorder=-1)
    ax.axvspan(3.5, 6.5, color="#fff6df", zorder=-1)
    ax.axvspan(6.5, 10, color="#fff0ed", zorder=-1)
    ax.grid(axis="x", linestyle="--", linewidth=0.7, alpha=0.35)
    ax.spines[["top", "right", "left"]].set_visible(False)
    ax.tick_params(axis="y", length=0, labelsize=11)
    ax.tick_params(axis="x", labelsize=10)

    output_dir = os.path.dirname(os.path.abspath(output_path))
    if output_dir:
        os.makedirs(output_dir, exist_ok=True)

    try:
        fig.savefig(output_path, format="png", dpi=300, bbox_inches="tight", facecolor="white")
        plt.close(fig)
        logger.info("Trigger chart saved to %s", output_path)
        return os.path.abspath(output_path)
    except Exception as exc:
        plt.close(fig)
        logger.error("Failed to save trigger chart: %s", exc)
        raise
