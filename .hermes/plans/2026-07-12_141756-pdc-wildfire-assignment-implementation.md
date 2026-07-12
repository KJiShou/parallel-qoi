# PDC Wildfire Assignment Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Turn the existing Serial/OpenMP/CUDA/MPI methodology prototypes into a complete, reproducible BMCS2103 Part B submission with configurable executables, correctness validation, automated benchmarks, visualization outputs, an Electron dashboard, report-ready evidence, and a reliable demonstration workflow.

**Architecture:** Keep one deterministic cellular-automata model and one common configuration/output contract across four independent backends: Serial CPU, OpenMP, CUDA, and MPI. The C++ executables produce machine-readable benchmark summaries and selected small-grid frames; Python scripts validate outputs and automate experiments; the Electron + React dashboard only reads precomputed data and never contributes to measured compute time.

**Tech Stack:** C++17, CMake, OpenMP, CUDA, MS-MPI, Python 3, Electron, React, TypeScript, HTML Canvas `ImageData`, Chart.js or ECharts, JSON/CSV.

---

## 1. Current Context and Scope

### Existing repository

Repository: `D:\JiShou\D-Y3S1\pdc-wildfire-methods`

Already available and verified as methodology prototypes:

- `wildfire_common.hpp` — deterministic four-state cellular automata, fixed-seed grid generation, checksum, burned-cell count.
- `serial_wildfire.cpp` — serial baseline.
- `openmp_wildfire.cpp` — row-loop parallelism with `schedule(static)`.
- `cuda_wildfire.cu` — one CUDA thread per cell.
- `mpi_wildfire.cpp` — equal row partitioning and ghost-row exchange with `MPI_Sendrecv`.
- `CMakeLists.txt` — Visual Studio, CUDA architecture 89, OpenMP, and MS-MPI fallback.
- All four prototype backends previously produced the same burned count and checksum for the 512×512, 200-step default case.

### Assignment-aligned deliverables

The implementation must produce:

1. Serial, OpenMP, CUDA, and MPI executables using identical deterministic rules.
2. Several non-trivial benchmark cases.
3. Runtime, speedup, efficiency, and scalability evidence.
4. Correctness evidence using checksum, burned count, and selected-frame comparison.
5. At least one documented optimization experiment per relevant parallel model.
6. Visually clear output through an Electron desktop dashboard.
7. Source code, build/run instructions, final report evidence, and a stable demo.

### Required versus optional

**Required/committed scope:**

- Four backends under one common input/output contract.
- Deterministic Moore-neighbourhood model and double buffering.
- CLI parameters and input validation.
- JSON/CSV summaries and selected visualization frames.
- Automated correctness and benchmark scripts.
- OpenMP thread scaling, MPI process scaling, CUDA block-size comparison.
- Electron dashboard loading precomputed data.
- Report-ready tables, charts, screenshots, and discussion notes.

**Optional only after the required scope is stable:**

- Dashboard buttons that launch local executables.
- Wind, stochastic ignition, terrain, image-based maps, firebreaks, or firefighting.
- Multi-node MPI testing.
- Full-frame storage for large benchmark grids.

Do not add optional wildfire realism before correctness, benchmarking, dashboard, and report evidence are complete.

---

## 2. Target Repository Structure

```text
pdc-wildfire-methods/
  CMakeLists.txt
  README.md
  engine/
    include/
      wildfire_types.hpp
      wildfire_config.hpp
      wildfire_rules.hpp
      wildfire_output.hpp
      wildfire_cli.hpp
    src/
      common/
        wildfire_config.cpp
        wildfire_output.cpp
        wildfire_cli.cpp
      serial/
        main_serial.cpp
      openmp/
        main_openmp.cpp
      cuda/
        main_cuda.cu
      mpi/
        main_mpi.cpp
  scripts/
    verify_correctness.py
    run_benchmarks.py
    prepare_dashboard_data.py
  tests/
    test_rules.cpp
    test_cli.py
    test_output_contract.py
    fixtures/
      small_cases.json
  results/
    .gitkeep
  dashboard/
    package.json
    electron/
      main.ts
      preload.ts
    src/
      App.tsx
      types.ts
      data.ts
      components/
        SimulationCanvas.tsx
        PlaybackControls.tsx
        BackendSelector.tsx
        StatsPanel.tsx
        PerformanceCharts.tsx
        ResultTable.tsx
    public/
      data/
        .gitkeep
```

