from __future__ import annotations

import os
import time
import random
from functools import lru_cache
from pathlib import Path
from threading import Lock
from typing import Any, Dict, Generator, List, Tuple

os.environ["NO_PROXY"] = "127.0.0.1,localhost"
os.environ["no_proxy"] = "127.0.0.1,localhost"
os.environ["GRADIO_ANALYTICS_ENABLED"] = "False"

import gradio as gr

from app.config import DATA_DIR, WHISPER_MODEL
from app.core import DialogueManager, SCENES
from app.database import db
from app.psychology import DIMENSIONS, FraudDetector, PsychologyAnalyzer, ScoreTracker
from app.report.pdf_generator import PDFReportGenerator
from app.report.radar_chart import generate_radar_chart


REPORT_DIR = DATA_DIR / "reports"
REPORT_DIR.mkdir(parents=True, exist_ok=True)
_DB_LOCK = Lock()
_DB_READY = False
MAX_TRAINING_ROUNDS = 10


def _ensure_db() -> None:
    global _DB_READY
    if _DB_READY:
        return
    with _DB_LOCK:
        if not _DB_READY:
            db.init_db()
            _DB_READY = True


def _load_css() -> str:
    css_path = Path(__file__).resolve().parent / "ui" / "styles.css"
    return css_path.read_text(encoding="utf-8") if css_path.exists() else ""


def _scene_choices() -> List[str]:
    return [
        f"{scene_id} | {scene.name} | {scene.difficulty}"
        for scene_id, scene in SCENES.items()
    ]


def _scene_id_from_label(label: str | None) -> str:
    if not label:
        return next(iter(SCENES))
    scene_id = label.split("|", 1)[0].strip()
    return scene_id if scene_id in SCENES else next(iter(SCENES))


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
    risk_percent = max(0, min(100, int(score * 10)))
    return (
        f"<div class='risk-card {cls}'>"
        "<div class='risk-card-title'>心理风险预警（实时）</div>"
        f"<div class='risk-meter' style='--risk-percent:{risk_percent}'>"
        "<div class='risk-meter-inner'></div>"
        "</div>"
        f"<div class='risk-score'>风险等级：<strong>{level}</strong></div>"
        f"<div class='risk-number'>{score:.1f}/10</div>"
        "</div>"
    )


def _progress_html(state: Dict[str, Any] | None = None) -> str:
    current_round = int((state or {}).get("round") or 0)
    progress = min(100, int(current_round / MAX_TRAINING_ROUNDS * 100))
    return (
        "<div class='top-progress'>"
        "<div class='mode-pill'>训练模式：对话训练</div>"
        "<div class='progress-track'>"
        f"<div class='progress-fill' style='width:{progress}%'></div>"
        "</div>"
        f"<div class='progress-text'>进度：{current_round}/{MAX_TRAINING_ROUNDS}</div>"
        "</div>"
    )


def _scene_header_html(state: Dict[str, Any] | None = None) -> str:
    scene_id = (state or {}).get("scene_id")
    if scene_id and scene_id in SCENES:
        scene = SCENES[scene_id]
        return (
            "<div class='scene-header'>"
            f"<span>当前场景：{scene.name}</span>"
            f"<small>{scene.difficulty} · {scene.core_tactics}</small>"
            "</div>"
        )
    return "<div class='scene-header'><span>当前场景：未开始</span><small>请选择左侧场景并开始训练</small></div>"


def _top_dimensions_markdown(state: Dict[str, Any]) -> str:
    if not state:
        return "尚未开始评分。"
    tracker: ScoreTracker | None = state.get("tracker")
    if not tracker:
        return "尚未开始评分。"
    top = tracker.get_top_activated_dimensions(5)
    active = [item for item in top if item[1] > 0]
    if not active:
        return "当前未检测到明显心理弱点激活。"
    return "\n".join([f"- {_dimension_label(dim_id)}：{score:.1f}/10" for dim_id, score in active])


def _advice_markdown(state: Dict[str, Any]) -> str:
    if not state:
        return "选择场景并开始训练后，这里会显示即时建议。"
    tracker: ScoreTracker | None = state.get("tracker")
    if not tracker:
        return "选择场景并开始训练后，这里会显示即时建议。"
    top = [item for item in tracker.get_top_activated_dimensions(3) if item[1] > 0]
    if not top:
        return "保持核实身份、拒绝验证码、拒绝转账的习惯。"
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
    lines = []
    for dim_id, score in top:
        lines.append(f"- {_dimension_label(dim_id)}（{score:.1f}/10）：{advice.get(dim_id, '遇到可疑情况，先停止对话，再找家人或官方渠道核实。')}")
    return "\n".join(lines)


