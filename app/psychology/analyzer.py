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
        scores = {dim_id: 0.0 for dim_id in self.dimensions}
        user = (user_text or "").strip()
        ai = (ai_previous_text or "").strip()
        combined = f"{ai} {user}"

        refusal_words = ["骗子", "报警", "挂断", "我不信", "不转", "不给", "不能给", "官方", "核实", "问家人", "问银行", "问警察"]
        is_refusing = any(word in user for word in refusal_words)

        for dim_id, dim in self.dimensions.items():
            for kw in dim.positive_keywords:
                if kw in user:
                    scores[dim_id] += 2.8
                elif kw in ai:
                    scores[dim_id] += 0.8

            for kw in dim.negative_keywords:
                if kw in user:
                    scores[dim_id] -= 2.5

        def add(dim_id: str, value: float) -> None:
            scores[dim_id] = scores.get(dim_id, 0.0) + value

        # 诈骗方施加的压力也会暴露当前场景的心理风险来源。
        if any(word in ai for word in ["公安", "警官", "检察", "法院", "涉案", "洗钱", "冻结", "抓捕", "安全账户"]):
            add("E-02", 2.0)
            add("C-01", 2.4)
        if any(word in ai for word in ["马上", "立即", "现在", "逾期", "否则", "最后机会", "尽快"]):
            add("S-02", 2.0)
        if any(word in ai for word in ["收益", "保本", "返钱", "返利", "中奖", "奖金", "贷款额度", "低息"]):
            add("L-01", 2.2)
        if any(word in ai for word in ["验证码", "密码", "银行卡", "身份证", "ATM", "链接", "APP", "二维码", "共享屏幕"]):
            add("C-03", 2.5)

        # 用户顺从、求助或已经执行操作时，要同时激活多个维度。
        if any(word in user for word in ["好的", "可以", "我配合", "按你说", "你说怎么", "需要做什么", "怎么操作"]):
            add("C-01", 3.0)
            add("C-03", 2.8)
            add("S-02", 2.0)
        if any(word in user for word in ["ATM", "atm", "取款机", "柜员机", "转账", "汇款", "付款", "保证金", "手续费"]):
            add("C-03", 3.5)
            add("S-02", 3.0)
            add("L-02", 1.5)
        if any(word in user for word in ["我到了", "已经到了", "正在操作", "操作完成", "已经操作", "已经转", "转过去", "发给你", "给你了"]):
            add("S-02", 4.0)
            add("C-01", 3.2)
            add("C-03", 3.0)
        if any(word in user for word in ["验证码", "密码", "银行卡", "身份证", "链接", "下载", "APP", "二维码"]):
            add("C-03", 4.0)
            add("C-01", 1.8)
        if any(word in user for word in ["怎么办", "会不会", "害怕", "急", "别抓", "不是我"]):
            add("E-02", 3.5)
            add("S-02", 1.5)
        if any(word in user for word in ["多少钱", "收益", "利息", "赚", "中奖", "奖金", "免费", "返利"]):
            add("L-01", 3.2)
            add("S-02", 1.2)
        if any(word in user for word in ["别告诉", "别让家里知道", "我自己处理", "丢人", "丢脸"]):
            add("L-02", 3.0)
        if any(word in combined for word in ["儿子", "女儿", "孙子", "家人", "妈妈", "爸爸", "手机坏了", "培训费"]):
            add("E-03", 2.5)
        if any(word in combined for word in ["身体", "医院", "医生", "血压", "保健", "药", "治疗", "医保", "社保"]):
            add("L-03", 2.2)
        if any(word in user for word in ["相信你", "你真好", "麻烦你", "谢谢你帮我", "加微信", "联系我"]):
            add("S-01", 2.8)
            add("E-01", 1.5)

        if is_refusing:
            for dim_id in scores:
                scores[dim_id] -= 2.5
            # 拒绝本身也说明用户识别到了风险，不再额外抬高风险分。

        for dim_id in scores:
            scores[dim_id] = round(max(0.0, min(10.0, scores[dim_id])), 2)

        return scores