Keep generated builds, full benchmark outputs, and large frame files out of Git. Commit only compact representative fixtures or sample data needed for the dashboard/demo.

---

## 3. Data and Command Contracts

### Common CLI contract

All non-MPI executables should accept:

```text
--rows <int>
--cols <int>
--steps <int>
--density <0.0-1.0>
--seed <uint>
--ignition-row <int>
--ignition-col <int>
--output <path-to-summary-json>
--frames <path-to-frames-json>       optional
--frame-interval <positive-int>      optional
--warmup <non-negative-int>          benchmark mode
--repetitions <positive-int>         benchmark mode
```

Backend-specific flags:

```text
OpenMP: --threads <int>
CUDA:   --block-size <128|256|512>
MPI:    process count comes from mpiexec -n N
```

MPI uses the same simulation flags after the executable name:

```bash
mpiexec -n 4 ./wildfire_mpi.exe --rows 1000 --cols 1000 --steps 500 ...
```

### Summary JSON contract

```json
{
  "schemaVersion": 1,
  "backend": "openmp",
  "rows": 1000,
  "cols": 1000,
  "steps": 500,
  "treeDensity": 0.7,
  "seed": 42,
  "ignition": { "row": 500, "col": 500 },
  "workers": 8,
  "blockSize": null,
  "repetitions": 5,
  "runtimeMs": {
    "samples": [100.0, 99.2, 101.1, 98.9, 100.4],
    "median": 100.0,
    "mean": 99.92,
    "stddev": 0.85
  },
  "burnedCells": 0,
  "burnedPercentage": 0.0,
  "checksum": "unsigned-64-bit-as-string"
}
```

### Visualization JSON contract

Use only small grids (initially 100×100 or 200×200) and selected frames:

```json
{
  "schemaVersion": 1,
  "backend": "serial",
  "rows": 200,
  "cols": 200,
  "steps": 300,
  "frameInterval": 5,
  "frames": [
    {
      "step": 0,
      "activeBurningCells": 1,
      "burnedCells": 0,
      "burnedPercentage": 0.0,
      "cells": [0, 1, 1, 2]
    }
  ]
}
```

The initial frame, each selected interval, and the final frame must be present. Large benchmark grids must not emit frame arrays.

---

## 4. Step-by-Step Implementation Plan

### Task 1: Preserve the prototype baseline and establish quality gates

**Objective:** Record the known-good prototype behavior before restructuring so later changes can be compared against it.

**Files:**

- Create: `tests/fixtures/prototype_baseline.json`
- Modify: `.gitignore`
- Modify: `README.md`

**Steps:**

1. Build the current four prototypes using the documented Visual Studio/CUDA/MS-MPI setup.
2. Run the fixed case `512×512`, `200` steps, density `0.70`, seed `42`, centre ignition.
3. Record runtime separately but store the expected correctness values in `tests/fixtures/prototype_baseline.json`:
   - burned cells: `106721`;
   - checksum: `5934029897580874713`.
4. Add ignore rules for `build*/`, `results/generated/`, dashboard dependencies, dashboard distribution output, and temporary logs.
5. Document the tool prerequisites and exact build command in `README.md`.
6. Commit:

```bash
git add .gitignore README.md tests/fixtures/prototype_baseline.json
git commit -m "test: preserve verified wildfire baseline"
```

**Validation:** All four current executables still match the fixture before any restructuring starts.

---

### Task 2: Extract the common model into testable engine modules

**Objective:** Remove duplicated setup/output logic while keeping one authoritative state model and initialization routine.

**Files:**

- Create: `engine/include/wildfire_types.hpp`
- Create: `engine/include/wildfire_config.hpp`
- Create: `engine/include/wildfire_rules.hpp`
- Create: `engine/src/common/wildfire_config.cpp`
- Create: `tests/test_rules.cpp`
- Modify: `CMakeLists.txt`
- Retire after migration: `wildfire_common.hpp`

**Steps:**

1. Add `CellState` and `SimulationConfig` with explicit integer types and defaults.
2. Move deterministic `index2D`, grid generation, Moore-neighbour update, burned count, burning count, burned percentage, and checksum into shared headers/sources.
3. Represent the checksum as `std::uint64_t`; serialize it as a decimal string to avoid JavaScript integer precision loss.
4. Add C++ tests for the four validated small-grid cases:
   - centre fire spreads to eight tree neighbours;
   - burned remains burned;
   - empty remains empty;
   - boundaries do not read out of range.