def _fallback_ai_reply(scene_id: str, user_text: str) -> str:
    scene = SCENES[scene_id]
    if any(word in user_text for word in ["骗子", "报警", "不信", "挂了", "核实"]):
        return "您的警惕性很强。训练到这里可以停一下：遇到可疑要求，先挂断并通过官方渠道核实。"
    if scene_id == "SC-01":
        return "我是办案人员，现在情况比较紧急。为了核实账户安全，请您先不要告诉家里人，按我说的步骤配合登记。"
    if scene_id == "SC-06":
        return "妈，我这边真的很急，原来的手机坏了。这个事情先别打别的电话，能不能先帮我处理一下费用？"
    return f"您先别着急，我这里是{scene.name}相关的专员。这个机会有时间限制，请您先按我说的确认一下。"


def _initial_ai_message(scene_id: str) -> str:
    scene = SCENES.get(scene_id)
    if scene and scene.openings:
        return random.choice(scene.openings)

    openings = {
        "SC-01": [
            "您好，我是市公安局反诈中心的工作人员。您的身份证信息可能涉及一起洗钱案件，请您现在配合我们核实账户情况。",
            "您好，这里是某地公安机关。我们发现您的银行卡和一起案件有关，请您保持电话畅通，不要和其他人说。",
            "您好，我们正在办理一宗金融案件，需要核实您的身份和账户流水。请您找个安静的地方配合调查。",
        ],
        "SC-02": [
            "您好，我是中安财富的理财顾问。我们这边有一款内部稳健项目，收益比银行存款高很多，想给您简单介绍一下。",
            "您好，我们银行合作平台最近开放了一个短期理财名额，风险很低，年化收益可以到百分之十五。",
            "您好，我是华辰投资的小李。我们有老师一对一带您做稳健理财，先小额体验也可以。",
        ],
        "SC-03": [
            "您好，我们平台正在招募线上任务体验员，每天在手机上点几下就有佣金，您现在方便了解一下吗？",
            "您好，我们这边有一个手机兼职任务，操作很简单，完成一单马上返佣，您要不要试一单？",
            "您好，平台今天有商家数据维护任务，不需要经验，跟着步骤操作就能拿到佣金。",
        ],
        "SC-04": [
            "阿姨您好，我们社区健康服务中心今天有免费专家名额，主要针对睡眠、血压和关节问题，想先给您做个简单登记。",
            "叔叔您好，我们这边有一场免费的健康讲座，还能领血压仪和体验装，想给您留一个名额。",
            "您好，我是康养中心的健康顾问。我们最近在做老年慢病回访，想了解一下您的身体情况。",
        ],
        "SC-05": [
            "您好，恭喜您被抽中本次福利活动一等奖，奖金和礼品已经预留，需要您现在确认一下领奖信息。",
            "您好，这里是活动兑奖中心。您的手机号中了幸运奖，奖金今天内确认后就可以发放。",
            "您好，系统显示您获得本期公益抽奖资格，奖品价值较高，需要先核实身份信息。",
        ],
        "SC-06": [
            "妈，我手机摔坏了，这是临时号码。学校这边有个费用今天必须处理，您先别打我原来的电话，能不能先帮我一下？",
            "爸，我现在不方便打电话，手机坏了。老师这边催一个培训费，您先帮我转一下。",
            "妈，我这边出了点急事，原来的微信登不上了。您先别问太多，能不能先按我说的处理一下？",
        ],
    }
    return random.choice(openings.get(scene_id, ["您好，我这边有一件比较重要的事情需要和您确认一下，麻烦您先听我说。"]))


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
        "report_path": None,
    }


def _success_intent(text: str) -> bool:
    return any(word in text for word in ["骗子", "报警", "110", "我不信", "不转", "不给", "不能给", "挂断", "官方电话", "核实", "问家人", "问银行"])


def _failure_completion_intent(text: str) -> bool:
    return any(word in text for word in ["已经操作", "操作完成", "已经转", "转过去", "已经给", "发给你", "验证码是", "密码是", "到ATM", "到atm", "在ATM", "在atm"])


