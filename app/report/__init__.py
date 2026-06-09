"""
报告模块初始化文件
包含雷达图生成和PDF报告生成功能
"""

from .radar_chart import generate_radar_chart
from .pdf_generator import PDFReportGenerator

__all__ = ["generate_radar_chart", "PDFReportGenerator"]