5. Add tests proving identical initial grids for the same seed and different grids for different seeds.
6. Add CTest integration.
7. Run:

```bash
cmake -S . -B build_verified -G "Visual Studio 17 2022" -A x64
cmake --build build_verified --config Release
ctest --test-dir build_verified -C Release --output-on-failure
```

8. Commit:

```bash
git add CMakeLists.txt engine tests
git commit -m "refactor: extract common wildfire model"
```

**Expected:** Rule and determinism tests pass without invoking any parallel backend.

---

### Task 3: Add shared CLI parsing and strict configuration validation

**Objective:** Make every backend runnable with identical explicit experimental parameters instead of hard-coded values.

**Files:**

- Create: `engine/include/wildfire_cli.hpp`
- Create: `engine/src/common/wildfire_cli.cpp`
- Create: `tests/test_cli.py`
- Modify: `CMakeLists.txt`

**Steps:**

1. Implement the common flags defined in Section 3.
2. Validate positive dimensions/steps/repetitions, density in `[0,1]`, ignition coordinates inside the grid, positive frame interval, valid thread count, and valid CUDA block size.
3. Add `--help` and return non-zero with a clear message for invalid input.
4. Ensure MPI parses on rank 0 and broadcasts the validated configuration, or deterministically parses identical arguments on all ranks and aborts collectively on failure.
5. Add CLI smoke tests for valid defaults, custom values, missing values, invalid density, invalid coordinates, and unknown flags.
6. Commit:

```bash
git add engine tests CMakeLists.txt
git commit -m "feat: add common simulation CLI"
```

**Validation:** The same argument set is accepted by all four executables, while invalid arguments fail before computation.

---

### Task 4: Implement machine-readable summaries and frame output

**Objective:** Create one reliable output contract for validation scripts, benchmarks, and the dashboard.

**Files:**

- Create: `engine/include/wildfire_output.hpp`
- Create: `engine/src/common/wildfire_output.cpp`
- Create: `tests/test_output_contract.py`
- Modify: `CMakeLists.txt`

**Steps:**

1. Implement JSON summary writing and selected-frame writing without placing dashboard rendering time inside backend timing.
2. Include schema version, full configuration, backend identity, worker/block metadata, timing samples/statistics, burned count/percentage, and checksum.
3. Save initial and final frames even if they do not align with `frameInterval`.
4. Create parent output directories when safe; report file errors clearly.
5. Validate generated JSON using Python's standard `json` module and assert required keys/types.
6. Add a protection that rejects or disables frame generation for grids above the agreed visualization limit unless explicitly overridden.
7. Commit:

```bash
git add engine tests CMakeLists.txt
git commit -m "feat: add simulation result contracts"
```

**Validation:** A 10×10 smoke run produces parseable summary/frame JSON and the checksum remains exact when read by Python and TypeScript as a string.

---

### Task 5: Migrate and validate the Serial baseline

**Objective:** Establish the authoritative implementation and timing semantics used for all speedup calculations.

**Files:**

- Create: `engine/src/serial/main_serial.cpp`
- Modify: `CMakeLists.txt`
- Remove after successful migration: `serial_wildfire.cpp`

**Steps:**

1. Migrate serial double buffering to the common modules.
2. Add warmup/repetition handling; use the median runtime as the primary benchmark value.
3. Exclude argument parsing, initial-grid generation, file output, and dashboard work from compute timing.
4. Generate frames only in a separate visualization run or outside the timed repeated loop.
5. Compare the migrated result against `prototype_baseline.json`.
6. Run small, default, and at least one non-square grid test.
7. Commit:

```bash
git add engine/src/serial CMakeLists.txt
git rm serial_wildfire.cpp
git commit -m "feat: productionize serial wildfire backend"
```

**Validation:** The 512×512 baseline still returns burned cells `106721` and checksum `5934029897580874713`.

---

### Task 6: Migrate and evaluate the OpenMP backend

**Objective:** Provide configurable shared-memory parallelism and thread-scaling evidence.

**Files:**

- Create: `engine/src/openmp/main_openmp.cpp`
- Modify: `CMakeLists.txt`
- Remove after successful migration: `openmp_wildfire.cpp`

**Steps:**

