"""
基于pyttsx3的离线文本转语音(TTS)模块
"""

import os
import pyttsx3
import threading
import logging

logger = logging.getLogger(__name__)

class TTSSynth:
    """
    离线文本转语音合成器，使用 pyttsx3 库
    """
    def __init__(self, rate: int = 150, volume: float = 1.0, voice_id: str | None = None):
        """
        初始化 TTS 引擎
        
        :param rate: 语速 (默认 150)
        :param volume: 音量 (0.0 到 1.0, 默认 1.0)
        :param voice_id: 语音音色ID，若为None则使用系统默认
        """
        # pyttsx3引擎由于内部COM调用问题，在多线程环境下容易崩溃，
        # 因此我们在每次需要时，可以在内部实例化，或者加锁保证线程安全。
        self.lock = threading.Lock()
        self.rate = rate
        self.volume = volume
        self.voice_id = voice_id

    def _init_engine(self) -> pyttsx3.Engine:
        """
        初始化并配置引擎
        """
        engine = pyttsx3.init()
        engine.setProperty('rate', self.rate)
        engine.setProperty('volume', self.volume)
        
        if self.voice_id:
            try:
                engine.setProperty('voice', self.voice_id)
            except Exception as e:
                logger.warning(f"设置音色失败: {e}，将使用默认音色")
        return engine

    def synthesize(self, text: str, output_file_path: str) -> str:
        """
        将文本合成为语音并保存为文件
        
        :param text: 要合成的文本
        :param output_file_path: 输出音频文件的路径 (需包含后缀，如 .wav)
        :return: 生成的音频文件绝对路径
        """
        if not text.strip():
            logger.warning("输入文本为空，取消合成。")
            return ""

        # 确保输出目录存在
        output_dir = os.path.dirname(os.path.abspath(output_file_path))
        if output_dir and not os.path.exists(output_dir):
            os.makedirs(output_dir, exist_ok=True)

        # 使用锁确保线程安全
        with self.lock:
            try:
                engine = self._init_engine()
                engine.save_to_file(text, output_file_path)
                engine.runAndWait()
            except Exception as e:
                logger.error(f"语音合成失败: {e}")
                raise

        if os.path.exists(output_file_path):
            logger.info(f"语音合成成功，文件保存至: {output_file_path}")
            return os.path.abspath(output_file_path)
        else:
            logger.error("语音合成完成，但未找到输出文件。")
            raise FileNotFoundError("合成的语音文件未成功生成。")
