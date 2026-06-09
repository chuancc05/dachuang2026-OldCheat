"""
语音模块初始化文件
包含自动语音识别(ASR)和文字转语音(TTS)功能
"""

from .whisper_asr import WhisperASR
from .tts_synth import TTSSynth

__all__ = ["WhisperASR", "TTSSynth"]