1. Use the common configuration, grid, rules, and output modules.
2. Apply `omp_set_num_threads` from `--threads`; report actual maximum/selected thread count.
3. Keep `#pragma omp parallel for schedule(static)` and the implicit barrier before buffer swap.
4. Compare 1, 2, 4, 8, and hardware-supported higher thread counts.
5. Add one optimization experiment comparing at minimum:
   - serial baseline;
   - OpenMP 1 thread;
   - OpenMP 2/4/8 threads;
   - optionally static versus dynamic scheduling to demonstrate why static is retained.
6. Verify every run against the serial checksum and burned count.
7. Commit:

```bash
git add engine/src/openmp CMakeLists.txt
git rm openmp_wildfire.cpp
git commit -m "feat: add configurable OpenMP backend"
```

**Validation:** Correctness matches Serial for every tested thread count; benchmark data can show speedup and efficiency.

---

### Task 7: Migrate, time, and optimize the CUDA backend

**Objective:** Produce a configurable GPU implementation with defensible timing and block-size comparison.

**Files:**

- Create: `engine/src/cuda/main_cuda.cu`
- Modify: `CMakeLists.txt`
- Remove after successful migration: `cuda_wildfire.cu`

**Steps:**

1. Migrate the one-thread-per-cell kernel and separate device buffers.
2. Accept block sizes 128, 256, and 512 from the CLI.
3. Add CUDA error checks after allocations, copies, launches, synchronization, and frees.
4. Record two timing views:
   - kernel/simulation time using CUDA events;
   - optional end-to-end backend time including host-device transfer.
5. Do not call `cudaDeviceSynchronize()` after every step unless needed for debugging; rely on same-stream launch ordering and synchronize at the timing boundary. This is the first CUDA optimization to evaluate.
6. Compare block sizes 128/256/512 on multiple grid sizes.
7. Validate the final copied grid against Serial for each block size.
8. Keep architecture 89 as the machine default but document `-DCMAKE_CUDA_ARCHITECTURES=<value>` for other GPUs.
9. Commit:

```bash
git add engine/src/cuda CMakeLists.txt
git rm cuda_wildfire.cu
git commit -m "feat: add benchmarkable CUDA backend"
```

**Validation:** CUDA matches Serial and produces separate kernel and end-to-end timing fields without timing dashboard work.

---

### Task 8: Generalize and validate the MPI backend

**Objective:** Support distributed-memory execution safely for both evenly and unevenly divisible row counts.

**Files:**

- Create: `engine/src/mpi/main_mpi.cpp`
- Modify: `CMakeLists.txt`
- Remove after successful migration: `mpi_wildfire.cpp`

**Steps:**

1. Migrate row partitioning, two ghost rows, double buffering, and `MPI_Sendrecv` halo exchange.
2. Replace the current `rows % worldSize == 0` restriction with row counts/displacements and `MPI_Scatterv`/`MPI_Gatherv`.
3. Broadcast configuration from rank 0 and ensure all failures terminate collectively.
4. Use `MPI_Barrier` immediately before timing and `MPI_Reduce(..., MPI_MAX, ...)` so reported runtime is the slowest rank, not only rank 0.
5. Keep output writing on rank 0 only.
6. Test process counts 1, 2, 4, and 8 where supported, including at least one row count not divisible by process count.
7. Compare correctness against Serial for each process count.
8. Record MPI communication/scaling evidence and calculate efficiency from process count.
9. Commit:

```bash
git add engine/src/mpi CMakeLists.txt
git rm mpi_wildfire.cpp
git commit -m "feat: generalize MPI wildfire backend"
```

**Validation:** MPI matches Serial for even and uneven partitions; no rank writes duplicate output files.

---

### Task 9: Build an automated cross-backend correctness gate

**Objective:** Prevent benchmark/report work from continuing when any implementation disagrees with the serial model.

**Files:**

- Create: `scripts/verify_correctness.py`
- Create: `tests/fixtures/correctness_matrix.json`
- Modify: `README.md`

**Steps:**

1. Define a compact correctness matrix including:
   - 2×2 boundary case;
   - 10×10 deterministic case;
   - non-square case;
   - uneven MPI row partition case;
   - 512×512 prototype baseline.
