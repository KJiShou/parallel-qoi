"""Run reproducible QOI experiments from a dataset manifest and stage config."""

from __future__ import annotations

import argparse
import hashlib
import itertools
import json
import os
import platform
import shutil
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


EXECUTABLES = {
    "serial": "pqoi_serial",
    "one-pass": "pqoi_control",
    "control": "pqoi_control",
    "openmp": "pqoi_openmp",
    "cuda": "pqoi_cuda",
    "mpi": "pqoi_mpi",
}


def executable_name(name: str) -> str:
    return f"{name}.exe" if sys.platform == "win32" else name


def load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def safe_id(value: str) -> str:
    clean = "".join(character if character.isalnum() or character in "-_" else "-" for character in value)
    return clean.strip("-") or "item"


def image_id(path: Path) -> str:
    digest = hashlib.sha256(str(path.resolve()).encode("utf-8")).hexdigest()[:10]
    return f"{safe_id(path.stem)[:48]}-{digest}"


def load_images(args: argparse.Namespace) -> list[dict[str, Any]]:
    if args.manifest:
        manifest = load_json(args.manifest)
        base = args.manifest.parent
        entries = manifest.get("images", manifest) if isinstance(manifest, dict) else manifest
        images = []
        for entry in entries:
            raw_path = Path(entry["path"])
            path = raw_path if raw_path.is_absolute() else base / raw_path
            images.append({**entry, "path": path.resolve(), "id": entry.get("id", image_id(path))})
        return images
    if args.input:
        path = args.input.resolve()
        return [{"id": image_id(path), "path": path, "category": args.category, "stage": args.stage}]
    raise ValueError("provide --input or --manifest")


def block_values(workers: int, multipliers: list[int]) -> list[int]:
    return sorted({max(1, workers * multiplier) for multiplier in multipliers})


def build_configurations(config: dict[str, Any], stage: str) -> list[dict[str, Any]]:
    defaults = config.get("defaults", {})
    if stage in {"correctness", "full"}:
        selected = config.get("best_configurations", {})
        backends = config.get("stages", {}).get(stage, {}).get("backends", ["serial", "openmp", "cuda", "mpi"])
        return [{"backend": backend, **defaults, **selected.get(backend, {})} for backend in backends]

    grid = config.get("tuning_grid", {})
    multipliers = grid.get("block_multipliers", [1, 2, 4])
    configurations: list[dict[str, Any]] = [
        {"backend": "serial", **defaults, "threads": 1, "blocks": 1},
        {"backend": "control", **defaults},
    ]
    for threads in grid.get("openmp_threads", [1, 2, 4, 8, 16]):
        for blocks in block_values(threads, multipliers):
            configurations.append({"backend": "openmp", **defaults, "threads": threads, "blocks": blocks})
    for segment_length in grid.get("cuda_segment_lengths", [256, 512, 1024, 2048, 4096]):
        for multiplier in multipliers:
            configurations.append({"backend": "cuda", **defaults, "segment_length": segment_length,
                                   "blocks": multiplier})
    for processes in grid.get("mpi_processes", [1, 2, 4, 8]):
        for blocks in block_values(processes, multipliers):
            configurations.append({"backend": "mpi", **defaults, "processes": processes, "blocks": blocks})
    return configurations


def configuration_id(configuration: dict[str, Any]) -> str:
    backend = configuration["backend"]
    parts = [backend]
    relevant = {
        "serial": ("blocks",),
        "control": ("blocks",),
        "openmp": ("threads", "blocks"),
        "cuda": ("segment_length", "blocks"),
        "mpi": ("processes", "blocks"),
    }.get(backend, ("threads", "processes", "blocks", "segment_length"))
    for key in relevant:
        if key in configuration:
            parts.append(f"{key[:3]}-{configuration[key]}")
    return safe_id("_".join(parts))


def command_output(command: list[str]) -> str | None:
    try:
        completed = subprocess.run(command, check=False, capture_output=True, text=True, timeout=5)
    except (OSError, subprocess.TimeoutExpired):
        return None
    return completed.stdout.strip() or completed.stderr.strip() or None


