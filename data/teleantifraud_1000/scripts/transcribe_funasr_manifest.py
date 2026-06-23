from __future__ import annotations

import argparse
import csv
import json
import os
import shutil
import subprocess
import tempfile
import time
import zipfile
from pathlib import Path
from typing import Any


def load_manifest(path: Path) -> list[dict[str, str]]:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def write_manifest(path: Path, rows: list[dict[str, str]]) -> None:
    if not rows:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)


def configure_model_cache(project_root: Path) -> None:
    default_cache = Path(tempfile.gettempdir()) / "teleantifraud_pilot_model_cache"
    cache_root = Path(os.environ.get("FUNASR_MODEL_CACHE", default_cache))
    os.environ.setdefault("MODELSCOPE_CACHE", str(cache_root / "modelscope"))
    os.environ.setdefault("HF_HOME", str(cache_root / "huggingface"))
    cache_root.mkdir(parents=True, exist_ok=True)


def find_ffmpeg(project_root: Path) -> str:
    local_ffmpeg = project_root / "teleantifraud_pilot" / "tools" / "ffmpeg.exe"
    if local_ffmpeg.exists():
        return str(local_ffmpeg)
    ffmpeg = shutil.which("ffmpeg")
    if ffmpeg:
        return ffmpeg
    raise FileNotFoundError("ffmpeg was not found")


def convert_to_wav(ffmpeg: str, source: Path, target: Path) -> None:
    command = [
        ffmpeg,
        "-y",
        "-loglevel",
        "error",
        "-i",
        str(source),
        "-ac",
        "1",
        "-ar",
        "16000",
        str(target),
    ]
    subprocess.run(command, check=True)


def build_model(engine: str):
    from funasr import AutoModel

    if engine == "paraformer_hotword":
        return AutoModel(
            model="paraformer-zh",
            vad_model="fsmn-vad",
            punc_model="ct-punc",
            device="cpu",
            disable_update=True,
        )
    if engine == "sensevoice":
        return AutoModel(
            model="iic/SenseVoiceSmall",
            vad_model="fsmn-vad",
            device="cpu",
            disable_update=True,
        )
    raise ValueError(f"Unsupported engine: {engine}")


def extract_text(result: Any) -> str:
    if isinstance(result, list):
        parts = [extract_text(item) for item in result]
        return "".join(part for part in parts if part).strip()
    if isinstance(result, dict):
        if "text" in result and result["text"]:
            return str(result["text"]).strip()
        if "sentence_info" in result and result["sentence_info"]:
            sentences = []
            for item in result["sentence_info"]:
                if isinstance(item, dict):
                    sentences.append(str(item.get("sentence", "")))
            return "".join(sentences).strip()
    return str(result).strip()


def transcribe(model, engine: str, wav_path: Path, hotword: str) -> str:
    if engine == "paraformer_hotword":
        result = model.generate(input=str(wav_path), hotword=hotword, batch_size_s=60)
        return extract_text(result)
    result = model.generate(
        input=str(wav_path),
        language="zh",
        use_itn=True,
        batch_size_s=60,
        merge_vad=True,
        merge_length_s=15,
    )
    return extract_text(result)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Transcribe a manifest with FunASR models.")
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--audio-zip", type=Path, default=None)
    parser.add_argument("--engine", choices=["paraformer_hotword", "sensevoice"], required=True)
    parser.add_argument("--hotword", default="")
    parser.add_argument("--limit", type=int, default=30)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    project_root = Path.cwd()
    configure_model_cache(project_root)
    ffmpeg = find_ffmpeg(project_root)

    rows = load_manifest(args.manifest)
    for row in rows:
        row.setdefault(f"{args.engine}_status", "pending")
        row.setdefault(f"{args.engine}_text", "")
        row.setdefault(f"{args.engine}_seconds", "")

    model = build_model(args.engine)
    pending = [row for row in rows if row.get(f"{args.engine}_status") != "done"]
    selected = pending[: args.limit]

    with tempfile.TemporaryDirectory() as tmp:
        tmp_dir = Path(tmp)
        zip_handle = zipfile.ZipFile(args.audio_zip) if args.audio_zip else None
        try:
            for index, row in enumerate(selected, start=1):
                wav_path = tmp_dir / f"{row['sample_id']}.wav"
                start = time.perf_counter()
                try:
                    if row.get("local_audio_path"):
                        source = project_root / row["local_audio_path"]
                    elif zip_handle:
                        audio_path_in_zip = row["audio_path"].replace("\\", "/").lstrip("/")
                        source = tmp_dir / f"{row['sample_id']}{Path(audio_path_in_zip).suffix}"
                        with zip_handle.open(audio_path_in_zip) as source_stream, source.open("wb") as target:
                            shutil.copyfileobj(source_stream, target)
                    else:
                        raise ValueError("row has no local_audio_path; pass --audio-zip to extract audio_path")

                    convert_to_wav(ffmpeg, source, wav_path)
                    text = transcribe(model, args.engine, wav_path, args.hotword)
                    row[f"{args.engine}_text"] = text
                    row[f"{args.engine}_status"] = "done" if text else "empty"
                    row[f"{args.engine}_seconds"] = f"{time.perf_counter() - start:.2f}"
                    print(f"[{index}/{len(selected)}] {row['sample_id']} {row[f'{args.engine}_status']}")
                except Exception as exc:
                    row[f"{args.engine}_status"] = f"error: {exc}"
                    row[f"{args.engine}_seconds"] = f"{time.perf_counter() - start:.2f}"
                    print(f"[{index}/{len(selected)}] {row['sample_id']} error: {exc}")
        finally:
            if zip_handle:
                zip_handle.close()

    write_manifest(args.output, rows)
    jsonl_path = args.output.with_suffix(".jsonl")
    with jsonl_path.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")

    print(f"Updated manifest: {args.output.resolve()}")
    print(f"Updated JSONL: {jsonl_path.resolve()}")


if __name__ == "__main__":
    main()
