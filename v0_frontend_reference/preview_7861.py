from __future__ import annotations

import os
import sys
from pathlib import Path

PROJECT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_DIR))

os.environ["NO_PROXY"] = "127.0.0.1,localhost"
os.environ["no_proxy"] = "127.0.0.1,localhost"
os.environ["GRADIO_ANALYTICS_ENABLED"] = "False"

import run_oldcheat  # applies Gradio / huggingface compatibility shims
import gradio.networking as gradio_networking
from app import main

if __name__ == "__main__":
    gradio_networking.url_ok = lambda _url: True
    main._ensure_db()
    app = main.build_app()
    app.queue().launch(
        server_name="127.0.0.1",
        server_port=7861,
        share=False,
        show_api=False,
        prevent_thread_lock=False,
    )