def cmake_metadata(native_dir: Path) -> dict[str, str]:
    cache = native_dir.parent / "CMakeCache.txt"
    wanted = {"CMAKE_CXX_COMPILER", "CMAKE_CXX_FLAGS_RELEASE", "CMAKE_CUDA_COMPILER", "CMAKE_CUDA_ARCHITECTURES"}
    values: dict[str, str] = {}
    if cache.exists():
        for line in cache.read_text(encoding="utf-8", errors="replace").splitlines():
            if ":" in line and "=" in line:
                name = line.split(":", 1)[0]
                if name in wanted:
                    values[name.lower()] = line.split("=", 1)[1]
    return values


def system_metadata(native_dir: Path, args: argparse.Namespace) -> dict[str, Any]:
    return {
        "platform": platform.platform(),
        "machine": platform.machine(),
        "processor": platform.processor(),
        "python": platform.python_version(),
        "logical_cpu_count": os.cpu_count(),
        "native_directory": str(native_dir.resolve()),
        "recorded_utc": datetime.now(timezone.utc).isoformat(),
        "git_commit": command_output(["git", "rev-parse", "HEAD"]),
        "gpu": command_output(["nvidia-smi", "--query-gpu=name,driver_version", "--format=csv,noheader"]),
        "mpi_launcher": args.mpi_launcher,
        "node_mode": args.node_mode,
        "mpi_process_placement": args.mpi_placement,
        "compiler_optimization": args.compiler_optimization,
        "background_workload": args.background_workload,
        "cmake": cmake_metadata(native_dir),
    }


def build_command(executable: Path, image: Path, output: Path, result: Path, preview: Path,
                  configuration: dict[str, Any], mpi_launcher: str, generate_preview: bool) -> list[str]:
    backend = configuration["backend"]
    native_command = [
        str(executable), "--input", str(image), "--output", str(output),
        "--result", str(result),
        "--blocks", str(configuration.get("blocks", 1)),
        "--threads", str(configuration.get("threads", 1)),
        "--segment-length", str(configuration.get("segment_length", 1024)),
        "--validate",
    ]
    if generate_preview:
        native_command.extend(["--preview", str(preview)])
    else:
        native_command.append("--no-preview")
    if backend == "mpi":
        return [mpi_launcher, "-n", str(configuration.get("processes", 1)), *native_command]
    return native_command


