"""Flatten native JSON results into a CSV suitable for charts or reports."""

from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input-dir", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    rows = []
    for path in sorted(args.input_dir.rglob("*.json")):
        payload = json.loads(path.read_text(encoding="utf-8"))
        rows.append({
            "file": path.name,
            "status": payload.get("status"),
            "backend": payload.get("backend"),
            "width": payload.get("input", {}).get("width"),
            "height": payload.get("input", {}).get("height"),
            "encode_ms": payload.get("timing", {}).get("encode_ms"),
            "total_ms": payload.get("timing", {}).get("total_ms"),
            "output_bytes": payload.get("output", {}).get("bytes"),
            "throughput_mpixels": payload.get("output", {}).get("throughput_mpixels"),
            "compression_ratio": payload.get("output", {}).get("compression_ratio"),
            "validation_passed": payload.get("validation", {}).get("passed"),
        })
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0]) if rows else ["file", "status", "backend"])
        writer.writeheader()
        writer.writerows(rows)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

