# Result format

`result.json` is the stable contract between C++, Electron and the benchmark
pipeline. It contains:

- input dimensions and RGB/RGBA channel mode;
- backend configuration;
- input decode (`load_ms`), CUDA initialization/allocation when applicable,
  Pass 1/summary, propagation, transfer, Pass 2/encode, prefix scan,
  compaction, core CUDA pipeline, merge, file write, validation and end-to-end
  timing;
- core pipeline timing (`core_pipeline_ms`) and its throughput, covering the
  native encode pipeline without load, write, validation or metrics analysis;
- output size, compression ratio and encode throughput;
- RUN, INDEX, DIFF, LUMA, RGB and RGBA chunk counts;
- inherited cross-block INDEX hits and fallback bytes avoided;
- official-decoder pixel-buffer and SHA-256 correctness flags.

The benchmark runner adds an `experiment` object to each artifact. It records
stage, image/category identifiers, warm-up status, measured-run index, source
digest, exact command, configuration and host metadata. The complete contract
is in `benchmark/schemas/benchmark-result.schema.json`.
