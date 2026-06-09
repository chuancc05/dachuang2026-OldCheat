from __future__ import annotations

import os
import time
from pathlib import Path
from typing import Any, Dict, Generator, List, Tuple

import gradio as gr

from app.config import DATA_DIR
from app.core import DialogueManager, SCENES
from app.database import db
from app.psychology import DIMENSIONS, FraudDetector, PsychologyAnalyzer, ScoreTracker
from app.report.pdf_generator import PDFReportGenerator
from app.report.radar_chart import generate_radar_chart


REPORT_DIR = DATA_DIR / "reports"
REPORT_DIR.mkdir(parents=True, exist_ok=True)


def _load_css() -> str:
    css_path = Path(__file__).resolve().parent / "ui" / "styles.css"
    return css_path.read_text(encoding="utf-8") if css_path.exists() else ""


def _scene_choices() -> List[str]:
    return [
        f"{scene_id} | {scene.name} | {scene.difficulty}"
        for scene_id, scene in SCENES.items()
    ]


def _scene_id_from_label(label: str) -> str:
    return label.split("|", 1)[0].strip()


def _dimension_label(dim_id: str) -> str:
    dim = DIMENSIONS.get(dim_id)
    return f"{dim_id} {dim.name}" if dim else dim_id


def _risk_level(score: float) -> Tuple[str, str]:
    if score >= 6:
        return "高", "risk-high"
    if score >= 3:
        return "中", "risk-med"
    return "低", "risk-low"


def _risk_markdown(score: float) -> str:
    level, cls = _risk_level(score)
    return f"<div class='{cls}'>当前综合风险：{level}（{score:.1f}/10）</div>"


def _top_dimensions_markdown(state: Dict[str, Any]) -> str:
    tracker: ScoreTracker | None = state.get("tracker")
    if not tracker:
        return "尚未开始评分。"
    top = tracker.get_top_activated_dimensions(3)
    active = [item for item in top if item[1] > 0]
    if not active:
        return "当前未检测到明显心理弱点激活。"
    return "\n".join([f"- {_dimension_label(dim_id)}：{score:.1f}/10" for dim_id, score in active])


def _advice_markdown(state: Dict[str, Any]) -> str:
    tracker: ScoreTracker | None = state.get("tracker")
    if not tracker:
        return "选择场景并开始训练后，这里会显示即时建议。"
    top = tracker.get_top_activated_dimensions(1)
    if not top or top[0][1] <= 0:
        return "保持核实身份、拒绝验证码、拒绝转账的习惯。"
    dim_id, _score = top[0]
    advice = {
        "E-01": "对方越热情，越要慢下来。陌生人突然关心您时，先确认身份，不要急着透露个人情况。",
        "E-02": "对方制造恐慌时，先挂断，再拨打官方电话或 110 核实。",
        "E-03": "凡是涉及子女急事，先用原来的号码或当面联系家人确认。",
        "L-01": "高收益、低风险同时出现时，先问一句：真有好事，为什么找陌生人？",
        "L-02": "怀疑被骗时越早告诉家人或报警，损失越容易止住。",
        "L-03": "健康问题只找正规医院和医生，不相信电话里的专家和神药。",
        "C-01": "自称公检法、银行的人要求转账，一律先挂断，再自行拨打官方电话核实。",
        "C-02": "别人都买不代表是真的，群聊里可能全是托。",
        "C-03": "验证码、密码、银行卡号不能告诉任何人，工作人员也不会索要。",
        "S-01": "陌生人短时间内获得信任时，要暂停对话并找家人一起判断。",
        "S-02": "越催越不能办。涉及钱的事至少等十分钟，并找可信的人确认。",
        "S-03": "把陪伴和金钱分开，聊天对象提出转账或投资就立刻停止。",
    }
    return advice.get(dim_id, "遇到可疑情况，先停止对话，再找家人或官方渠道核实。")


def _fallback_ai_reply(scene_id: str, user_text: str) -> str:
    scene = SCENES[scene_id]
    if any(word in user_text for word in ["骗子", "报警", "不信", "挂了", "核实"]):
        return "您的警惕性很强。训练到这里可以停一下：遇到可疑要求，先挂断并通过官方渠道核实。"
    if scene_id == "SC-01":
        return "我是办案人员，现在情况比较紧急。为了核实账户安全，请您先不要告诉家里人，按我说的步骤配合登记。"
    if scene_id == "SC-06":
        return "妈，我这边真的很急，原来的手机坏了。这个事情先别打别的电话，能不能先帮我处理一下费用？"
    return f"您先别着急，我这里是{scene.name}相关的专员。这个机会有时间限制，请您先按我说的确认一下。"


def _new_empty_state() -> Dict[str, Any]:
    return {
        "manager": None,
        "analyzer": PsychologyAnalyzer(),
        "tracker": ScoreTracker(),
        "detector": FraudDetector(),
        "session_id": None,
        "scene_id": None,
        "difficulty": None,
        "round": 0,
        "last_ai_text": "",
        "ended": False,
    }