2. Run Serial first and use its output as the oracle except where a fixed fixture already exists.
3. Run OpenMP across selected threads, CUDA across all block sizes, and MPI across selected process counts.
4. Compare burned count, burned percentage tolerance, checksum, and selected-frame checksums.
5. Print a concise PASS/FAIL table and return non-zero on any mismatch.
6. Add the command to `README.md`:

```bash
python scripts/verify_correctness.py --build-dir build_verified/Release
```

7. Commit:

```bash
git add scripts tests README.md
git commit -m "test: add cross-backend correctness gate"
```

**Validation:** The script reports all tested backend/configuration combinations as PASS and exits `0`.

---

### Task 10: Automate reproducible benchmarks and derived metrics

**Objective:** Generate report-ready raw data without manually copying terminal output.

**Files:**

- Create: `scripts/run_benchmarks.py`
- Create: `results/.gitkeep`
- Modify: `README.md`

**Steps:**

1. Define two benchmark profiles:
   - `smoke`: small cases for script verification;
   - `report`: 500², 1000², 2000², and hardware-safe 4000² cases, with selected steps rather than an uncontrolled full Cartesian product.
2. Use fixed seed/density/ignition across backends.
3. Use one warmup and at least five measured repetitions when runtime permits; record every sample, median, mean, and standard deviation.
4. Run:
   - Serial once per problem size;
   - OpenMP at 1/2/4/8/(supported maximum) threads;
   - CUDA at 128/256/512 block sizes;
   - MPI at 1/2/4/8 processes where supported.
5. Calculate:
   - `speedup = serial median / parallel median`;
   - `efficiency = speedup / workers` for OpenMP and MPI only;
   - checksum-match status.
6. Write raw JSON files plus consolidated `results/generated/benchmarks.csv` and `benchmarks.json`.
7. Preserve failed-run stderr and mark failures; never silently invent missing values.
8. Commit the script and empty results directory, not machine-specific full benchmark output unless the team intentionally selects a compact final evidence set.
9. Commit:

```bash
git add scripts/run_benchmarks.py results/.gitkeep README.md
git commit -m "feat: automate wildfire benchmarks"
```

**Validation:** `--profile smoke` completes end to end, produces valid CSV/JSON, and all rows have correctness status.

---

### Task 11: Generate compact dashboard/demo datasets

**Objective:** Separate visualization-scale output from benchmark-scale output and prepare stable static data for the UI.

**Files:**

- Create: `scripts/prepare_dashboard_data.py`
- Create: `dashboard/public/data/.gitkeep`
- Modify: `README.md`

**Steps:**

1. Generate one canonical visualization scenario at 200×200, 300 steps, fixed seed/density, selected frames every 5 steps.
2. Use the serial frames as the canonical animation unless backend-specific frames are needed to demonstrate checksum equivalence; avoid duplicating identical grids unnecessarily.
3. Copy the consolidated benchmark JSON and compact frame JSON to `dashboard/public/data/`.
4. Add a generated manifest listing scenarios, available backends, and schema version.
5. Enforce size limits and fail if a dashboard dataset becomes unexpectedly large.
6. Commit:

```bash
git add scripts/prepare_dashboard_data.py dashboard/public/data/.gitkeep README.md
git commit -m "feat: prepare compact dashboard data"
```

**Validation:** The manifest and every referenced file exist, parse successfully, and remain under the agreed repository size limit.

---

### Task 12: Scaffold the Electron + React + TypeScript dashboard

**Objective:** Create a desktop visualization shell that reads static generated outputs.

**Files:**

- Create: `dashboard/package.json`
- Create: `dashboard/electron/main.ts`
- Create: `dashboard/electron/preload.ts`
- Create: `dashboard/src/App.tsx`
- Create: `dashboard/src/types.ts`
- Create: `dashboard/src/data.ts`
- Create standard Vite/TypeScript configuration files.

**Steps:**

1. Scaffold Vite React TypeScript inside `dashboard/` and add Electron integration.
2. Add scripts for `npm run dev`, `npm run build`, `npm run lint`, `npm run test`, and Electron startup/package where appropriate.
3. Define strict TypeScript interfaces matching schema version 1.
4. Implement data loaders with loading, empty, malformed-data, and unsupported-schema states.
5. Keep Electron security defaults: context isolation enabled, no unrestricted renderer Node access.
6. Do not add executable launching in this task.
7. Commit:

```bash
git add dashboard
git commit -m "feat: scaffold Electron visualization dashboard"
```

