# TeleAntiFraud 1000 条语料说明

本目录保存 OldCheat 项目使用的 TeleAntiFraud 诈骗对话语料台账、ASR 转写结果与 AI 初审结果。

## 文件说明

- `sample_manifest.csv` / `sample_manifest.jsonl`：1000 条样本台账，包含样本 ID、原始标签、音频路径、音频是否存在等信息。
- `sample_manifest_1000_paraformer_hotword_transcribed.csv` / `.jsonl`：1000 条 Paraformer-zh + 热词 ASR 转写结果。
- `teleantifraud_1000_ai_review.csv`：1000 条样本的 AI 初审结果，包含建议细分标签、映射训练场景、可用性、质量评分和备注。
- `teleantifraud_1000_ai_review.xlsx`：便于人工查看和抽检的 Excel 版本。
- `teleantifraud_1000_ai_review_summary.json`：1000 条 AI 初审统计摘要。
- `teleantifraud_1000_system_ready.csv`：建议可接入系统场景库的 973 条样本子集。
- `sample_summary.json`：1000 条抽样台账的原始标签统计。
- `scripts/`：生成台账、执行 ASR 转写和 AI 初审的处理脚本副本。

## 数据处理结果

- 台账样本数：1000 条
- ASR 转写成功：1000 条
- AI 初审结论：
  - 可直接用：840 条
  - 需轻微清洗：144 条
  - 仅作台账：16 条
- 建议接入系统：973 条

## 未纳入项目目录的文件

原始音频压缩包 `audio.zip` 体积约 12.7GB，未复制进项目目录，以避免项目过大。
原始音频仍保存在本机：

```text
D:\edge\audio.zip
```

原始 SFT 标注压缩包保存在：

```text
D:\edge\sft.zip
```

## 用途

这批数据用于支撑：

- 真实诈骗语料台账建设
- 诈骗语音 ASR 转写流程
- 诈骗类型细分标签归一
- OldCheat 动态场景库构建
- 软著说明书与大创结题材料
- 后续论文的数据处理与系统设计部分
