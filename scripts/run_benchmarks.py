#!/usr/bin/env python3
"""Small reproducible benchmark driver for report-ready JSON summaries."""
from __future__ import annotations
import argparse, csv, json, statistics, subprocess
from pathlib import Path


def run(command: list[str], cwd: Path, output: Path, repetitions: int) -> dict:
    output.parent.mkdir(parents=True, exist_ok=True)
    cmd = [*command, "--output", str(output), "--repetitions", str(repetitions), "--warmup", "1"]
    proc = subprocess.run(cmd, cwd=cwd, text=True, capture_output=True)
    if proc.returncode:
        raise RuntimeError(proc.stdout + "\n" + proc.stderr)
    return json.loads(output.read_text())


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--build-dir", default="build_verified/Release")
    parser.add_argument("--profile", choices=["smoke", "report", "assignment"], default="smoke")
    parser.add_argument("--steps", type=int, default=None)
    parser.add_argument("--repetitions", type=int, default=3)
    parser.add_argument("--threads", type=int, default=4)
    parser.add_argument("--processes", type=int, default=4)
    parser.add_argument("--block-size", type=int, default=256)
    parser.add_argument("--output-dir", default="results/generated")
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    build = (root / args.build_dir).resolve()
    out_dir = root / args.output_dir
    sizes = [(128, 128), (256, 256)] if args.profile == "smoke" else [(500, 500), (1000, 1000), (2000, 2000)] if args.profile == "report" else [(500, 500), (1000, 1000), (2000, 2000), (4000, 4000)]
    steps = args.steps if args.steps is not None else (100 if args.profile in {"report", "assignment"} else 100)
    repetitions = args.repetitions
    records = []
    for rows, cols in sizes:
        base = ["--rows", str(rows), "--cols", str(cols), "--steps", str(steps), "--density", "0.7", "--seed", "42"]
        configs = [
            ("serial", [str(build / "wildfire_serial.exe"), *base], 1, 0),
            ("openmp", [str(build / "wildfire_openmp.exe"), *base, "--threads", str(args.threads)], args.threads, 0),
            ("cuda", [str(build / "wildfire_cuda.exe"), *base, "--block-size", str(args.block_size)], 1, args.block_size),
            ("mpi", ["mpiexec", "-n", str(args.processes), str(build / "wildfire_mpi.exe"), *base], args.processes, 0),
        ]
        for backend, command, workers, block_size in configs:
            path = out_dir / f"{backend}_{rows}x{cols}.json"
            data = run(command, root, path, repetitions)
            record = {"backend": backend, "rows": rows, "cols": cols, "workers": workers, "blockSize": block_size,
                      "runtimeMs": data["runtimeMs"], "burnedCells": data["burnedCells"], "checksum": data["checksum"]}
            records.append(record)
    serial = {(r["rows"], r["cols"]): r["runtimeMs"]["median"] for r in records if r["backend"] == "serial"}
    for record in records:
        baseline = serial[(record["rows"], record["cols"])]
        record["speedup"] = baseline / record["runtimeMs"]["median"]
        record["efficiency"] = record["speedup"] / record["workers"] if record["backend"] in {"openmp", "mpi"} else None
    (out_dir / "benchmarks.json").write_text(json.dumps(records, indent=2))
    with (out_dir / "benchmarks.csv").open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=["backend", "rows", "cols", "workers", "blockSize", "medianMs", "speedup", "efficiency", "burnedCells", "checksum"])
        writer.writeheader()
        for r in records:
            writer.writerow({"backend": r["backend"], "rows": r["rows"], "cols": r["cols"], "workers": r["workers"], "blockSize": r["blockSize"], "medianMs": r["runtimeMs"]["median"], "speedup": r["speedup"], "efficiency": r["efficiency"], "burnedCells": r["burnedCells"], "checksum": r["checksum"]})
    print(f"Wrote {len(records)} records to {out_dir}")


if __name__ == "__main__":
    main()