def run_once(command: list[str], result_path: Path, metadata: dict[str, Any],
             transient_artifacts: tuple[Path, ...], retain_artifacts: bool) -> bool:
    wall_start = time.perf_counter()
    completed = subprocess.run(command, check=False, capture_output=True, text=True)
    wall_ms = (time.perf_counter() - wall_start) * 1000.0
    if result_path.exists():
        try:
            payload = load_json(result_path)
        except (json.JSONDecodeError, OSError) as error:
            payload = {"status": "error", "error": f"invalid result JSON: {error}"}
    else:
        payload = {"status": "error", "error": "native executable did not create result JSON"}
    payload["experiment"] = {**metadata, "process_wall_ms": wall_ms, "exit_code": completed.returncode,
                             "artifacts_retained": retain_artifacts}
    if completed.stdout.strip():
        payload["experiment"]["stdout_tail"] = completed.stdout[-2000:]
    if completed.stderr.strip():
        payload["experiment"]["stderr_tail"] = completed.stderr[-2000:]
    result_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    success = completed.returncode == 0 and payload.get("status") == "success" and payload.get("validation", {}).get("passed") is True
    if success and not retain_artifacts:
        for artifact in transient_artifacts:
            artifact.unlink(missing_ok=True)
    return success


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path)
    parser.add_argument("--manifest", type=Path)
    parser.add_argument("--config", type=Path, default=Path(__file__).parents[1] / "configs" / "evaluation.json")
    parser.add_argument("--stage", choices=("correctness", "tuning", "full"), default="tuning")
    parser.add_argument("--category", default="unclassified")
    parser.add_argument("--native-dir", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--mpi-launcher", default="mpiexec")
    parser.add_argument("--node-mode", choices=("single", "multi"), default="single")
    parser.add_argument("--mpi-placement", default="operating-system default")
    parser.add_argument("--compiler-optimization", default="Release (/O2 or toolchain equivalent)")
    parser.add_argument("--background-workload", default="normal desktop; benchmark backends run sequentially")
    parser.add_argument("--backends", nargs="+")
    parser.add_argument("--warmups", type=int)
    parser.add_argument("--runs", type=int)
    parser.add_argument("--resume", action="store_true", help="Skip already successful run artifacts")
    parser.add_argument("--retain-artifacts", action="store_true", help="Keep generated QOI and preview files")
    parser.add_argument("--quiet", action="store_true")
    args = parser.parse_args()

    config = load_json(args.config)
    args.native_dir = args.native_dir.resolve()
    args.output_dir = args.output_dir.resolve()
    images = [entry for entry in load_images(args) if args.stage in {entry.get("stage", args.stage), "full"}]
    configurations = build_configurations(config, args.stage)
    if args.backends:
        requested = {"control" if item == "one-pass" else item for item in args.backends}
        configurations = [item for item in configurations if item["backend"] in requested]
    warmups = args.warmups if args.warmups is not None else int(config.get("warmup_runs", 1))
    measured_runs = args.runs if args.runs is not None else int(config.get("measured_runs", 5))
    retain_artifacts = args.retain_artifacts or args.stage == "correctness"
    args.output_dir.mkdir(parents=True, exist_ok=True)
    machine = system_metadata(args.native_dir, args)
    failures = 0
    source_hashes: dict[str, str] = {}

    for entry, configuration in itertools.product(images, configurations):
        image = Path(entry["path"])
        backend = configuration["backend"]
        executable = args.native_dir / executable_name(EXECUTABLES[backend])
        if not image.exists():
            print(f"missing image: {image}")
            failures += 1
            continue
        if not executable.exists():
            print(f"skip {backend}: {executable} does not exist")
            continue
        if backend == "mpi" and shutil.which(args.mpi_launcher) is None:
            print(f"skip mpi: launcher {args.mpi_launcher!r} not found")
            continue

        config_id = configuration_id(configuration)
        run_dir = args.output_dir / args.stage / str(entry["id"]) / config_id
        run_dir.mkdir(parents=True, exist_ok=True)
        source_key = str(entry["id"])
        if source_key not in source_hashes:
            source_hashes[source_key] = hashlib.sha256(image.read_bytes()).hexdigest()
        source_sha256 = source_hashes[source_key]
        total_runs = warmups + measured_runs
        for sequence in range(total_runs):
            is_warmup = sequence < warmups
            measured_index = sequence - warmups + 1
            run_label = f"warmup-{sequence + 1:02d}" if is_warmup else f"run-{measured_index:02d}"
            output = run_dir / f"{run_label}.qoi"
            result = run_dir / f"{run_label}.json"
            preview = run_dir / f"{run_label}.bmp"
            command = build_command(executable, image, output, result, preview, configuration, args.mpi_launcher,
                                    retain_artifacts)
            metadata = {
                "stage": args.stage,
                "image_id": entry["id"],
                "category": entry.get("category", "unclassified"),
                "channel_mode": entry.get("channel_mode", "unknown"),
                "configuration_id": config_id,
                "configuration": configuration,
                "is_warmup": is_warmup,
                "measured_run": None if is_warmup else measured_index,
                "planned_measured_runs": measured_runs,
                "input_sha256": source_sha256,
                "system": machine,
                "command": command,
            }
            if args.resume and result.exists():
                try:
                    existing = load_json(result)
                except (json.JSONDecodeError, OSError):
                    existing = {}
                if existing.get("status") == "success" and existing.get("validation", {}).get("passed") is True:
                    if not args.quiet: print(f"skip [{entry['id']}] {config_id} {run_label}")
                    continue
            if not args.quiet: print(f"[{entry['id']}] {config_id} {run_label}")
            if not run_once(command, result, metadata, (output, preview), retain_artifacts):
                failures += 1

    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
