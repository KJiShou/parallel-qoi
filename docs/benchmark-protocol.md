# Benchmark protocol

The automated protocol follows the three-stage evaluation plan in Chapter 5.

## Dataset stages

1. **Correctness:** run Serial, OpenMP, CUDA and MPI over the official QOI
   conformance archive plus RGB/RGBA, transparency, small-image and block-boundary cases.
2. **Tuning:** use the published deterministic 154-image stratified manifest to
   sweep OpenMP threads/image partitions,
   CUDA pixels per segment and CUDA threads per block, and MPI
   processes/image partitions.
3. **Full:** run Serial, one-pass control and the selected best OpenMP, CUDA and
   MPI configurations over every image in the downloaded archive (2,848 images
   in the current official suite; the fetcher records the exact archive hash).

`create_manifest.py` sorts every category by relative filename and selects the
midpoint of each equal-width interval. This makes the subset deterministic and
avoids selecting favourable files manually. The generated manifest is the
published record of selected filenames.

## Repetition and timing

Every image/configuration performs one unreported warm-up followed by five
measured runs. Aggregation uses per-image median encode time as the primary
statistic and retains mean and sample standard deviation. Backends run
sequentially. `encode_ms` excludes input decode, output writing and validation;
`write_ms` is reported separately. `total_ms` is native end-to-end conversion
latency and excludes Electron, result JSON writing and the separately reported
`metrics_analysis_ms` pass used to collect chunk/state research counters.

`load_ms` measures native input decode. `cuda_init_ms` and `allocation_ms` are
CUDA-only setup phases and are zero for the other backends. Summary corresponds
to Pass 1, propagation is state propagation, and encode is Pass 2. OpenMP uses
the configured worker count with static scheduling for both Pass 1 and Pass 2;
its ordered state propagation remains sequential. For CUDA, `summary_ms`
measures the GPU summary kernel, while `propagation_ms` measures the device
exclusive summary scan and entry-state kernel. `prefix_scan_ms` measures the
encoded-length scan, `compaction_ms` measures device output compaction, and
`merge_ms` measures final host QOI assembly. `core_pipeline_ms` covers transfers,
summary, propagation, encoding, scan and compaction. CUDA reports both pixels per
segment, CUDA threads per block and the derived image partition count. For MPI,
`summary_ms` includes the maximum rank-local summary time plus the summary
gather to rank 0; `transfer_in_ms` includes pixel and propagated-state scatter.
CUDA host/device transfers and the final MPI encoded-payload gather are reported
as transfer in/out. `prefix_scan_ms` remains zero unless a backend actually
performs a separately timed prefix scan; no value is inferred or fabricated.

## Derived metrics

`aggregate_results.py` produces per-run, per-image, category and full-suite CSV
files. It calculates speedup, CPU/MPI efficiency, compression ratio, output-size
overhead, chunk distribution, cross-block counters, suite throughput and total
encoded size. CUDA efficiency is intentionally blank because CPU thread/process
efficiency is not a meaningful GPU occupancy metric.

## Reproducibility

Each measured JSON is enriched with the exact argument array, source SHA-256,
configuration, stage, category, run index, host platform, processor, logical CPU
count, Python version, native binary directory and single-node declaration.
Compiler flags, GPU model/driver, MPI process placement and background workload
must additionally be recorded in the experiment report because they cannot be
reliably inferred by a portable runner.

Example:

```powershell
python benchmark/scripts/fetch_official_datasets.py --dataset conformance

python benchmark/scripts/create_manifest.py --root data/benchmark-suite/images `
  --stage tuning --per-category 20 --output benchmark/manifests/tuning.json

python benchmark/scripts/run_benchmarks.py `
  --manifest benchmark/manifests/tuning.json --stage tuning `
  --native-dir build-full/Release --output-dir results/evaluation

python benchmark/scripts/aggregate_results.py `
  --input-dir results/evaluation --output results/per-run.csv
```

The official sources are `https://qoiformat.org/qoi_test_images.zip` and
`https://qoiformat.org/benchmark/qoi_benchmark_suite.tar`. The fetcher records
the downloaded SHA-256 and source URL but does not commit either dataset.

Controlled solid-colour, limited-palette, gradient, deterministic noise and
transparent RGB/RGBA BMP inputs can be generated with:

```powershell
python benchmark/scripts/generate_synthetic.py --output-dir data/synthetic
```

Add `--include-8k` only when memory, storage and GPU capacity permit.
