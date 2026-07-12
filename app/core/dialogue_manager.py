import time
from typing import Any, Iterator, List, Dict, Optional
from app.config import DEFAULT_MODEL, MAX_CONTEXT_MESSAGES, OLLAMA_URL
from app.core.prompt_builder import PromptBuilder
from app.core.ollama_client import OllamaClient

class DialogueManager:
    """
    对话管理器，负责管理单次训练会话的状态、消息历史和安全控制。
    """
    def __init__(
        self,
        scene_id: str,
        difficulty: Optional[str] = None,
        model: str = DEFAULT_MODEL,
        max_context_messages: int = MAX_CONTEXT_MESSAGES,
        story_variant: Optional[Dict[str, Any]] = None,
    ):
        self.scene_id = scene_id
        self.difficulty = difficulty
        self.messages: List[Dict[str, str]] = []
        self.client = OllamaClient(base_url=OLLAMA_URL, model=model)
        self.max_context_messages = max(2, max_context_messages)
        self.story_variant = story_variant
        
        # 记录会话开始时间和最后一次安全提示时间
        self.start_time = time.time()
        self.last_warning_time = self.start_time
        # 每 3 分钟 (180 秒) 提示一次
        self.warning_interval = 180

        self._initialize_system_prompt()

    def _initialize_system_prompt(self) -> None:
        """初始化系统提示词并加入消息记录"""
        prompt = PromptBuilder.build_system_prompt(self.scene_id, self.difficulty, self.story_variant)
        self.messages.append({"role": "system", "content": prompt})

    def is_emergency_stop(self, user_input: str) -> bool:
        """检查用户输入是否触发紧急停止"""
        stop_keywords = ["停止训练", "我不想继续", "结束", "退出", "终止", "别说了", "不练了"]
        return any(keyword in user_input for keyword in stop_keywords)

    def _should_inject_warning(self) -> bool:
        """检查是否需要注入安全警告"""
        current_time = time.time()
        if current_time - self.last_warning_time >= self.warning_interval:
            self.last_warning_time = current_time
            return True
        return False

    def _messages_for_model(self) -> List[Dict[str, str]]:
        """保留完整历史用于报告，只给模型发送最近上下文以降低延迟。"""
        system_messages = [msg for msg in self.messages if msg.get("role") == "system"]
        conversation = [msg for msg in self.messages if msg.get("role") != "system"]
        return system_messages + conversation[-self.max_context_messages:]

    def chat(self, user_input: str) -> Iterator[str]:
        """
        处理用户输入，生成 AI 响应（流式）。
        支持紧急制动和定时安全提醒。
        """
        # 1. 检查紧急停止指令
        if self.is_emergency_stop(user_input):
            stop_msg = "已收到停止指令，当前防诈骗模拟训练已结束。请牢记防骗知识，保护好个人财产。"
            self.messages.append({"role": "user", "content": user_input})
            self.messages.append({"role": "assistant", "content": stop_msg})
            yield stop_msg
            return

        # 2. 将用户输入加入历史记录
        self.messages.append({"role": "user", "content": user_input})

        # 3. 检查是否需要注入系统安全警告
        if self.difficulty in {"高", "高难度"} and self._should_inject_warning():
            warning_msg = "\n【系统安全提示】：请注意，您正在进行防诈骗模拟训练，当前对话为 AI 模拟。请勿在任何真实场景中透露个人敏感信息或进行转账。\n"
            yield warning_msg

        # 4. 获取并流式输出 AI 响应
        full_response = ""
        for chunk in self.client.chat_stream(self._messages_for_model()):
            full_response += chunk
            yield chunk

        # 5. 将完整的 AI 响应加入历史记录
        self.messages.append({"role": "assistant", "content": full_response})

    def close(self) -> None:
        self.client.close()
