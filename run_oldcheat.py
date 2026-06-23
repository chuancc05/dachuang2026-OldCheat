from __future__ import annotations

import sys
from pathlib import Path


PROJECT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(PROJECT_DIR))

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
    main._ensure_db()
    app = main.build_app()
    app.queue().launch(
        server_name="127.0.0.1",
        server_port=7860,
        share=False,
        show_api=False,
        prevent_thread_lock=False,
    )