def _finalize_training(
    chat_history: List[List[str | None]],
    state: Dict[str, Any],
    final_message: str | None = None,
) -> Tuple[List[List[str | None]], str, str, str, str | None, str, Dict[str, Any], str, str]:
    chat_history = chat_history or []
    if not state or not state.get("manager") or not state.get("session_id"):
        return chat_history, _risk_markdown(0), "尚未开始评分。", "请先开始训练。", None, "没有可结束的训练。", state, _progress_html(state), _scene_header_html(state)

    if state.get("ended") and state.get("report_path"):
        return chat_history, _risk_markdown(state["tracker"].get_composite_score()), _top_dimensions_markdown(state), _advice_markdown(state), state["report_path"], "本次训练已结束，报告已生成。", state, _progress_html(state), _scene_header_html(state)

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
    scene_definition = SCENES[state["scene_id"]]
    summary = f"{analysis} 本次训练共进行 {state['round']} 轮对话，综合风险评分为 {state['tracker'].get_composite_score():.1f}/10。"
    report_path = PDFReportGenerator().generate_report(
        output_path=str(pdf_path),
        user_name="本地用户",
        scene=scene_definition.name,
        summary=summary,
        radar_chart_path=str(radar_path),
        dimension_scores=scores,
        failure_points=_extract_failure_points(history),
        dialogue_history=history,
        scene_examples=scene_definition.report_examples[:3],
    )
    state["report_path"] = report_path
    db.end_session(state["session_id"], identified_fraud=identified, pdf_report_path=report_path)

    result_text = "识别成功" if identified else "仍需练习"
    end_text = final_message or f"训练结束：{result_text}。{analysis} 报告已生成。"
    chat_history = chat_history + [[None, end_text]]
    return chat_history, _risk_markdown(state["tracker"].get_composite_score()), _top_dimensions_markdown(state), _advice_markdown(state), report_path, "报告已生成。", state, _progress_html(state), _scene_header_html(state)


def start_training(scene_label: str, difficulty: str) -> Tuple[Dict[str, Any], List[List[str | None]], str, str, str, str, None, str, str]:
    _ensure_db()
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
    first_ai_text = _initial_ai_message(scene_id)
    state["manager"].messages.append({"role": "assistant", "content": first_ai_text})
    state["last_ai_text"] = first_ai_text
    db.add_dialogue_turn(state["session_id"], "ai", first_ai_text, 0)
    chat = [[None, opening], [None, first_ai_text]]
    return state, chat, _risk_markdown(0), "尚未开始评分。", _advice_markdown(state), "训练已开始。", None, _progress_html(state), _scene_header_html(state)


def send_message(
    user_text: str,
    chat_history: List[List[str | None]],
    state: Dict[str, Any],
) -> Generator[Tuple[List[List[str | None]], str, str, str, str, None, str, Dict[str, Any], str, str], None, None]:
    chat_history = chat_history or []
    if not user_text or not user_text.strip():
        yield chat_history, "", _risk_markdown(0), _top_dimensions_markdown(state), _advice_markdown(state), None, "请输入内容后再发送。", state, _progress_html(state), _scene_header_html(state)
        return

    if not state or not state.get("manager"):
        default_scene = _scene_choices()[0]
        state, chat_history, *_rest = start_training(default_scene, "中")

    if state.get("ended"):
        yield chat_history, "", _risk_markdown(state["tracker"].get_composite_score()), _top_dimensions_markdown(state), _advice_markdown(state), None, "本次训练已结束，请点击开始训练创建新会话。", state, _progress_html(state), _scene_header_html(state)
        return

    manager: DialogueManager = state["manager"]
    state["round"] += 1
    round_number = state["round"]
    clean_text = user_text.strip()

    chat_history = chat_history + [[clean_text, ""]]
    yield chat_history, "", _risk_markdown(state["tracker"].get_composite_score()), _top_dimensions_markdown(state), _advice_markdown(state), None, "AI 正在回复。", state, _progress_html(state), _scene_header_html(state)

    full_response = ""
    for chunk in manager.chat(clean_text):
        full_response += chunk
        chat_history[-1][1] = full_response
        yield chat_history, "", _risk_markdown(state["tracker"].get_composite_score()), _top_dimensions_markdown(state), _advice_markdown(state), None, "AI 正在回复。", state, _progress_html(state), _scene_header_html(state)

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
        final = _finalize_training(chat_history, state, "训练已按您的要求停止，系统已生成本次报告。")
        yield final[0], "", final[1], final[2], final[3], final[4], final[5], final[6], final[7], final[8]
        return
    if _success_intent(clean_text):
        final = _finalize_training(chat_history, state, "您已经做出拒绝或核实行为，本次训练自动结束，系统已生成报告。")
        yield final[0], "", final[1], final[2], final[3], final[4], final[5], final[6], final[7], final[8]
        return
    if _failure_completion_intent(clean_text):
        final = _finalize_training(chat_history, state, "系统检测到您已经按对方要求执行高风险操作，本次训练自动结束并生成报告。")
        yield final[0], "", final[1], final[2], final[3], final[4], final[5], final[6], final[7], final[8]
        return
    if state["round"] >= MAX_TRAINING_ROUNDS:
        final = _finalize_training(chat_history, state, "本次训练已达到建议轮次，系统自动结束并生成报告。")
        yield final[0], "", final[1], final[2], final[3], final[4], final[5], final[6], final[7], final[8]
        return

    status = "本轮评分已更新。"

    yield chat_history, "", _risk_markdown(composite), _top_dimensions_markdown(state), _advice_markdown(state), None, status, state, _progress_html(state), _scene_header_html(state)


