"""Download and safely extract the official QOI conformance/benchmark archives."""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import tarfile
import urllib.request
import zipfile
from pathlib import Path


DATASETS = {
    "conformance": {
        "url": "https://qoiformat.org/qoi_test_images.zip",
        "archive": "qoi_test_images.zip",
        "directory": "conformance",
    },
    "benchmark": {
        "url": "https://qoiformat.org/benchmark/qoi_benchmark_suite.tar",
        "archive": "qoi_benchmark_suite.tar",
        "directory": "benchmark-suite",
    },
}


def download(url: str, destination: Path) -> str:
    partial = destination.with_suffix(destination.suffix + ".part")
    digest = hashlib.sha256()
    with urllib.request.urlopen(url) as response, partial.open("wb") as output:
        while chunk := response.read(1024 * 1024):
            output.write(chunk)
            digest.update(chunk)
    partial.replace(destination)
    return digest.hexdigest()


def safe_target(root: Path, member: str) -> Path:
    target = (root / member).resolve()
    if root.resolve() not in target.parents and target != root.resolve():
        raise ValueError(f"archive member escapes destination: {member}")
    return target


def extract(archive: Path, destination: Path) -> None:
    destination.mkdir(parents=True, exist_ok=True)
    if archive.suffix == ".zip":
        with zipfile.ZipFile(archive) as package:
            for member in package.infolist():
                safe_target(destination, member.filename)
            package.extractall(destination)
    else:
        with tarfile.open(archive) as package:
            for member in package.getmembers():
                safe_target(destination, member.name)
                if not (member.isfile() or member.isdir()):
                    raise ValueError(f"unsupported archive member type: {member.name}")
            package.extractall(destination)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset", choices=("conformance", "benchmark", "all"), default="conformance")
    parser.add_argument("--data-dir", type=Path, default=Path(__file__).parents[2] / "data")
    parser.add_argument("--keep-archive", action="store_true")
    args = parser.parse_args()
    names = DATASETS if args.dataset == "all" else {args.dataset: DATASETS[args.dataset]}
    records = []
    args.data_dir.mkdir(parents=True, exist_ok=True)
    for name, definition in names.items():
        archive = args.data_dir / definition["archive"]
        print(f"downloading {name} from {definition['url']}")
        sha256 = download(definition["url"], archive)
        destination = args.data_dir / definition["directory"]
        extract(archive, destination)
        records.append({"dataset": name, "url": definition["url"], "sha256": sha256,
                        "destination": str(destination.resolve())})
        if not args.keep_archive:
            archive.unlink()
    record_path = args.data_dir / "official-dataset-downloads.json"
    record_path.write_text(json.dumps(records, indent=2), encoding="utf-8")
    print(f"wrote provenance record to {record_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