**Validation:** `npm run lint`, `npm run test`, and `npm run build` succeed; Electron opens the dashboard shell and loads the manifest.

---

### Task 13: Implement Canvas wildfire playback

**Objective:** Display precomputed fire spread smoothly without creating one DOM element per cell.

**Files:**

- Create: `dashboard/src/components/SimulationCanvas.tsx`
- Create: `dashboard/src/components/PlaybackControls.tsx`
- Create: `dashboard/src/components/BackendSelector.tsx`
- Create: `dashboard/src/components/StatsPanel.tsx`
- Modify: `dashboard/src/App.tsx`

**Steps:**

1. Render cells through Canvas `ImageData`/`putImageData` using the fixed color map:
   - Empty: dark neutral;
   - Tree: green;
   - Burning: orange/red;
   - Burned: charcoal.
2. Add play, pause, previous/next, timeline scrubber, and 1×/2×/4× speed controls.
3. Drive playback through `requestAnimationFrame`; do not store each cell as React component state.
4. Show step, active burning count, burned count, burned percentage, grid size, and checksum status.
5. Add legend and responsive scaling while preserving the grid aspect ratio.
6. Test frame-index bounds, playback stop at final frame, manual scrubbing, and malformed frame dimensions.
7. Commit:

```bash
git add dashboard/src
git commit -m "feat: add wildfire Canvas playback"
```

**Validation:** The canonical 200×200 scenario plays, pauses, scrubs, and reaches the exact final statistics without console errors.

---

### Task 14: Implement performance charts and result comparison

**Objective:** Present the assignment's required performance evidence clearly in the desktop dashboard.

**Files:**

- Create: `dashboard/src/components/PerformanceCharts.tsx`
- Create: `dashboard/src/components/ResultTable.tsx`
- Modify: `dashboard/src/App.tsx`
- Modify: `dashboard/src/types.ts`

**Steps:**

1. Add runtime comparison by backend and grid size.
2. Add speedup comparison against Serial.
3. Add OpenMP thread-scaling and efficiency charts.
4. Add MPI process-scaling and efficiency charts.
5. Add CUDA block-size comparison without applying CPU-style worker efficiency.
6. Add a result table containing backend, configuration, median runtime, speedup, efficiency where meaningful, burned percentage, checksum, and correctness status.
7. Add filters for grid size, steps, and backend.
8. Label axes, units, sample count, and timing type clearly.
9. Commit:

```bash
git add dashboard/src
git commit -m "feat: add performance comparison dashboard"
```

**Validation:** Every chart value can be traced back to a row in `benchmarks.csv/json`; missing configurations render as unavailable, not zero.

---

### Task 15: Run the full experiment and select report evidence

**Objective:** Produce the actual measured data used in Part B rather than relying on expected performance claims.

**Files:**

- Generate: `results/generated/raw/*.json`
- Generate: `results/generated/benchmarks.csv`
- Generate: `results/generated/benchmarks.json`
- Create: `results/final/experiment_manifest.json`
- Create: `results/final/benchmark_summary.csv`
- Create: `results/final/observations.md`

**Steps:**

1. Record machine/software context: CPU model/core count, RAM, GPU model, CUDA version, compiler, OpenMP runtime, MPI version, OS, and build type.
2. Run the correctness gate first; stop if any mismatch exists.
3. Run the report benchmark profile under controlled conditions:
   - Release build;
   - close avoidable heavy applications;
   - keep power mode and GPU state consistent;
   - repeat each configuration;
   - do not mix dashboard render time with backend compute time.
4. Select the largest configurations that finish reliably; document any reduction from the proposal's planned maximum.
5. Generate final tables and calculate metrics from raw samples.
6. Write factual observations only after inspecting results, covering:
   - small-input overhead;
   - OpenMP scaling/memory bandwidth;
   - CUDA transfer/kernel overhead and block-size behavior;
   - MPI communication-to-computation ratio and scaling;
   - anomalies and variance;
   - optimization before/after comparison.
7. Copy only the compact final evidence set needed by the dashboard/report.
8. Commit compact final evidence only if repository size remains reasonable:

```bash
git add results/final dashboard/public/data
 git commit -m "data: add final wildfire benchmark evidence"
```

**Validation:** Every summary number is reproducible from raw samples and every parallel row has a matching correctness result.

---

### Task 16: Prepare the Part B report evidence package

