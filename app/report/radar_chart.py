"""
生成受害者心理维度雷达图模块
"""

import os

from app.config import DATA_DIR

os.environ.setdefault("MPLCONFIGDIR", str(DATA_DIR / "matplotlib"))

import matplotlib.pyplot as plt
import numpy as np
import logging
from typing import Dict, List

logger = logging.getLogger(__name__)

def generate_radar_chart(scores: Dict[str, float], output_path: str = "radar_chart.png") -> str:
    """
    根据给定的维度得分生成雷达图并保存为图片
    
    :param scores: 包含12个维度及其得分的字典，得分范围建议为 0-10
    :param output_path: 输出图片的路径
    :return: 保存的图片绝对路径
    """
    # 配置中文字体，优先尝试常见的中文字体
    plt.rcParams['font.sans-serif'] = ['SimHei', 'Microsoft YaHei', 'Arial Unicode MS', 'sans-serif']
    plt.rcParams['axes.unicode_minus'] = False  # 正常显示负号

    # 提取标签和数值
    labels = list(scores.keys())
    values = list(scores.values())
    num_vars = len(labels)

    if num_vars == 0:
        logger.error("未提供维度得分数据，无法生成雷达图。")
        raise ValueError("维度得分数据不能为空")

    # 计算每个轴的角度
    angles = np.linspace(0, 2 * np.pi, num_vars, endpoint=False).tolist()

    # 为了让雷达图闭合，需要将第一个值和角度附加到最后
    values += values[:1]
    angles += angles[:1]
    
    # 建立图形
    fig, ax = plt.subplots(figsize=(8, 8), subplot_kw=dict(polar=True))
    
    # 绘制折线
    ax.plot(angles, values, color='#1f77b4', linewidth=2, linestyle='solid')
    
    # 填充颜色
    ax.fill(angles, values, color='#1f77b4', alpha=0.25)
    
    # 设置每个角度上的标签
    # ax.set_thetagrids 函数接受的是角度的度数
    angles_degrees = np.degrees(angles[:-1])
    ax.set_thetagrids(angles_degrees, labels, fontsize=12)
    
    # 设置径向网格线和刻度范围
    ax.set_ylim(0, 10)
    ax.set_yticks([2, 4, 6, 8, 10])
    ax.set_yticklabels(["2", "4", "6", "8", "10"], color="grey", size=10)
    
    # 添加标题
    plt.title("心理弱点多维分析", size=16, y=1.05)
    
    # 确保输出目录存在
    output_dir = os.path.dirname(os.path.abspath(output_path))
    if output_dir and not os.path.exists(output_dir):
        os.makedirs(output_dir, exist_ok=True)
        
    # 保存图片
    try:
        plt.savefig(output_path, format='png', dpi=300, bbox_inches='tight')
        plt.close()
        logger.info(f"雷达图已保存至: {output_path}")
        return os.path.abspath(output_path)
    except Exception as e:
        logger.error(f"保存雷达图失败: {e}")
        plt.close()
        raise