def finish_training(
    chat_history: List[List[str | None]],
    state: Dict[str, Any],
) -> Tuple[List[List[str | None]], str, str, str, str | None, str, Dict[str, Any], str, str]:
    return _finalize_training(chat_history, state)


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
        text = _get_asr(WHISPER_MODEL).transcribe(audio_path)
        return text, "语音识别完成，可以修改后发送。"
    except Exception as exc:
        return "", f"语音识别暂不可用：{exc}"


def send_text_or_audio(
    user_text: str,
    audio_path: str | None,
    chat_history: List[List[str | None]],
    state: Dict[str, Any],
) -> Generator[Tuple[List[List[str | None]], str, str, str, str, None, str, Dict[str, Any], str, str], None, None]:
    text = (user_text or "").strip()
    if not text and audio_path:
        yield chat_history or [], "", _risk_markdown(state["tracker"].get_composite_score() if state and state.get("tracker") else 0), _top_dimensions_markdown(state), _advice_markdown(state), None, "正在识别语音，请稍候。", state, _progress_html(state), _scene_header_html(state)
        text, status = transcribe_audio(audio_path)
        if not text:
            yield chat_history or [], "", _risk_markdown(state["tracker"].get_composite_score() if state and state.get("tracker") else 0), _top_dimensions_markdown(state), _advice_markdown(state), None, status, state, _progress_html(state), _scene_header_html(state)
            return

    yield from send_message(text, chat_history, state)


@lru_cache(maxsize=2)
def _get_asr(model_name: str):
    from app.voice.whisper_asr import WhisperASR

    return WhisperASR(model_name=model_name)


def replay_last_ai(state: Dict[str, Any]) -> str:
    last_ai_text = (state or {}).get("last_ai_text")
    if not last_ai_text:
        return "尚无上一条 AI 对话。"
    return f"上一条 AI 话术：{last_ai_text}"


def show_safety_tip() -> str:
    return "防诈提示：公检法、银行、客服不会要求您转账、提供验证码或屏幕共享。遇到催促时，先停下并找家人核实。"


def show_help_tip() -> str:
    return "求助建议：请立即联系家人、社区工作人员或拨打 110；不要继续和可疑来电保持单独通话。"


