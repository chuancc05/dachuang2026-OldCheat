"""
生成PDF个性化反欺诈报告模块
"""

import os
import logging
from typing import Any, Dict, List
from datetime import datetime
from xml.sax.saxutils import escape

from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY
from reportlab.lib import colors
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Image, PageBreak, Table, TableStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

logger = logging.getLogger(__name__)

class PDFReportGenerator:
    """
    基于 reportlab 的 PDF 报告生成器
    """
    def __init__(self, font_path: str | None = None):
        """
        初始化报告生成器并注册中文字体
        
        :param font_path: 中文字体文件路径 (例如 simhei.ttf)。如果为None，将尝试使用系统内置。
        """
        self.font_name = 'CustomChineseFont'
        self.styles = getSampleStyleSheet()
        self._register_font(font_path)
        self._create_styles()

    def _register_font(self, font_path: str | None):
        """
        注册中文字体，确保PDF可以正确显示中文。
        优先使用传入的字体路径，如果未传入则尝试使用 Windows 常见字体。
        """
        if font_path and os.path.exists(font_path):
            try:
                pdfmetrics.registerFont(TTFont(self.font_name, font_path))
                logger.info(f"已注册自定义中文字体: {font_path}")
                return
            except Exception as e:
                logger.warning(f"注册字体失败 {font_path}: {e}")

        # 尝试一些常见的 Windows 中文字体
        common_fonts = [
            "C:\\Windows\\Fonts\\simhei.ttf",  # 黑体
            "C:\\Windows\\Fonts\\msyh.ttc",    # 微软雅黑
            "C:\\Windows\\Fonts\\simsun.ttc"   # 宋体
        ]
        
        for fp in common_fonts:
            if os.path.exists(fp):
                try:
                    pdfmetrics.registerFont(TTFont(self.font_name, fp))
                    logger.info(f"已自动加载系统字体: {fp}")
                    return
                except Exception as e:
                    logger.warning(f"自动加载字体失败 {fp}: {e}")
                    
        logger.warning("未找到可用的中文字体，PDF中的中文可能显示为空白。请提供有效的TTF字体路径。")
        # 如果注册失败，回退到默认英文字体（中文会乱码）
        self.font_name = 'Helvetica'

    def _create_styles(self):
        """
        创建PDF内容中所需的段落样式
        """
        self.title_style = ParagraphStyle(
            name='ReportTitle',
            parent=self.styles['Heading1'],
            fontName=self.font_name,
            fontSize=24,
            leading=30,
            alignment=TA_CENTER,
            spaceAfter=30
        )
        
        self.heading_style = ParagraphStyle(
            name='ReportHeading',
            parent=self.styles['Heading2'],
            fontName=self.font_name,
            fontSize=18,
            leading=24,
            spaceBefore=20,
            spaceAfter=10
        )
        
        self.body_style = ParagraphStyle(
            name='ReportBody',
            parent=self.styles['Normal'],
            fontName=self.font_name,
            fontSize=14,
            leading=22,
            alignment=TA_JUSTIFY,
            spaceBefore=6,
            spaceAfter=6
        )

    def generate_report(self,
                        output_path: str,
                        user_name: str,
                        scene: str,
                        summary: str,
                        radar_chart_path: str,
                        dimension_scores: Dict[str, float],
                        failure_points: List[str],
                        dialogue_history: List[Dict[str, Any]] | None = None,
                        scene_examples: List[str] | None = None) -> str:
        """
        生成PDF防骗评估报告
        
        :param output_path: PDF输出路径
        :param user_name: 测试者姓名/昵称
        :param scene: 模拟的诈骗场景
        :param summary: 综合评估摘要
        :param radar_chart_path: 雷达图图片路径
        :param dimension_scores: 各维度得分字典 (0-10分)
        :param failure_points: 关键失误点列表
        :param dialogue_history: 本次训练的完整对话记录
        :param scene_examples: 当前场景的复核语料样例
        :return: 生成的PDF绝对路径
        """
        if not output_path.endswith('.pdf'):
            output_path += '.pdf'
            
        # 确保输出目录存在
        output_dir = os.path.dirname(os.path.abspath(output_path))
        if output_dir and not os.path.exists(output_dir):
            os.makedirs(output_dir, exist_ok=True)

        doc = SimpleDocTemplate(
            output_path, 
            pagesize=A4,
            rightMargin=50, 
            leftMargin=50, 
            topMargin=50, 
            bottomMargin=50
        )
        
        story: List[Any] = []

        story.append(Paragraph("老年人电信诈骗沉浸式心理免疫训练报告", self.title_style))
        story.append(Spacer(1, 18))

        date_str = datetime.now().strftime("%Y-%m-%d %H:%M")
        meta_info = (
            f"<b>受测者：</b>{self._safe_text(user_name)}<br/>"
            f"<b>训练场景：</b>{self._safe_text(scene)}<br/>"
            f"<b>生成时间：</b>{date_str}"
        )
        story.append(Paragraph(meta_info, self.body_style))
        story.append(Spacer(1, 18))

        story.append(Paragraph("1. 综合评估摘要", self.heading_style))
        story.append(Paragraph(self._safe_text(summary or "本次训练已完成，系统根据对话过程生成以下评估结果。"), self.body_style))

        story.append(Paragraph("2. 心理风险评分", self.heading_style))
        story.append(Paragraph("下表展示本次对话中被触发的心理风险维度。分数越高，代表该维度越需要重点关注；下方图表会按强弱排序显示最主要的触发因素。", self.body_style))
        story.append(self._build_score_table(dimension_scores))
        story.append(Spacer(1, 12))

        if os.path.exists(radar_chart_path):
            img = Image(radar_chart_path, width=450, height=280)
            story.append(img)
        else:
            story.append(Paragraph("<i>[未找到触发因素图表文件]</i>", self.body_style))
            logger.warning(f"雷达图未找到: {radar_chart_path}")

        story.append(PageBreak())

        story.append(Paragraph("3. 关键失误点", self.heading_style))
        if failure_points:
            for idx, point in enumerate(failure_points, 1):
                story.append(Paragraph(f"{idx}. {self._safe_text(point)}", self.body_style))
        else:
            story.append(Paragraph("本次训练中未检测到明显关键失误。仍建议保持核实身份、拒绝验证码、拒绝转账的习惯。", self.body_style))

        story.append(Paragraph("4. 对话过程记录", self.heading_style))
        if dialogue_history:
            for idx, turn in enumerate(dialogue_history, 1):
                role = self._role_label(str(turn.get("role", "")))
                content = self._safe_text(str(turn.get("content", "")).strip())
                if not content or role == "系统提示":
                    continue
                story.append(Paragraph(f"<b>{idx}. {role}</b>", self.body_style))
                story.append(Paragraph(content, self.body_style))
                story.append(Spacer(1, 4))
        else:
            story.append(Paragraph("未读取到本次训练的对话记录。", self.body_style))

        story.append(PageBreak())

        story.append(Paragraph("5. 本场景常见风险话术样例", self.heading_style))
        if scene_examples:
            story.append(Paragraph("以下样例来自已复核诈骗语料，仅用于帮助训练者理解常见话术特征。", self.body_style))
            for idx, example in enumerate(scene_examples, 1):
                story.append(Paragraph(f"{idx}. {self._safe_text(example)}", self.body_style))
                story.append(Spacer(1, 4))
        else:
            story.append(Paragraph("当前场景暂未接入复核语料样例。", self.body_style))

        story.append(Paragraph("6. 个性化防骗建议", self.heading_style))
        active_risks = [(dim, score) for dim, score in dimension_scores.items() if score > 0]
        top_risks = sorted(active_risks, key=lambda x: x[1], reverse=True)[:3]
        if not top_risks:
            story.append(Paragraph("本次对话未触发明显高风险维度，但遇到陌生来电、投资推荐、中奖通知、亲友急事等情况时，仍应先暂停、再核实。", self.body_style))
        for dim, score in top_risks:
            story.append(Paragraph(f"<b>【{self._dimension_name(dim)}】风险得分：{score:.1f}/10，等级：{self._risk_level(score)}</b>", self.body_style))
            story.append(Paragraph(self._advice_for_dimension(dim), self.body_style))
            story.append(Spacer(1, 10))

        try:
            doc.build(story)
            logger.info(f"PDF报告生成成功: {output_path}")
            return os.path.abspath(output_path)
        except Exception as e:
            logger.error(f"生成PDF过程出错: {e}")
            raise

    def _safe_text(self, text: str) -> str:
        return escape(str(text)).replace("\n", "<br/>")

    def _role_label(self, role: str) -> str:
        labels = {
            "user": "用户",
            "ai": "模拟来电方",
            "assistant": "模拟来电方",
            "system": "系统提示",
        }
        return labels.get(role, role or "未知角色")

    def _dimension_name(self, dimension: str) -> str:
        names = {
            "E-01": "情感陪伴需求",
            "E-02": "恐惧与权威压力",
            "E-03": "亲情牵挂",
            "L-01": "利益诱惑",
            "L-02": "损失厌恶",
            "L-03": "健康焦虑",
            "C-01": "权威服从",
            "C-02": "从众心理",
            "C-03": "信息安全意识",
            "S-01": "信任建立",
            "S-02": "紧迫感压力",
            "S-03": "情感依赖",
        }
        return f"{dimension} {names.get(dimension, dimension)}"

    def _risk_level(self, score: float) -> str:
        if score >= 6:
            return "高"
        if score >= 3:
            return "中"
        return "低"

    def _build_score_table(self, dimension_scores: Dict[str, float]) -> Table:
        rows = [["维度", "得分", "风险等级"]]
        sorted_scores = sorted(dimension_scores.items(), key=lambda item: item[1], reverse=True)
        for dim, score in sorted_scores:
            rows.append([self._dimension_name(dim), f"{score:.1f}/10", self._risk_level(score)])
        if len(rows) == 1:
            rows.append(["暂无评分", "0.0/10", "低"])

        table = Table(rows, colWidths=[260, 85, 85])
        table.setStyle(TableStyle([
            ("FONTNAME", (0, 0), (-1, -1), self.font_name),
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#E8EEF8")),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.HexColor("#1F3358")),
            ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#C9D2E3")),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("ALIGN", (1, 1), (-1, -1), "CENTER"),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
            ("TOPPADDING", (0, 0), (-1, -1), 8),
        ]))
        return table

    def _advice_for_dimension(self, dimension: str) -> str:
        advices = {
            "E-01": "陌生人突然热情陪伴时，先提醒自己对方可能有目的。只要涉及金钱、账户、验证码，就立即停止对话并找家人一起判断。",
            "E-02": "听到“涉案、冻结、抓捕”等威胁时，第一步是挂断电话，再自行拨打 110 或官方电话核实。",
            "E-03": "凡是自称子女或亲友遇急事要钱，先用原来的联系方式联系本人或其他家人确认，未核实前不要转账。",
            "L-01": "遇到任何承诺高收益的项目，先问自己：如果这是真的，为什么要找我这个陌生人？不要下载陌生投资软件，不向个人账户转账。",
            "L-02": "怀疑被骗并不丢人，越早告诉家人、银行或警方，越容易止损。不要因为面子独自处理。",
            "L-03": "健康问题只相信正规医院和医生。电话里的专家、免费讲座后的高价产品、包治百病的承诺都要拒绝。",
            "C-01": "凡是自称公检法、银行或客服的人要求转账、共享屏幕、提供验证码，一律先挂断，再自行拨打官方电话核实。",
            "C-02": "群里很多人说赚钱不代表可信，他们可能是托。做决定前先离开群聊，找家人或正规机构核实。",
            "C-03": "验证码、密码、银行卡号和身份证照片不能给任何人。真正的工作人员不会索要这些信息。",
            "S-01": "短时间内特别关心您的陌生人，需要先保持距离。对方一旦谈钱、投资、账户，就立刻停止。",
            "S-02": "越催越不能办。涉及钱的事至少暂停十分钟，并找一个可信的人共同判断。",
            "S-03": "把陪伴和金钱分开。网络聊天对象提出转账、投资、借钱时，应立即停止联系。",
        }
        return advices.get(dimension, "保持警惕，不轻信陌生人，不随意转账汇款。遇到可疑情况请及时拨打 96110 或 110 咨询。")

    def _get_advice_for_dimension(self, dimension: str) -> str:
        """
        根据维度返回对应的预设防骗建议
        
        :param dimension: 维度名称
        :return: 建议文本
        """
        advices = {
            "E-01": "陌生人突然热情陪伴时，先提醒自己对方可能有目的。涉及金钱、账户、验证码时，立即停止对话并找家人一起判断。",
            "E-02": "听到“涉案、冻结、抓捕”等威胁时，第一步是挂断电话，再自行拨打 110 或官方电话核实，不按对方提供的号码回拨。",
            "E-03": "凡是自称子女或亲友遇急事要钱，先用原来的联系方式联系本人或其他家人确认，未核实前一分钱也不转。",
            "L-01": "遇到任何承诺高收益的项目，先问自己：如果这是真的，为什么要找我这个陌生人？不要下载陌生投资软件，不向个人账户转账。",
            "L-02": "怀疑被骗并不丢人，越早告诉家人、银行或警方，越容易止损。不要因为面子独自处理。",
            "L-03": "健康问题只相信正规医院和医生。电话里的专家、免费讲座后的高价产品、包治百病的承诺都要拒绝。",
            "C-01": "凡是自称公检法或银行的人要求转账、共享屏幕、提供验证码，第一步必须挂断，再自行拨打官方电话核实。",
            "C-02": "群里很多人说赚钱不代表可信，他们可能是托。做决定前先离开群聊，找家人或正规机构核实。",
            "C-03": "验证码、密码、银行卡号和身份证照片不能给任何人。真正的工作人员不会索要这些信息。",
            "S-01": "短时间内特别关心您的陌生人，需要先保持距离。对方一旦谈钱、投资、账户，就立刻停止。",
            "S-02": "越催越不能办。涉及钱的事至少暂停十分钟，并找一个可信的人共同判断。",
            "S-03": "把陪伴和金钱分开。网络聊天对象提出转账、投资、借钱时，应立即停止联系。",
            "贪婪": "切记“天上不会掉馅饼”。面对高额回报、中大奖等诱惑，务必保持冷静，不要被眼前的利益冲昏头脑。任何声称能轻松赚钱的项目都有可能是骗局。",
            "恐惧": "诈骗分子常利用“公检法”办案、亲人遇险等借口制造恐慌。遇到此类情况，请立即挂断电话并拨打官方客服或110核实，不要在恐慌中盲目转账。",
            "轻信": "对于陌生人或者通过网络结识的“朋友”、“导师”，不可轻易相信对方的话术。对任何要求转账、借钱的请求，都必须通过其他途径反复确认其身份。",
            "盲从": "不要盲目跟随所谓的“内幕消息”或“群众效应”。诈骗群内往往有很多“托儿”在烘托气氛。请坚持独立判断，不随波逐流。",
            "孤独": "诈骗分子会通过“杀猪盘”等方式建立虚假的情感连接。请对网络交友保持高度警惕，不要轻信网络另一端的甜言蜜语，切勿将感情与金钱挂钩。",
            "同情": "善良值得赞美，但同情心容易被骗子利用。在捐款或帮助自称遇到紧急困难的人时，请一定要通过正规渠道或官方机构进行，不要直接向个人账户转账。",
            "好奇": "不要随意点击来历不明的链接、下载陌生的APP或扫描不明二维码。好奇心可能会导致您的个人隐私泄露或手机中木马病毒。",
            "侥幸": "面对各类投资理财、博彩等，不要抱有“只试一次赚了就走”的心理。骗子正是利用了这种侥幸心理，通过初期小额返利诱使您投入全部身家。",
            "自负": "不要认为自己绝不会被骗。诈骗手法层出不穷，很多高学历人群也曾中招。保持谦逊和谨慎，遇到涉及金钱的情况多向他人咨询。",
            "顺从": "在面对自称权威人士（如上级领导、执法人员）的无理要求时，要敢于质疑。真正的公职人员不会通过电话要求您进行任何资金转移。",
            "面子": "骗子可能利用您的面子或羞耻心（如威胁曝光隐私）进行敲诈。遇到敲诈勒索，第一时间报警，绝不能因顾及颜面而妥协给钱。",
            "从众": "群组里大家都在赚钱不代表那是真的，可能只有你一个是受害者，其他都是演员。投资前请自行调研，不轻信所谓的“大V带单”。"
        }
        
        # 返回匹配的建议，如果没有则返回通用建议
        return advices.get(dimension, "保持警惕，不轻信陌生人，不随意转账汇款。遇到可疑情况请及时拨打全国反诈劝阻专线 96110 咨询。")
