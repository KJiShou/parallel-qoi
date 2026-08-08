"""Fail CI/benchmark runs when any native result is invalid."""

from __future__ import annotations

import argparse
import json
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("result_dir", type=Path)
    args = parser.parse_args()
    failures = []
    for path in sorted(args.result_dir.rglob("*.json")):
        payload = json.loads(path.read_text(encoding="utf-8"))
        if payload.get("status") != "success" or not payload.get("validation", {}).get("passed"):
            failures.append(path)
    if failures:
        for path in failures:
            print(f"invalid result: {path}")
        return 1
    print(f"verified {len(list(args.result_dir.rglob('*.json')))} result files")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

