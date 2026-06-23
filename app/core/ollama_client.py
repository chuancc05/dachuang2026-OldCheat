import json
import httpx
from typing import Iterator, List, Dict, Any

from app.config import OLLAMA_TIMEOUT

class OllamaClient:
    """
    Ollama 接口客户端，处理与本地 Ollama 服务的流式通信。
    """
    def __init__(self, base_url: str = "http://localhost:11434", model: str = "llama3", timeout: float = OLLAMA_TIMEOUT):
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.chat_url = f"{self.base_url}/api/chat"
        self._client = httpx.Client(timeout=timeout)

    def close(self) -> None:
        self._client.close()

    def __enter__(self) -> "OllamaClient":
        return self

    def __exit__(self, *_args: object) -> None:
        self.close()

    def chat_stream(self, messages: List[Dict[str, str]]) -> Iterator[str]:
        """
        发送聊天请求并以流式返回响应内容。
        """
        payload = {
            "model": self.model,
            "messages": messages,
            "stream": True
        }

        try:
            with self._client.stream("POST", self.chat_url, json=payload) as response:
                response.raise_for_status()
                for line in response.iter_lines():
                    if not line:
                        continue
                    data: Dict[str, Any] = json.loads(line)
                    if "message" in data and "content" in data["message"]:
                        yield data["message"]["content"]
        except httpx.RequestError as exc:
            yield f"\n[连接错误: 无法访问 Ollama 服务 ({exc})]\n"
        except json.JSONDecodeError as exc:
            yield f"\n[发生错误: Ollama 返回了无法解析的数据 ({exc})]\n"
        except Exception as exc:
            yield f"\n[发生错误: {exc}]\n"
