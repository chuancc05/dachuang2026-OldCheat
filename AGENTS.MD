# AGENTS.MD

## 项目概览

OldCheat 是一个面向老年人的本地反电信诈骗沉浸式训练系统。当前仓库主要包含三部分：

- `app/` 中的 Python/Gradio 主应用，通过 `run_oldcheat.py` 启动。
- `frontend/` 中较新的 Next.js 训练台前端原型。
- `data/` 中的场景库、语料台账和 TeleAntiFraud 数据处理产物。

后续开发、调试和文档整理默认在以下项目根目录进行：

```powershell
C:\Users\22852\OneDrive\Desktop\Program\dachuang2026-Oldcheat\Old_cheat_github_link
```

## 常用命令

启动 Python/Gradio 应用：

```powershell
D:\develop\python3.12\python.exe .\run_oldcheat.py
```

启动后访问：

```text
http://127.0.0.1:7860/
```

Windows 下优先使用的启动脚本：

```powershell
.\start_oldcheat.bat
```

启动 Next.js 前端原型：

```powershell
cd frontend
pnpm.cmd run dev
```

启动后访问：

```text
http://127.0.0.1:3000/
```

需要安装 Python 依赖时：

```powershell
pip install -r requirements.txt
```

需要安装前端依赖时：

```powershell
cd frontend
pnpm.cmd install
```

## Python 应用结构

- `run_oldcheat.py`：推荐使用的 Gradio 启动入口。它会兼容 `huggingface_hub.HfFolder`、规避部分 Gradio API schema 问题、关闭 analytics，并设置 localhost 代理绕过。
- `app/main.py`：构建 Gradio UI，连接训练状态、场景选择、对话流程、语音输入、风险评分、报告生成和训练结束逻辑。
- `app/config.py`：集中管理项目路径和环境变量配置。重要环境变量包括 `OLLAMA_URL`、`DEFAULT_MODEL`、`OLLAMA_TIMEOUT`、`MAX_CONTEXT_MESSAGES` 和 `WHISPER_MODEL`。
- `app/core/`：对话管理、Ollama 客户端、提示词构建、场景定义和素材库增强逻辑。
- `app/psychology/`：诈骗识别、心理风险维度、评分和检测逻辑。
- `app/database/`：SQLAlchemy 数据模型和 SQLite 数据库管理器。运行数据库路径是 `data/data.db`。
- `app/report/`：PDF 报告生成和图表输出。
- `app/voice/`：基于 Whisper 的语音识别和 TTS 辅助模块。
- `app/ui/styles.css`：Gradio 页面样式。

默认不要直接运行 `python app/main.py`。除非明确需要绕过兼容启动器，否则优先使用 `run_oldcheat.py`。

## 前端结构

- `frontend/app/page.tsx`：从 `../data/scenario_library.json` 加载动态场景，失败时回退到静态场景。
- `frontend/app/api/training-chat/route.ts`：Next API 路由，调用本地 Ollama，并在失败时回退到预设话术。
- `frontend/components/training/`：训练界面组件，包括场景栏、模拟对话区、回复栏、教练面板、风险仪表和报告弹窗。
- `frontend/lib/scenarios.ts`：前端静态兜底场景、用户回复评估和风险等级辅助函数。
- `frontend/components/ui/`：通用 UI 组件。

界面相关工作通常优先在 `frontend/` 中进行。这个项目的前端应保持为可用的训练工作台，而不是宣传型落地页。

## 数据与运行产物

重要数据路径：

- `data/scenario_library.json`：动态场景库，Python 应用和 Next.js 前端都会读取。
- `data/teleantifraud_1000/`：1000 条样本台账、ASR 转写结果、AI 初审结果、统计摘要和处理脚本。
- `data/teleantifraud_1000/processed_layers/`：分层数据资产、系统素材库、补充场景素材和数据处理报告。
- `data/data.db`：运行时 SQLite 数据库。
- `data/reports/`：生成的雷达图和 PDF 训练报告。
- `data/bin/ffmpeg.exe`：音频工作流使用的本地二进制文件。

