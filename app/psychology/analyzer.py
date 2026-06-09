from typing import Dict
from .dimensions import DIMENSIONS

class PsychologyAnalyzer:
    """
    轻量级心理分析引擎，基于规则与关键词匹配对用户文本进行分析。
    """
    def __init__(self):
        self.dimensions = DIMENSIONS

    def analyze_turn(self, user_text: str, ai_previous_text: str = "") -> Dict[str, float]:
        """
        分析当前轮次，返回12个维度的原始评分 (0-10)
        """
        scores = {}
        text_to_analyze = user_text
        
        # 将某些否定词提取，防止简单匹配
        negation_context = any(word in text_to_analyze for word in ["不", "没", "别", "停止", "假"])

        for dim_id, dim in self.dimensions.items():
            score = 0.0
            
            # 正向关键词匹配
            for kw in dim.positive_keywords:
                if kw in text_to_analyze:
                    # 如果存在否定前缀，可能是在拒绝
                    if negation_context:
                        score += 1.0  # 稍微加一点分，可能还在谈论这个话题
                    else:
                        score += 3.0  # 命中正向关键词，加3分

            # 负向关键词匹配（代表用户警觉）
            for kw in dim.negative_keywords:
                if kw in text_to_analyze:
                    score -= 2.0
            
            # 基础文本长度启发式（越慌乱/急切，可能回复越短，或者在陪伴维度回复越长）
            if dim_id in ["S-02", "E-02"]: # 冲动或恐惧，通常回复短
                if len(text_to_analyze) < 5 and score > 0:
                    score += 1.0
            elif dim_id in ["S-03", "E-01"]: # 渴望陪伴或孤独，通常愿意说很多
                if len(text_to_analyze) > 20:
                    score += 2.0
                    
            # 限定分值在 0 - 10 之间
            scores[dim_id] = max(0.0, min(10.0, score))

        return scores
