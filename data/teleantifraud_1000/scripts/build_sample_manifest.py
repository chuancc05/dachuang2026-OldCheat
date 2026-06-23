from __future__ import annotations

import argparse
import csv
import json
import random
import zipfile
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable


DEFAULT_PRIORITY_LABELS = [
    "fraud",
    "银行诈骗",
    "客服诈骗",
    "投资诈骗",
    "钓鱼诈骗",
    "身份盗窃",
    "彩票诈骗",
    "绑架诈骗",
]

SCENE_LABELS = {
    "订餐服务",
    "咨询客服",
    "预约服务",
    "交通咨询",
    "日常购物",
    "打车服务",
    "外卖服务",
}

FRAUD_TYPE_LABELS = {
    "银行诈骗",
    "客服诈骗",
    "投资诈骗",
    "钓鱼诈骗",
    "身份盗窃",
    "彩票诈骗",
    "绑架诈骗",
}


@dataclass
class AudioRecord:
    audio_path: str
    source_split: str
    answers: set[str] = field(default_factory=set)
    message_counts: list[int] = field(default_factory=list)

    def add(self, answer: str, message_count: int) -> None:
        self.answers.add(answer)
        self.message_counts.append(message_count)

    @property
    def has_fraud_binary(self) -> bool:
        return "fraud" in self.answers

    @property
    def has_normal_binary(self) -> bool:
        return "normal" in self.answers

    @property
    def fraud_types(self) -> list[str]:
        return sorted(label for label in self.answers if label in FRAUD_TYPE_LABELS)

    @property
    def scenes(self) -> list[str]:
        return sorted(label for label in self.answers if label in SCENE_LABELS)

    def priority_score(self, priority_labels: list[str]) -> int:
        score = 0
        for index, label in enumerate(priority_labels):
            if label in self.answers:
                score += max(1, len(priority_labels) - index)
        if self.fraud_types:
            score += 3
        if self.has_fraud_binary:
            score += 4
        return score


def iter_jsonl_from_zip(zip_path: Path, inner_name: str) -> Iterable[dict]:
    with zipfile.ZipFile(zip_path) as zf:
        with zf.open(inner_name) as raw:
            for line in raw:
                if not line.strip():
                    continue
                yield json.loads(line.decode("utf-8"))


def load_audio_records(sft_zip: Path, split: str) -> dict[str, AudioRecord]:
    inner_name = f"sft/{split}.jsonl"
    records: dict[str, AudioRecord] = {}
    for obj in iter_jsonl_from_zip(sft_zip, inner_name):
        audio_paths = coerce_audio_paths(obj.get("audios"))
        answer = str(obj.get("answers", "")).strip()
        if not audio_paths or not answer:
            continue
        for audio_path in audio_paths:
            record = records.setdefault(
                audio_path,
                AudioRecord(audio_path=audio_path, source_split=split),
            )
            record.add(answer=answer, message_count=len(obj.get("messages", [])))
    return records


def coerce_audio_paths(value: object) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        return [value] if value.strip() else []
    if isinstance(value, list):
        return [str(item) for item in value if str(item).strip()]
    return [str(value)]