def build_app() -> gr.Blocks:
    with gr.Blocks(css=_load_css(), title="老年人电信诈骗沉浸式心理免疫训练系统") as demo:
        app_state = gr.State(_new_empty_state())

        with gr.Row(elem_classes=["topbar"]):
            gr.HTML(
                "<div class='brand'>"
                "<div class='brand-mark'>人</div>"
                "<div class='brand-copy'>"
                "<strong>老年用户防诈训练系统</strong>"
                "<span>沉浸式心理免疫训练</span>"
                "</div>"
                "</div>"
            )
            progress_bar = gr.HTML(_progress_html(_new_empty_state()))
            gr.HTML(
                "<div class='top-actions'>"
                "<span>首页</span><span>帮助</span><span>设置</span>"
                "</div>"
            )

        with gr.Row(elem_classes=["main-layout"]):
            with gr.Column(scale=1, min_width=250, elem_classes=["scene-panel"]):
                gr.Markdown("### 场景选择")
                scene_dropdown = gr.Radio(
                    choices=_scene_choices(),
                    value=_scene_choices()[0],
                    label=None,
                    elem_classes=["scene-list"],
                )
                difficulty = gr.Radio(["低", "中", "高"], value="中", label="训练强度")
                start_btn = gr.Button("开始训练", variant="primary", elem_classes=["start-btn"])
                finish_btn = gr.Button("结束训练并生成报告", elem_classes=["finish-btn"])
                gr.Markdown("### 快捷操作")
                replay_btn = gr.Button("重听上一条", elem_classes=["assist-btn"])
                safe_tip_btn = gr.Button("查看防诈提示", elem_classes=["assist-btn"])
                help_btn = gr.Button("求助家人 / 客服", elem_classes=["assist-btn"])
                status = gr.Markdown("请选择场景后开始训练。", elem_classes=["status-box"])

            with gr.Column(scale=3, min_width=560, elem_classes=["dialogue-panel"]):
                scene_header = gr.HTML(_scene_header_html(_new_empty_state()))
                chatbot = gr.Chatbot(label="对话训练", height=500, elem_classes=["training-chat"])
                with gr.Group(elem_classes=["input-dock"]):
                    with gr.Row(elem_classes=["input-row"]):
                        text_input = gr.Textbox(
                            label="文字输入",
                            placeholder="请输入您的回复，也可以录音后直接发送",
                            lines=2,
                            scale=5,
                        )
                        send_btn = gr.Button("发送", variant="primary", scale=1, elem_classes=["send-btn"])
                    audio_input = gr.Audio(
                        sources=["microphone", "upload"],
                        type="filepath",
                        label="语音输入",
                        elem_classes=["audio-input"],
                    )
                    transcribe_btn = gr.Button("识别语音到输入框", elem_classes=["transcribe-btn"])
                gr.HTML(
                    "<div class='safe-tip'>"
                    "<strong>提示：</strong>公检法、银行和客服不会要求转账、提供验证码或屏幕共享。"
                    "</div>"
                )

            with gr.Column(scale=1, min_width=310, elem_classes=["risk-panel"]):
                risk_level = gr.HTML(_risk_markdown(0))
                with gr.Group(elem_classes=["analysis-card"]):
                    gr.Markdown("### 主要触发因素")
                    top_dimensions = gr.Markdown("尚未开始评分。")
                with gr.Group(elem_classes=["analysis-card advice-card"]):
                    gr.Markdown("### 应对建议")
                    advice = gr.Markdown("选择场景并开始训练后，这里会显示即时建议。")
                report_file = gr.File(label="PDF 报告", elem_classes=["report-file"])

        with gr.Row(elem_classes=["bottom-assist"]):
            gr.HTML("<span>辅助功能</span>")
            gr.HTML("<span>大按钮操作</span>")
            gr.HTML("<span>语音与文字双输入</span>")
            with gr.Row(elem_classes=["bottom-actions"]):
                clear_btn = gr.Button("清空输入")

        start_btn.click(
            start_training,
            inputs=[scene_dropdown, difficulty],
            outputs=[app_state, chatbot, risk_level, top_dimensions, advice, status, report_file, progress_bar, scene_header],
        )
        send_btn.click(
            send_text_or_audio,
            inputs=[text_input, audio_input, chatbot, app_state],
            outputs=[chatbot, text_input, risk_level, top_dimensions, advice, report_file, status, app_state, progress_bar, scene_header],
        )
        text_input.submit(
            send_message,
            inputs=[text_input, chatbot, app_state],
            outputs=[chatbot, text_input, risk_level, top_dimensions, advice, report_file, status, app_state, progress_bar, scene_header],
        )
        finish_btn.click(
            finish_training,
            inputs=[chatbot, app_state],
            outputs=[chatbot, risk_level, top_dimensions, advice, report_file, status, app_state, progress_bar, scene_header],
        )
        transcribe_btn.click(transcribe_audio, inputs=[audio_input], outputs=[text_input, status])
        clear_btn.click(lambda: "", outputs=[text_input])
        replay_btn.click(replay_last_ai, inputs=[app_state], outputs=[status])
        safe_tip_btn.click(show_safety_tip, outputs=[status])
        help_btn.click(show_help_tip, outputs=[status])

    return demo


if __name__ == "__main__":
    log_path = DATA_DIR / "server_boot.log"
    try:
        import gradio.networking as gradio_networking

        gradio_networking.url_ok = lambda _url: True
        log_path.write_text("starting\n", encoding="utf-8")
        _ensure_db()
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