def start_training(scene_label: str, difficulty: str) -> Tuple[Dict[str, Any], List[List[str | None]], str, str, str, str, None]:
    db.init_db()
    scene_id = _scene_id_from_label(scene_label)
    scene = SCENES[scene_id]
    user = db.get_or_create_user("本地用户")
    training_session = db.create_session(
        user_id=user.id,
        topic=scene.name,
        scene_type=scene_id,
        difficulty=difficulty,
    )
    state = _new_empty_state()
    state.update(
        {
            "manager": DialogueManager(scene_id=scene_id, difficulty=difficulty),
            "session_id": training_session.id,
            "scene_id": scene_id,
            "difficulty": difficulty,
        }
    )
    opening = (
        f"已进入“{scene.name}”训练。请在下方输入或使用语音识别提交回复。"
        "训练中您可以随时说“停止训练”结束。"
    )
    chat = [[None, opening]]
    return state, chat, _risk_markdown(0), "尚未开始评分。", _advice_markdown(state), "训练已开始。", None


def send_message(
    user_text: str,
    chat_history: List[List[str | None]],
    state: Dict[str, Any],
) -> Generator[Tuple[List[List[str | None]], str, str, str, str, None, str, Dict[str, Any]], None, None]:
    if not user_text or not user_text.strip():
        yield chat_history, "", _risk_markdown(0), _top_dimensions_markdown(state), _advice_markdown(state), None, "请输入内容后再发送。", state
        return

    if not state or not state.get("manager"):
        default_scene = _scene_choices()[0]
        state, chat_history, *_rest = start_training(default_scene, "中")

    if state.get("ended"):
        yield chat_history, "", _risk_markdown(state["tracker"].get_composite_score()), _top_dimensions_markdown(state), _advice_markdown(state), None, "本次训练已结束，请点击开始训练创建新会话。", state
        return

    manager: DialogueManager = state["manager"]
    state["round"] += 1
    round_number = state["round"]
    clean_text = user_text.strip()

    chat_history = chat_history + [[clean_text, ""]]
    yield chat_history, "", _risk_markdown(state["tracker"].get_composite_score()), _top_dimensions_markdown(state), _advice_markdown(state), None, "AI 正在回复。", state

    full_response = ""
    for chunk in manager.chat(clean_text):
        full_response += chunk
        chat_history[-1][1] = full_response
        yield chat_history, "", _risk_markdown(state["tracker"].get_composite_score()), _top_dimensions_markdown(state), _advice_markdown(state), None, "AI 正在回复。", state

    if "[连接错误" in full_response or "[发生错误" in full_response:
        full_response = _fallback_ai_reply(state["scene_id"], clean_text)
        manager.messages[-1]["content"] = full_response
        chat_history[-1][1] = full_response

    db.add_dialogue_turn(state["session_id"], "user", clean_text, round_number)
    db.add_dialogue_turn(state["session_id"], "ai", full_response, round_number)

    raw_scores = state["analyzer"].analyze_turn(clean_text, state.get("last_ai_text", ""))
    state["tracker"].add_scores(raw_scores)
    smooth_scores = state["tracker"].get_current_smooth_scores()
    composite = state["tracker"].get_composite_score()
    activated = [
        {"id": dim_id, "name": DIMENSIONS[dim_id].name, "score": score}
        for dim_id, score in state["tracker"].get_top_activated_dimensions(3)
        if score > 0
    ]
    db.save_psychological_score(state["session_id"], round_number, smooth_scores, composite, activated)
    state["last_ai_text"] = full_response

    if manager.is_emergency_stop(clean_text):
        state["ended"] = True
        status = "用户触发停止词，训练已结束。可以生成报告。"
    else:
        status = "本轮评分已更新。"

    yield chat_history, "", _risk_markdown(composite), _top_dimensions_markdown(state), _advice_markdown(state), None, status, state


def finish_training(
    chat_history: List[List[str | None]],
    state: Dict[str, Any],
) -> Tuple[List[List[str | None]], str, str, str, str | None, str, Dict[str, Any]]:
    if not state or not state.get("manager") or not state.get("session_id"):
        return chat_history, _risk_markdown(0), "尚未开始评分。", "请先开始训练。", None, "没有可结束的训练。", state

    manager: DialogueManager = state["manager"]
    history = [
        msg for msg in manager.messages
        if msg.get("role") in {"user", "assistant"}
    ]
    identified, analysis = state["detector"].evaluate_session(history)
    state["ended"] = True

    scores = state["tracker"].get_current_smooth_scores()
    named_scores = {_dimension_label(dim_id): value for dim_id, value in scores.items()}
    radar_path = REPORT_DIR / f"session_{state['session_id']}_radar.png"
    pdf_path = REPORT_DIR / f"session_{state['session_id']}_report.pdf"

    generate_radar_chart(named_scores, str(radar_path))
    scene_name = SCENES[state["scene_id"]].name
    summary = f"{analysis} 本次训练共进行 {state['round']} 轮对话，综合风险评分为 {state['tracker'].get_composite_score():.1f}/10。"
    report_path = PDFReportGenerator().generate_report(
        output_path=str(pdf_path),
        user_name="本地用户",
        scene=scene_name,
        summary=summary,
        radar_chart_path=str(radar_path),
        dimension_scores=scores,
        failure_points=_extract_failure_points(history),
    )
    db.end_session(state["session_id"], identified_fraud=identified, pdf_report_path=report_path)

    result_text = "识别成功" if identified else "仍需练习"
    chat_history = chat_history + [[None, f"训练结束：{result_text}。{analysis} 报告已生成。"]]
    return chat_history, _risk_markdown(state["tracker"].get_composite_score()), _top_dimensions_markdown(state), _advice_markdown(state), report_path, "报告已生成。", state


