from typing import List, Tuple, Dict

class FraudDetector:
    """
    在训练结束后，分析整个对话记录，判断用户是否成功识别诈骗。
    """
    
    # 识别成功的特征词
    SUCCESS_KEYWORDS = [
        "骗子", "报警", "110", "我不信", "挂了", "去警局", "去银行",
        "官方电话", "我不转", "不会给你验证码", "假的"
    ]
    
    # 识别失败（被骗）的特征词
    FAIL_KEYWORDS = [
        "验证码是", "我马上转", "多少钱", "密码是", "我转过去了", 
        "好的警官", "我这就去办"
    ]

    def evaluate_session(self, history: List[Dict[str, str]]) -> Tuple[bool, str]:
        """
        根据对话历史评估结果。
        history 格式: [{"role": "user", "content": "..."}]
        返回: (是否识别成功, 分析说明)
        """
        success_score = 0
        fail_score = 0
        
        user_messages = [msg["content"] for msg in history if msg["role"] == "user"]
        
        if not user_messages:
            return False, "用户未进行有效对话。"
            
        full_user_text = " ".join(user_messages)
        
        for kw in self.SUCCESS_KEYWORDS:
            if kw in full_user_text:
                success_score += 1
                
        for kw in self.FAIL_KEYWORDS:
            if kw in full_user_text:
                fail_score += 1
                
        # 简单规则：如果有成功识别词汇且没有严重泄露词汇，算成功。
        is_identified = success_score > 0 and fail_score == 0
        
        if is_identified:
            analysis = "恭喜！您在对话中明确提出了质疑，拒绝了对方的要求，成功识破了诈骗套路。"
        else:
            if fail_score > 0:
                analysis = "很遗憾，您在对话中顺从了骗子的引导，甚至可能泄露了关键信息（如转账意愿、验证码等），未能识破骗局。"
            else:
                analysis = "您在对话中未能明确拒绝骗子的要求或揭穿其身份。面对此类情况，应当果断挂断电话并核实。"
                
        return is_identified, analysis
