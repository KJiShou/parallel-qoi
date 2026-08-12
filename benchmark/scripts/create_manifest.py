"""Create full and systematic stratified-subset manifests from category folders."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path


EXTENSIONS = {".png", ".bmp"}


def stable_id(relative: Path) -> str:
    digest = hashlib.sha256(relative.as_posix().encode("utf-8")).hexdigest()[:10]
    return f"{relative.stem}-{digest}"


def systematic_sample(items: list[Path], count: int) -> list[Path]:
    if count <= 0 or len(items) <= count:
        return items
    # Fixed midpoint sampling publishes a deterministic, non-random rule.
    return [items[min(len(items) - 1, int((index + 0.5) * len(items) / count))] for index in range(count)]


def make_entries(root: Path, stage: str, per_category: int | None,
                 category_map: dict[str, list[str]] | None = None) -> list[dict[str, str]]:
    entries: list[dict[str, str]] = []
    category_sources: list[tuple[str, list[Path]]] = []
    if category_map:
        for category_name, directories in category_map.items():
            candidates = []
            for directory in directories:
                source = root / directory
                candidates.extend(path for path in source.rglob("*") if path.is_file() and path.suffix.lower() in EXTENSIONS)
            category_sources.append((category_name, candidates))
    else:
        categories = sorted(path for path in root.iterdir() if path.is_dir())
        root_images = [path for path in root.iterdir() if path.is_file() and path.suffix.lower() in EXTENSIONS]
        if root_images:
            category_sources.append((root.name, root_images))
        for category_dir in categories:
            category_sources.append((category_dir.name, [
                path for path in category_dir.rglob("*") if path.is_file() and path.suffix.lower() in EXTENSIONS
            ]))
    for category_name, candidates in category_sources:
        images = sorted(
            candidates,
            key=lambda path: path.relative_to(root).as_posix().casefold(),
        )
        selected = systematic_sample(images, per_category) if per_category is not None else images
        for path in selected:
            relative = path.relative_to(root)
            entries.append({
                "id": stable_id(relative),
                "path": str(path.resolve()),
                "category": category_name,
                "channel_mode": "unknown",
                "stage": stage,
            })
    return entries


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, required=True, help="Dataset root with one directory per category")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--stage", choices=("correctness", "tuning", "full"), required=True)
    parser.add_argument("--per-category", type=int)
    parser.add_argument("--category-map", type=Path, help="JSON object mapping report categories to source directories")
    parser.add_argument("--absolute-paths", action="store_true")
    args = parser.parse_args()
    category_map = json.loads(args.category_map.read_text(encoding="utf-8")) if args.category_map else None
    entries = make_entries(args.root.resolve(), args.stage, args.per_category, category_map)
    if not args.absolute_paths:
        for entry in entries:
            entry["path"] = os.path.relpath(entry["path"], args.output.parent.resolve())
    payload = {
        "name": f"{args.stage}-dataset",
        "sampling_rule": "sorted midpoint systematic sampling" if args.per_category else "all supported images",
        "root": str(args.root.resolve()),
        "images": entries,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print(f"wrote {len(entries)} images to {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
