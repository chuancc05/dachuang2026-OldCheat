from typing import Dict, List, Tuple
from collections import deque

class ScoreTracker:
    """
    负责记录和计算会话过程中心理弱点分数的滑动均值。
    """
    def __init__(self, window_size: int = 3):
        self.window_size = window_size
        self.history: List[Dict[str, float]] = []
        self.current_smooth_scores: Dict[str, float] = {
            f"{cat}-{str(i).zfill(2)}": 0.0
            for cat in ["E", "L", "C", "S"]
            for i in range(1, 4)
        }

    def add_scores(self, raw_scores_dict: Dict[str, float]):
        """
        添加新的一轮原始分数，并更新滑动均值。
        公式: smooth = 0.6 * current + 0.3 * prev1 + 0.1 * prev2 (假设window_size=3)
        """
        self.history.append(raw_scores_dict)
        
        # 取最后 window_size 轮
        recent = self.history[-self.window_size:]
        weights = [0.1, 0.3, 0.6][-len(recent):]
        # 归一化权重
        weight_sum = sum(weights)
        weights = [w / weight_sum for w in weights]
        
        for dim_id in self.current_smooth_scores.keys():
            smooth = 0.0
            for i, scores in enumerate(recent):
                smooth += scores.get(dim_id, 0.0) * weights[i]
            self.current_smooth_scores[dim_id] = round(smooth, 2)

    def get_current_smooth_scores(self) -> Dict[str, float]:
        return self.current_smooth_scores
        
    def get_composite_score(self) -> float:
        """
        计算整体风险分，取最高3个维度的平均值，以突出主要风险。
        """
        scores = list(self.current_smooth_scores.values())
        scores.sort(reverse=True)
        top_3 = scores[:3]
        if not top_3:
            return 0.0
        return round(sum(top_3) / len(top_3), 2)

    def get_top_activated_dimensions(self, n: int = 3) -> List[Tuple[str, float]]:
        """
        获取当前激活最强的N个维度
        """
        sorted_dims = sorted(self.current_smooth_scores.items(), key=lambda x: x[1], reverse=True)
        return sorted_dims[:n]