def stratified_sample(
    records: dict[str, AudioRecord],
    sample_size: int,
    priority_labels: list[str],
    seed: int,
) -> list[AudioRecord]:
    rng = random.Random(seed)
    selected: dict[str, AudioRecord] = {}

    buckets: dict[str, list[AudioRecord]] = defaultdict(list)
    for record in records.values():
        for answer in record.answers:
            buckets[answer].append(record)

    per_label_min = max(10, sample_size // max(1, len(priority_labels) * 3))
    for label in priority_labels:
        candidates = list({item.audio_path: item for item in buckets.get(label, [])}.values())
        candidates.sort(key=lambda item: (-item.priority_score(priority_labels), item.audio_path))
        rng.shuffle(candidates)
        for record in candidates[:per_label_min]:
            selected.setdefault(record.audio_path, record)

    remaining = [
        record
        for record in records.values()
        if record.audio_path not in selected
        and record.priority_score(priority_labels) > 0
    ]
    remaining.sort(key=lambda item: (-item.priority_score(priority_labels), item.audio_path))
    rng.shuffle(remaining)

    for record in remaining:
        if len(selected) >= sample_size:
            break
        selected.setdefault(record.audio_path, record)

    final = list(selected.values())
    final.sort(key=lambda item: (-item.priority_score(priority_labels), item.audio_path))
    return final[:sample_size]


def audio_zip_paths(audio_zip: Path | None) -> set[str]:
    if not audio_zip:
        return set()
    with zipfile.ZipFile(audio_zip) as zf:
        return set(zf.namelist())


def normalize_zip_path(path: str) -> str:
    return path.replace("\\", "/").lstrip("/")


def write_manifest(
    records: list[AudioRecord],
    output_dir: Path,
    audio_names: set[str],
) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    csv_path = output_dir / "sample_manifest.csv"
    jsonl_path = output_dir / "sample_manifest.jsonl"

    rows = []
    for index, record in enumerate(records, start=1):
        normalized_audio_path = normalize_zip_path(record.audio_path)
        audio_exists = normalized_audio_path in audio_names if audio_names else ""
        row = {
            "sample_id": f"taf-{index:04d}",
            "source_split": record.source_split,
            "audio_path": normalized_audio_path,
            "answers": ";".join(sorted(record.answers)),
            "has_fraud_binary": str(record.has_fraud_binary).lower(),
            "has_normal_binary": str(record.has_normal_binary).lower(),
            "fraud_types": ";".join(record.fraud_types),
            "scene_labels": ";".join(record.scenes),
            "message_counts": ";".join(str(item) for item in sorted(set(record.message_counts))),
            "audio_exists_in_zip": audio_exists,
            "transcript_status": "pending",
            "transcript_text": "",
        }
        rows.append(row)

    fieldnames = list(rows[0].keys()) if rows else [
        "sample_id",
        "source_split",
        "audio_path",
        "answers",
        "has_fraud_binary",
        "has_normal_binary",
        "fraud_types",
        "scene_labels",
        "message_counts",
        "audio_exists_in_zip",
        "transcript_status",
        "transcript_text",
    ]
    with csv_path.open("w", newline="", encoding="utf-8-sig") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)

    with jsonl_path.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")


def write_summary(records: list[AudioRecord], output_dir: Path, audio_names: set[str]) -> None:
    answer_counts = Counter()
    fraud_type_counts = Counter()
    scene_counts = Counter()
    for record in records:
        answer_counts.update(record.answers)
        fraud_type_counts.update(record.fraud_types)
        scene_counts.update(record.scenes)

    audio_verified = bool(audio_names)
    existing_count = sum(
        1 for record in records
        if normalize_zip_path(record.audio_path) in audio_names
    ) if audio_verified else None

    summary = {
        "sample_count": len(records),
        "audio_zip_verified": audio_verified,
        "audio_paths_found": existing_count,
        "answer_counts": dict(answer_counts.most_common()),
        "fraud_type_counts": dict(fraud_type_counts.most_common()),
        "scene_counts": dict(scene_counts.most_common()),
        "next_step": "Download audio.zip, rerun with --audio-zip and --verify-audio, then transcribe the manifest.",
    }
    (output_dir / "sample_summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build a pilot sample manifest from TeleAntiFraud sft.zip.")
    parser.add_argument("--sft-zip", required=True, type=Path)
    parser.add_argument("--audio-zip", type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--sample-size", type=int, default=400)
    parser.add_argument("--split", default="train", choices=["train", "test"])
    parser.add_argument("--seed", type=int, default=20260620)
    parser.add_argument("--priority-labels", nargs="*", default=DEFAULT_PRIORITY_LABELS)
    parser.add_argument("--verify-audio", action="store_true")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if not args.sft_zip.exists():
        raise FileNotFoundError(f"sft zip not found: {args.sft_zip}")
    if args.verify_audio and (not args.audio_zip or not args.audio_zip.exists()):
        raise FileNotFoundError("--verify-audio requires an existing --audio-zip")

    records = load_audio_records(args.sft_zip, args.split)
    sampled = stratified_sample(
        records=records,
        sample_size=args.sample_size,
        priority_labels=args.priority_labels,
        seed=args.seed,
    )
    names = audio_zip_paths(args.audio_zip) if args.verify_audio else set()
    write_manifest(sampled, args.output_dir, names)
    write_summary(sampled, args.output_dir, names)

    print(f"Loaded unique audio records: {len(records)}")
    print(f"Sampled records: {len(sampled)}")
    print(f"Output directory: {args.output_dir.resolve()}")


if __name__ == "__main__":
    main()
