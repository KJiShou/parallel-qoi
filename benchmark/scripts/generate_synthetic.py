"""Generate deterministic RGB/RGBA BMP stress images and a dataset manifest."""

from __future__ import annotations

import argparse
import json
import struct
from pathlib import Path


def pixel(pattern: str, x: int, y: int, width: int, height: int) -> tuple[int, int, int, int]:
    if pattern == "solid":
        return 42, 117, 73, 255
    if pattern == "palette":
        palette = ((0, 0, 0), (255, 255, 255), (40, 100, 180), (220, 90, 40), (80, 170, 70), (180, 70, 160))
        red, green, blue = palette[((x // 16) + (y // 16)) % len(palette)]
        return red, green, blue, 255
    if pattern == "gradient":
        return (x * 255 // max(1, width - 1), y * 255 // max(1, height - 1),
                (x + y) * 255 // max(1, width + height - 2), 255)
    if pattern == "transparent":
        return x * 255 // max(1, width - 1), 80, y * 255 // max(1, height - 1), (x ^ y) & 255
    value = (x * 0x1F123BB5 + y * 0x5F356495 + 0x9E3779B9) & 0xFFFFFFFF
    value ^= value >> 16
    return value & 255, (value >> 8) & 255, (value >> 16) & 255, 255


def write_bmp(path: Path, width: int, height: int, pattern: str) -> int:
    channels = 4 if pattern == "transparent" else 3
    row_bytes = width * channels
    stride = (row_bytes + 3) & ~3
    pixel_bytes = stride * height
    header = bytearray(54)
    header[:2] = b"BM"
    struct.pack_into("<I", header, 2, 54 + pixel_bytes)
    struct.pack_into("<I", header, 10, 54)
    struct.pack_into("<I", header, 14, 40)
    struct.pack_into("<iiHHII", header, 18, width, height, 1, channels * 8, 0, pixel_bytes)
    with path.open("wb") as output:
        output.write(header)
        padding = b"\0" * (stride - row_bytes)
        for y in range(height - 1, -1, -1):
            row = bytearray()
            for x in range(width):
                red, green, blue, alpha = pixel(pattern, x, y, width, height)
                row.extend((blue, green, red, alpha) if channels == 4 else (blue, green, red))
            output.write(row)
            output.write(padding)
    return channels


def parse_size(value: str) -> tuple[int, int]:
    width, height = value.lower().split("x", 1)
    return int(width), int(height)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--sizes", nargs="+", default=["512x512", "1920x1080", "3840x2160"])
    parser.add_argument("--include-8k", action="store_true")
    parser.add_argument("--stage", choices=("correctness", "tuning", "full"), default="tuning")
    args = parser.parse_args()
    sizes = [parse_size(value) for value in args.sizes]
    if args.include_8k and (7680, 4320) not in sizes:
        sizes.append((7680, 4320))
    args.output_dir.mkdir(parents=True, exist_ok=True)
    entries = []
    for width, height in sizes:
        for pattern in ("solid", "palette", "gradient", "noise", "transparent"):
            path = args.output_dir / f"{pattern}-{width}x{height}.bmp"
            channels = write_bmp(path, width, height, pattern)
            entries.append({"id": path.stem, "path": str(path.resolve()), "category": f"synthetic-{pattern}",
                            "channel_mode": "RGBA" if channels == 4 else "RGB", "stage": args.stage})
            print(f"wrote {path}")
    manifest = args.output_dir / "manifest.json"
    manifest.write_text(json.dumps({"name": "synthetic-stress", "images": entries}, indent=2), encoding="utf-8")
    print(f"wrote {manifest}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
