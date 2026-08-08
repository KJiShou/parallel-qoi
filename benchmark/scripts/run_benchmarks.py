"""Run one image through available native backends and keep JSON artifacts."""

from __future__ import annotations

import argparse
import json
import subprocess
from pathlib import Path


def executable_name(name: str) -> str:
    return f"{name}.exe" if __import__("sys").platform == "win32" else name


EXECUTABLES = {"serial": "pqoi_serial", "one-pass": "pqoi_control", "control": "pqoi_control",
               "openmp": "pqoi_openmp", "cuda": "pqoi_cuda", "mpi": "pqoi_mpi"}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--native-dir", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--backends", nargs="+", default=["serial", "control", "openmp"])
    parser.add_argument("--blocks", type=int, default=8)
    parser.add_argument("--threads", type=int, default=4)
    args = parser.parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)

    for backend in args.backends:
        executable = args.native_dir / executable_name(EXECUTABLES.get(backend, f"pqoi_{backend}"))
        if not executable.exists():
            print(f"skip {backend}: {executable} does not exist")
            continue
        stem = f"{args.input.stem}-{backend}"
        output = args.output_dir / f"{stem}.qoi"
        result = args.output_dir / f"{stem}.json"
        preview = args.output_dir / f"{stem}.bmp"
        command = [str(executable), "--input", str(args.input), "--output", str(output),
                   "--result", str(result), "--preview", str(preview), "--blocks", str(args.blocks),
                   "--threads", str(args.threads), "--validate"]
        completed = subprocess.run(command, check=False)
        if not result.exists():
            (args.output_dir / f"{stem}.error.json").write_text(
                json.dumps({"status": "error", "backend": backend, "exit_code": completed.returncode}, indent=2),
                encoding="utf-8",
            )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
