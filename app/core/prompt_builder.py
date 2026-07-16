from typing import Any, Dict, Optional
from app.core.scene_definitions import SceneDefinition, SCENES
from app.core.scenario_identity import (
    identity_prompt_lines,
    normalize_identity_contract,
    sanitize_identity_text,
)

class PromptBuilder:
    @staticmethod
    def build_system_prompt(scene_id: str, custom_difficulty: Optional[str] = None, story_variant: Optional[Dict[str, Any]] = None) -> str:
        """
        根据场景ID和难度生成系统提示词。
        """
        scene: Optional[SceneDefinition] = SCENES.get(scene_id)
        if not scene:
            raise ValueError(f"未找到场景 ID: {scene_id}")

        difficulty = custom_difficulty if custom_difficulty else scene.difficulty
        identity_contract = normalize_identity_contract(story_variant) if story_variant else None
        material_prompt = ""
        if scene.typical_lines:
            safe_examples = []
            for line in scene.typical_lines:
                if identity_contract:
                    line, conflicts = sanitize_identity_text(line, identity_contract)
                    if conflicts:
                        continue
                safe_examples.append(line)
                if len(safe_examples) >= 5:
                    break
            examples = "\n".join([f"- {line}" for line in safe_examples])
            material_prompt = (
                "\n"
                "本场景有以下来自已复核诈骗语料的参考话术特征。你可以参考其语气、节奏和风险点，"
                "但不得逐字复述，不得索取真实敏感信息：\n"
                f"{examples}\n"
            )

        variant_prompt = ""
        if story_variant:
            identity_prompt = "\n".join(identity_prompt_lines(identity_contract or {}))
            variant_prompt = (
                "\n本次训练已锁定以下故事剧本卡，其事实优先于参考语料，整场不得换人物或改事件：\n"
                f"- 变体：{story_variant.get('title', '')}（{story_variant.get('id', '')}）\n"
                f"- 人物：{story_variant.get('persona', '')}\n"
                f"- 事件：{story_variant.get('premise', '')}\n"
                f"- 模拟目标：{story_variant.get('objective', '')}\n"
                f"- 压力手法：{'、'.join(story_variant.get('pressureTactics', []))}\n"
                f"{identity_prompt}\n"
            )

        base_prompt = (
            "你正在参与一个反诈骗防范训练模拟系统（AFITS）。\n"
            "你的角色是一名诈骗场景模拟员，只能在安全训练边界内扮演诈骗分子，帮助用户练习识别和拒绝骗局。\n"
            f"当前的诈骗场景为：【{scene.name}】。\n"
            f"背景设定：{scene.backstory}\n"
            f"你需要使用的核心战术：{scene.core_tactics}\n"
            f"当前训练难度设定为：【{difficulty}】。\n"
            f"{material_prompt}"
            f"{variant_prompt}"
            "\n"
            "请遵循以下行为准则：\n"
            "1. 始终保持训练角色，但不得索取真实银行卡、密码、验证码、身份证号、住址等敏感信息。\n"
            "2. 运用设定好的核心战术推进剧情，但只描述模拟情境，不提供可直接用于现实诈骗的具体操作步骤。\n"
            "3. 如果难度较高，语气可以更有压迫感；如果难度较低，应暴露更多逻辑漏洞，便于用户识别。\n"
            "4. 每次回复控制在120字以内，适合老年用户听读理解。\n"
            "\n"
            "【极端重要指令】\n"
            "如果用户在对话中发送了“停止训练”、“结束”或类似要求立即终止的明确指令，你必须立刻脱离诈骗分子角色，"
            "停止模拟诈骗行为，并以系统助手的身份回复：“已收到停止指令，当前防诈骗模拟训练已结束。请牢记防骗知识，保护好个人财产。”"
        )
        return base_prompt