**Objective:** Make all implementation/results material ready for the 8–20 page final report and rubric discussion.

**Files:**

- Create: `docs/report-evidence.md`
- Create: `docs/figures/README.md`
- Create: `docs/tables/benchmark-summary.csv`

**Steps:**

1. Create a report evidence map with these sections:
   - Title and Abstract evidence;
   - implementation overview;
   - deterministic CA model;
   - Serial/OpenMP/CUDA/MPI design;
   - correctness validation;
   - experimental setup;
   - runtime/speedup/efficiency/scalability results;
   - optimization evidence;
   - discussion, limitations, and conclusion.
2. Export or capture:
   - system architecture;
   - CA states/rules and double buffering;
   - CUDA thread mapping;
   - MPI partition/halo exchange;
   - runtime graph;
   - speedup graph;
   - OpenMP/MPI efficiency graphs;
   - CUDA block-size graph;
   - dashboard screenshots;
   - representative wildfire frames.
3. Ensure every figure/table has a proposed caption and source data path.
4. Explicitly document that MPI was local multi-process if no cluster is used.
5. Do not claim real-world wildfire prediction accuracy.
6. Commit:

```bash
git add docs
git commit -m "docs: prepare Part B report evidence"
```

**Validation:** A teammate can locate the exact source data/code for every report claim without searching manually.

---

### Task 17: Prepare a stable presentation, demo, and Q&A path

**Objective:** Ensure all three members can demonstrate and explain the system without depending on fragile live computation.

**Files:**

- Create: `docs/demo-runbook.md`
- Create: `docs/qa-preparation.md`
- Modify: `README.md`

**Steps:**

1. Define the primary demo:
   - open packaged Electron dashboard;
   - play the precomputed simulation;
   - switch charts/configurations;
   - show checksum match;
   - explain measured speedup and overhead.
2. Define a short live smoke demo for each backend using small input.
3. Define fallbacks:
   - precomputed dashboard data if CUDA/MPI environment fails;
   - screenshots/recording if Electron launch fails;
   - saved command outputs for build issues.
4. Prepare Q&A answers for:
   - why cellular automata is computationally expensive;
   - why double buffering prevents race conditions;
   - shared vs distributed memory;
   - OpenMP shared/private variables and barrier;
   - CUDA mapping and memory overhead;
   - MPI ghost rows and `MPI_Sendrecv`;
   - why results match;
   - why a backend may be slower on small inputs;
   - how speedup and efficiency are calculated;
   - what optimization was implemented;
   - project limitations.
5. Make each member rehearse all four backends, not only their assigned component.
6. Commit:

```bash
git add README.md docs
git commit -m "docs: add wildfire demo and Q&A runbook"
```

**Validation:** The complete prepared demo can be finished within the presentation time and the fallback can be activated without rebuilding.

---

### Task 18: Final release and submission verification

**Objective:** Produce a clean submission artifact that builds and runs from documented instructions.

**Files:**

- Modify: `README.md`
- Create: `SUBMISSION_CHECKLIST.md`
- Optional create: GitHub release archive outside generated build folders.

**Steps:**

1. From a clean clone, install/check prerequisites and run the documented build.
2. Run CTest, Python tests, correctness gate, benchmark smoke profile, dashboard lint/test/build.
3. Run one command for each backend and verify generated JSON.
4. Verify the packaged/prepared Electron dashboard loads final data with no console errors.
5. Confirm the repository contains no secrets, huge generated files, personal absolute paths in runtime logic, or stale binaries unless intentionally included for submission.
6. Confirm report length/format, Appendix 3 rubric on the last page, source-code submission, and presentation materials.
7. Tag the submission state only after all checks pass:

```bash
git tag -a part-b-submission -m "BMCS2103 Part B submission"
git push origin main --follow-tags
```

**Validation command set:**

```bash
cmake -S . -B build_verified -G "Visual Studio 17 2022" -A x64
cmake --build build_verified --config Release
ctest --test-dir build_verified -C Release --output-on-failure
python scripts/verify_correctness.py --build-dir build_verified/Release
python scripts/run_benchmarks.py --profile smoke --build-dir build_verified/Release
cd dashboard && npm ci && npm run lint && npm run test && npm run build
```

**Expected:** All commands pass from a clean clone and the documented demo works using the final committed data.

---

## 5. Work Allocation

Match the submitted proposal while requiring cross-review:

