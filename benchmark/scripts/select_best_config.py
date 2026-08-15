"""Select report configurations from a completed tuning-stage aggregate."""

from __future__ import annotations

import argparse
import csv
import json
import math
import re
from pathlib import Path
from typing import Any


TUNED_BACKENDS = ("openmp", "cuda", "mpi")
CONFIG_PATTERNS = {
    "openmp": (re.compile(r"^openmp_thr-(\d+)_blo-(\d+)$"), ("threads", "blocks")),
    "cuda": (re.compile(r"^cuda_seg-(\d+)_cud-(\d+)$"), ("segment_length", "cuda_threads_per_block")),
    "mpi": (re.compile(r"^mpi_pro-(\d+)_blo-(\d+)$"), ("processes", "blocks")),
}


def read_csv(path: Path) -> list[dict[str, str]]:
    with path.open("r", newline="", encoding="utf-8-sig") as handle:
        return list(csv.DictReader(handle))


def parse_bool(value: str) -> bool:
    return value.strip().lower() in {"1", "true", "yes"}


def parse_int(value: str, field: str, configuration_id: str) -> int:
    try:
        number = float(value)
    except (TypeError, ValueError) as error:
        raise ValueError(f"{configuration_id} has no usable {field}") from error
    if not math.isfinite(number) or not number.is_integer():
        raise ValueError(f"{configuration_id} has invalid {field}: {value!r}")
    return int(number)


def parse_configuration(backend: str, configuration_id: str) -> dict[str, int]:
    pattern, fields = CONFIG_PATTERNS[backend]
    match = pattern.fullmatch(configuration_id)
    if match is None:
        raise ValueError(f"unexpected {backend} configuration id: {configuration_id!r}")
    return {field: int(value) for field, value in zip(fields, match.groups())}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-config", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--suite-summary", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--selection-output", type=Path)
    args = parser.parse_args()

    config: dict[str, Any] = json.loads(args.base_config.read_text(encoding="utf-8"))
    manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
    expected_images = len(manifest.get("images", manifest))
    suite_rows = read_csv(args.suite_summary)

    selected_details: dict[str, Any] = {
        "criterion": "minimum total_encode_ms among complete, pixel-valid tuning configurations",
        "expected_images": expected_images,
        "backends": {},
    }
    best_configurations = config.setdefault("best_configurations", {})

    for backend in TUNED_BACKENDS:
        candidates = [
            row for row in suite_rows
            if row.get("stage") == "tuning"
            and row.get("backend") == backend
            and parse_bool(row.get("all_valid", ""))
            and parse_int(row.get("images", ""), "images", row.get("configuration_id", "")) == expected_images
        ]
        if not candidates:
            raise RuntimeError(
                f"no complete and valid {backend} configuration covers all {expected_images} tuning images"
            )
        winner = min(candidates, key=lambda row: float(row["total_encode_ms"]))
        configuration_id = winner["configuration_id"]
        chosen = parse_configuration(backend, configuration_id)
        best_configurations[backend] = chosen
        selected_details["backends"][backend] = {
            "configuration_id": configuration_id,
            "parameters": chosen,
            "images": expected_images,
            "total_encode_ms": float(winner["total_encode_ms"]),
            "suite_throughput_mpixels": float(winner["suite_throughput_mpixels"]),
        }
        print(f"selected {backend}: {configuration_id} ({chosen})")

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(config, indent=2) + "\n", encoding="utf-8")
    selection_output = args.selection_output or args.output.with_name("selected-configurations.json")
    selection_output.write_text(json.dumps(selected_details, indent=2) + "\n", encoding="utf-8")
    print(f"wrote full-stage configuration: {args.output}")
    print(f"wrote selection record: {selection_output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
