from pathlib import Path
import os

# 获取项目根目录 (app 目录的上一级)
BASE_DIR = Path(__file__).resolve().parent.parent

# 数据和字体目录
DATA_DIR = BASE_DIR / "data"
FONT_DIR = DATA_DIR / "fonts"

# 确保目录存在
DATA_DIR.mkdir(parents=True, exist_ok=True)
FONT_DIR.mkdir(parents=True, exist_ok=True)

# 默认配置
OLLAMA_URL = os.getenv("OLLAMA_URL", "http://localhost:11434")
DEFAULT_MODEL = os.getenv("DEFAULT_MODEL", "qwen2:7b")
OLLAMA_TIMEOUT = float(os.getenv("OLLAMA_TIMEOUT", "120"))
MAX_CONTEXT_MESSAGES = int(os.getenv("MAX_CONTEXT_MESSAGES", "12"))
WHISPER_MODEL = os.getenv("WHISPER_MODEL", "base")

# 数据库配置
DB_PATH = DATA_DIR / "data.db"
DATABASE_URI = f"sqlite:///{DB_PATH}"

