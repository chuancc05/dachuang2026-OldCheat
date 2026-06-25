from __future__ import annotations

import sys
import os
from pathlib import Path


PROJECT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(PROJECT_DIR))
os.environ["NO_PROXY"] = "127.0.0.1,localhost"
os.environ["no_proxy"] = "127.0.0.1,localhost"
os.environ["GRADIO_ANALYTICS_ENABLED"] = "False"

import huggingface_hub


class HfFolder:
    """Compatibility shim for Gradio versions that still import HfFolder."""

    @staticmethod
    def get_token():
        get_token = getattr(huggingface_hub, "get_token", None)
        return get_token() if get_token else None

    @staticmethod
    def save_token(_token):
        return None

    @staticmethod
    def delete_token():
        return None


huggingface_hub.HfFolder = HfFolder

import gradio_client.utils as client_utils

_original_json_schema_to_python_type = client_utils.json_schema_to_python_type


def _safe_json_schema_to_python_type(schema):
    try:
        return _original_json_schema_to_python_type(schema)
    except TypeError:
        return "Any"


client_utils.json_schema_to_python_type = _safe_json_schema_to_python_type

from app import main


if __name__ == "__main__":
    import gradio.networking as gradio_networking

    # Local demos can run behind strict proxy settings; keep Gradio from
    # aborting after its localhost self-check while still serving 127.0.0.1.
    gradio_networking.url_ok = lambda _url: True
    print("正在初始化数据库和界面，请稍候...")
    main._ensure_db()
    app = main.build_app()
    print("启动成功后请打开：http://127.0.0.1:7860/")
    app.queue().launch(
        server_name="127.0.0.1",
        server_port=7860,
        share=False,
        show_api=False,
        prevent_thread_lock=False,
    )
