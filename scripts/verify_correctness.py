#!/usr/bin/env python3
"""Run identical cases through available wildfire backends and compare results."""
from __future__ import annotations
import argparse, json, subprocess, sys
from pathlib import Path


def parse_output(text: str) -> dict[str, str]:
    result = {}
    for line in text.splitlines():
        if ": " in line:
            key, value = line.split(": ", 1)
            if key in {"Burned cells", "Checksum"}:
                result[key] = value.strip()
    return result


def run(command: list[str], cwd: Path) -> dict[str, str]:
    proc = subprocess.run(command, cwd=cwd, text=True, capture_output=True)
    if proc.returncode:
        raise RuntimeError(f"FAILED: {' '.join(command)}\n{proc.stdout}\n{proc.stderr}")
    return parse_output(proc.stdout)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--build-dir", default="build_verified/Release")
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    build = (root / args.build_dir).resolve()
    common = ["--rows", "65", "--cols", "64", "--steps", "20", "--density", "0.7", "--seed", "42", "--repetitions", "1"]
    cases = {
        "serial": [str(build / "wildfire_serial.exe"), *common],
        "openmp": [str(build / "wildfire_openmp.exe"), *common, "--threads", "4"],
        "cuda": [str(build / "wildfire_cuda.exe"), *common, "--block-size", "128"],
        "mpi": ["mpiexec", "-n", "4", str(build / "wildfire_mpi.exe"), *common],
    }
    outputs = {}
    for name, command in cases.items():
        outputs[name] = run(command, root)
    oracle = outputs["serial"]
    failed = False
    for name, result in outputs.items():
        ok = result.get("Burned cells") == oracle.get("Burned cells") and result.get("Checksum") == oracle.get("Checksum")
        print(f"{'PASS' if ok else 'FAIL'} {name}: burned={result.get('Burned cells')} checksum={result.get('Checksum')}")
        failed |= not ok
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