处理生成文件时要谨慎：

- `data/data.db`、`data/reports/`、`data/matplotlib/`、`__pycache__/`、`.next/`、`node_modules/` 和 `.pnpm-store/` 属于运行产物或缓存。
- 不要把 `audio.zip` 这类超大原始压缩包复制进仓库。已有记录中，外部来源包括 `D:\edge\audio.zip` 和 `D:\edge\sft.zip`。
- 不要把补充素材描述成外部真实采集的原始数据。如果在论文、软著或结题材料中使用，应按实际情况标注为规则构造或人工模拟补充语料。

## 本地服务约定

应用默认依赖本地 Ollama：

```text
http://localhost:11434
```

默认模型：

```text
qwen2:7b
```

如果 Ollama 不可用，Python 应用和前端都有若干兜底话术逻辑。排查对话质量时，要区分当前回复来自模型生成，还是来自 fallback 脚本。

## 开发约定

- 保持修改范围克制。当前工作区经常会有用户已有改动和运行产物，不要擅自 reset、clean 或回滚。
- 较大改动前先查看 `git status --short`。
- 保留现有的数据驱动场景流程。新增或调整场景时，优先更新 `data/scenario_library.json` 或素材库管线，而不是在 UI 代码里硬编码。
- 修改 Gradio、Hugging Face Hub 或 `gradio_client` 版本前，要考虑 `run_oldcheat.py` 中已有的兼容补丁。
- 项目中有大量中文 UI 和内容文件，并且曾经遇到 Windows 批处理与编码问题。避免无意义地重写大段中文文件；新建 Markdown 使用 UTF-8。
- 前端样式遵循现有 Next/Tailwind 组件结构。需要图标时优先使用 `lucide-react`，界面应保持训练工作台的清晰、克制和可操作性。
- 修改 `app/report/pdf_generator.py` 时，要验证中文字体和 PDF 中文显示。
- 修改音频或 ASR 相关逻辑时，要验证麦克风、上传音频和 `WHISPER_MODEL` 行为；不要默认用户有 GPU。

## 验证清单

Python/Gradio 改动后：

1. 使用 `D:\develop\python3.12\python.exe .\run_oldcheat.py` 启动。
2. 确认 `http://127.0.0.1:7860/` 能打开。
3. 开始一个训练场景，确认诈骗方第一句话会自动出现。
4. 至少发送一条文字回复，确认风险分析会更新。
5. 结束训练，确认 `data/reports/` 下会生成 PDF 报告。
6. 如果改了语音相关代码，测试麦克风或上传音频转写。

前端改动后：

1. 运行 `cd frontend`，再运行 `pnpm.cmd run dev`。
2. 确认 `http://127.0.0.1:3000/` 能打开。
3. 验证场景选择、开始/重置、回复提交、fallback 行为、教练面板和报告弹窗。
4. 如果改了场景加载逻辑，同时测试动态 `data/scenario_library.json` 路径和静态 fallback 场景。
5. 条件允许时运行 `pnpm.cmd run build` 做生产构建检查。

数据改动后：

1. 验证 `data/scenario_library.json` 和处理后素材文件的 JSON 语法。
2. 保留样本 ID、来源字段和数据溯源说明。
3. 除非任务明确要求，不要提交重新生成的报告、缓存或运行产物。

## 已知注意事项

- Gradio 应用使用端口 `7860`；前端开发服务器使用端口 `3000`。
- localhost 和代理设置可能影响 Gradio 启动；`run_oldcheat.py` 已有意设置 `NO_PROXY` 并关闭 analytics。
- SQLite 与 OneDrive 有时会出现文件锁问题。如果工具会话中显示 `data/data.db` 只读，先在用户正常终端中复测，不要立刻判断应用坏了。
- 当前仓库可能包含已修改的 `.pyc`、数据库、前端构建产物和生成报告。除非任务就是清理它们，否则忽略无关脏文件。