"""
基于Whisper的自动语音识别(ASR)模块
"""

import os
import re
import whisper
import logging

logger = logging.getLogger(__name__)

class WhisperASR:
    """
    Whisper语音识别包装类，默认加载'small'模型
    """
    def __init__(self, model_name: str = "small", download_root: str | None = None):
        """
        初始化ASR模型
        
        :param model_name: 模型大小，如 'tiny', 'base', 'small', 'medium', 'large'
        :param download_root: 模型下载存放路径
        """
        self.model_name = model_name
        logger.info(f"正在加载Whisper模型: {self.model_name}...")
        try:
            self.model = whisper.load_model(self.model_name, download_root=download_root)
            logger.info("Whisper模型加载完成。")
        except Exception as e:
            logger.error(f"加载Whisper模型失败: {e}")
            raise

    def transcribe(self, audio_file_path: str) -> str:
        """
        将音频文件转换为文字
        
        :param audio_file_path: 音频文件路径
        :return: 识别出的文字内容
        """
        if not os.path.exists(audio_file_path):
            logger.error(f"音频文件不存在: {audio_file_path}")
            raise FileNotFoundError(f"未找到音频文件: {audio_file_path}")

        try:
            # 执行识别
            result = self.model.transcribe(audio_file_path)
            text = result.get("text", "").strip()
            
            # 基础语义过滤：如果文本长度过短或者是特殊字符，返回空字符串
            if self._is_invalid_text(text):
                logger.warning(f"识别结果被过滤，原文: '{text}'")
                return ""
                
            return text
        except Exception as e:
            logger.error(f"语音识别过程发生异常: {e}")
            return ""

    def _is_invalid_text(self, text: str) -> bool:
        """
        基础语义过滤，判断文本是否为无效识别结果
        
        :param text: 识别的文本
        :return: 是否无效
        """
        # 移除所有空白字符
        compact_text = re.sub(r'\s+', '', text)
        
        # 过滤空字符串或长度为1的非字母/非汉字字符
        if not compact_text:
            return True
            
        if len(compact_text) <= 1:
            # 假设单个无意义标点符号为无效
            if not re.match(r'^[\u4e00-\u9fa5a-zA-Z0-9]$', compact_text):
                return True
                
        # 过滤仅包含标点符号或特殊字符的内容
        if re.match(r'^[^\w\u4e00-\u9fa5]+$', compact_text):
            return True
            
        return False