def _extract_failure_points(history: List[Dict[str, str]]) -> List[str]:
    risky_words = ["验证码", "密码", "马上转", "这就办", "多少钱", "好的警官", "帮我弄"]
    points: List[str] = []
    turn = 0
    for msg in history:
        if msg.get("role") == "user":
            turn += 1
            content = msg.get("content", "")
            if any(word in content for word in risky_words):
                points.append(f"第 {turn} 轮回复“{content}”中出现了顺从或敏感信息倾向，建议先停止对话并核实对方身份。")
    return points[:5]


def transcribe_audio(audio_path: str | None) -> Tuple[str, str]:
    if not audio_path:
        return "", "请先录音或上传音频。"
    try:
        from app.voice.whisper_asr import WhisperASR

        text = WhisperASR(model_name="small").transcribe(audio_path)
        return text, "语音识别完成，可以修改后发送。"
    except Exception as exc:
        return "", f"语音识别暂不可用：{exc}"


def build_app() -> gr.Blocks:
    with gr.Blocks(css=_load_css(), title="老年人电信诈骗沉浸式心理免疫训练系统") as demo:
        gr.Markdown("# 老年人电信诈骗沉浸式心理免疫训练系统")
        app_state = gr.State(_new_empty_state())

        with gr.Row():
            with gr.Column(scale=1, min_width=260):
                scene_dropdown = gr.Dropdown(
                    choices=_scene_choices(),
                    value=_scene_choices()[0],
                    label="训练场景",
                )
                difficulty = gr.Radio(["低", "中", "高"], value="中", label="训练强度")
                start_btn = gr.Button("开始训练", variant="primary")
                finish_btn = gr.Button("结束训练并生成报告")
                status = gr.Markdown("请选择场景后开始训练。")

            with gr.Column(scale=2, min_width=460):
                chatbot = gr.Chatbot(label="对话训练", height=560)
                text_input = gr.Textbox(label="文字输入", placeholder="在这里输入您的回复", lines=2)
                with gr.Row():
                    send_btn = gr.Button("发送", variant="primary")
                    clear_btn = gr.Button("清空输入")
                audio_input = gr.Audio(sources=["microphone", "upload"], type="filepath", label="语音输入")
                transcribe_btn = gr.Button("识别语音到输入框")

            with gr.Column(scale=1, min_width=280):
                risk_level = gr.HTML(_risk_markdown(0), label="风险等级")
                top_dimensions = gr.Markdown("尚未开始评分。", label="主要心理弱点")
                advice = gr.Markdown("选择场景并开始训练后，这里会显示即时建议。", label="即时建议")
                report_file = gr.File(label="PDF 报告")

        start_btn.click(
            start_training,
            inputs=[scene_dropdown, difficulty],
            outputs=[app_state, chatbot, risk_level, top_dimensions, advice, status, report_file],
        )
        send_btn.click(
            send_message,
            inputs=[text_input, chatbot, app_state],
            outputs=[chatbot, text_input, risk_level, top_dimensions, advice, report_file, status, app_state],
        )
        text_input.submit(
            send_message,
            inputs=[text_input, chatbot, app_state],
            outputs=[chatbot, text_input, risk_level, top_dimensions, advice, report_file, status, app_state],
        )
        finish_btn.click(
            finish_training,
            inputs=[chatbot, app_state],
            outputs=[chatbot, risk_level, top_dimensions, advice, report_file, status, app_state],
        )
        transcribe_btn.click(transcribe_audio, inputs=[audio_input], outputs=[text_input, status])
        clear_btn.click(lambda: "", outputs=[text_input])

    return demo


if __name__ == "__main__":
    log_path = DATA_DIR / "server_boot.log"
    try:
        log_path.write_text("starting\n", encoding="utf-8")
        db.init_db()
        build_app().queue().launch(
            server_name="127.0.0.1",
            server_port=7860,
            share=False,
            show_api=False,
            prevent_thread_lock=True,
        )
        with log_path.open("a", encoding="utf-8") as log_file:
            log_file.write("launch returned\n")
        while True:
            time.sleep(3600)
    except Exception as exc:
        with log_path.open("a", encoding="utf-8") as log_file:
            log_file.write(f"error: {exc!r}\n")
        raise