| Member | Primary implementation | Required supporting work | Review responsibility |
|---|---|---|---|
| Kong Ji Shou | Common model, Serial, CLI/output contract, benchmark/correctness scripts, integration | Final data consolidation and README | Review OpenMP/MPI output compatibility and dashboard data accuracy |
| Khoo Kah Qin | OpenMP and MPI implementations, scaling experiments | MPI/OpenMP result discussion and demo explanation | Review common model correctness and CUDA comparison fairness |
| Heng Wei Yi | CUDA implementation and Electron/React dashboard | CUDA block-size experiment and visualization screenshots | Review JSON/frame contracts and dashboard result traceability |
| All | Full benchmark run, report, presentation, Q&A | Cross-backend correctness and clean-clone verification | Each member signs off on every backend and final report claim |

Recommended branch pattern:

```text
main
feat/common-engine
feat/openmp-mpi
feat/cuda-dashboard
```

Keep pull requests small enough to review. Rebase/merge common contracts before parallel branches depend on them; do not let each branch invent a different JSON or CLI format.

---

## 6. Milestone Order and Exit Criteria

| Priority | Milestone | Exit criterion |
|---:|---|---|
| P0 | Baseline preservation | Four prototype outputs recorded and reproducible |
| P0 | Common model + CLI + JSON | Serial produces validated configurable output |
| P0 | Four production backends | Every backend matches Serial on correctness matrix |
| P0 | Benchmark automation | Smoke profile produces consolidated valid data |
| P1 | Full measured experiments | Final tables contain real repeated measurements |
| P1 | Dashboard | Canvas playback and charts work from final data |
| P1 | Report evidence | Every claim/figure maps to code or measured data |
| P1 | Demo/Q&A | Stable prepared demo and fallback are rehearsed |
| P2 | Optional extensions | Only considered after all P0/P1 exit criteria pass |

---

## 7. Risks and Mitigations

| Risk | Likely impact | Mitigation |
|---|---|---|
| Restructuring breaks known-good prototypes | Correctness regression | Preserve baseline fixture and migrate one backend at a time |
| Different backends parse/configure inputs differently | Invalid comparison | One common CLI/config contract and automated correctness matrix |
| CUDA timing is inflated by per-step synchronization | Misleading performance | Use CUDA events and synchronize at timing boundary; report kernel and end-to-end timing separately |
| MPI rows are not divisible by process count | Failed experiments | Implement `Scatterv/Gatherv` with counts/displacements |
| MPI reports only rank-0 time | Underreported runtime | Reduce per-rank elapsed times using `MPI_MAX` |
| Frames make files too large | Dashboard/repository becomes unusable | 100–200 grid, selected intervals, size guard, large grids benchmark-only |
| Dashboard results disagree with report | Credibility issue | Generate dashboard data from consolidated benchmark files, never retype values |
| Weak speedup for small workloads | Apparently poor result | Keep and explain it as overhead evidence; use larger workloads for scalability |
| Overbuilding Electron process launching | Delays core assignment | Static precomputed data is required; launching remains optional |
| Team members understand only their own method | Presentation marks lost | Cross-review, shared Q&A notes, and full-team rehearsal |
| Proposal schedule no longer matches reality | Completion risk | Track milestone exit criteria instead of assuming week labels are still current |

---

## 8. Final Definition of Done

The assignment implementation is ready only when all of the following are true:

- [ ] Clean clone builds Serial, OpenMP, CUDA, and MPI Release executables.
- [ ] Shared CLI validates all experimental parameters.
- [ ] All backends match Serial for checksum and burned count across the correctness matrix.
- [ ] Benchmark automation records repeated raw samples and derived metrics.
- [ ] OpenMP thread scaling, MPI process scaling, and CUDA block-size results exist.
- [ ] At least one optimization is measured and discussed, not merely claimed.
- [ ] Small-grid selected frames and large-grid benchmarks are separated.
- [ ] Electron dashboard plays the fire spread through Canvas and displays traceable performance charts.
- [ ] Final report evidence includes setup, results, discussion, limitations, optimization, and conclusion.
- [ ] README contains reproducible build/run/test instructions.
- [ ] All members can explain all four implementations and metric formulas.
- [ ] Demo fallback works without CUDA/MPI live execution.
- [ ] Submission package includes report, source code, rubric appendix, and presentation/demo materials.
