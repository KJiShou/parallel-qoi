# Four-Backend Wall-Clock Playback and Majority Preview Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** 用同一条 elapsed-time timeline 同时回放 Serial、OpenMP、CUDA、MPI 四个 backend 的 simulation progress，让用户直观看见相同 wall-clock time 下每种方法已经推进到哪个 timestep；大型 grid 使用 majority-state aggregation，而不是 benchmark-only placeholder 或 representative block/thread work map。

**Architecture:** 四个 backend 仍然分别运行，不并发争抢 CPU/GPU，以避免资源竞争污染正式 benchmark。系统为相同 workload 生成一份 canonical deterministic majority-state frame sequence，并为四个 backend 记录/加载各自的 progress timing。React 在同一 master elapsed time 上计算每个 backend 的 current step，在 2×2 Canvas comparison grid 中同时显示 Serial、OpenMP、CUDA、MPI 当前所处的 fire frame。正式 runtime 来自无 instrumentation benchmark；trace milestones 来自独立 explain run，若 trace 不存在则明确标注为 benchmark-duration interpolation，不伪装成真实逐步 telemetry。

**Tech Stack:** C++17, OpenMP, CUDA events, MPI, compact 2-bit majority-state frames, JSON schema v4, Electron IPC/child process runner, React 19, TypeScript, Canvas 2D, Vitest, Node test runner, CMake/CTest.

---

## 1. Correction and Scope

本计划修正之前错误的解释。

用户所说的“四个 process”实际指：

```text
Serial
OpenMP
CUDA
MPI
```

不是 MPI Rank 0–3。

本计划完全取代：

```text
.hermes/plans/2026-07-12_163821-mpi-time-process-majority-preview.md
```

实施时应删除旧计划文件，避免后续错误地实现 MPI rank timeline。

---

## 2. Desired Visual Result

### 2.1 Four synchronized panels

```text
Master elapsed time: 80 ms / 15,000 ms

┌ Serial ─────────────────┐  ┌ OpenMP · 4 threads ──────┐
│ Step 1 / 100 · 1%       │  │ Step 7 / 100 · 7%        │
│                         │  │                           │
│ Majority fire frame     │  │ Majority fire frame       │
│                         │  │                           │
│ Running                 │  │ Running                   │
└─────────────────────────┘  └───────────────────────────┘

┌ CUDA · block 256 ───────┐  ┌ MPI · 4 processes ──────┐
│ Step 72 / 100 · 72%     │  │ Step 6 / 100 · 6%        │
│                         │  │                           │
│ Majority fire frame     │  │ Majority fire frame       │
│                         │  │                           │
│ Running                 │  │ Running                   │
└─────────────────────────┘  └───────────────────────────┘
```

At a later time:

```text
CUDA → Step 100 / 100 · Finished at 111.5 ms
OpenMP → Step 42 / 100 · Running
MPI → Step 33 / 100 · Running
Serial → Step 12 / 100 · Running
```

The faster backend remains on its final frame with a visible `Finished` badge while the shared master time continues.

### 2.2 Why four fire panels are useful here

The four backends intentionally produce the same final fire result and checksum. However, at the same elapsed time they are at different timesteps, so their panels show different stages of the same deterministic spread:

```text
Same model + same seed + different execution speed
```

This makes performance differences visual without changing simulation rules.

---

## 3. Time Semantics and Honesty

### 3.1 Formal benchmark duration

Use existing median runtime from matching benchmark records:

```text
Serial 4000²: 14993.021 ms
OpenMP 4000²: 4209.511 ms
CUDA 4000²: 111.522 ms
MPI 4000²: 5362.650 ms
```

The master timeline duration is:

```ts
masterDurationMs = max(
  serialDuration,
  openmpDuration,
  cudaDuration,
  mpiDuration
);
```

### 3.2 Exact trace milestones where available

Separate explain runs may record sampled milestones:

```json
{
  "backend": "openmp",
  "milestones": [
    { "step": 0, "elapsedMs": 0 },
    { "step": 10, "elapsedMs": 411.2 },
    { "step": 20, "elapsedMs": 831.5 },
    { "step": 100, "elapsedMs": 4209.5 }
  ]
}
```

At master time `t`, select/interpolate between adjacent milestones.

### 3.3 Fallback interpolation

If trace milestones are not available, calculate:

```ts
estimatedStep = Math.floor(
  Math.min(1, elapsedMs / benchmarkMedianMs) * totalSteps
);
```

The UI must visibly label the mode:

```text
Progress source: benchmark-duration interpolation
```

or:

```text
Progress source: sampled backend trace
```

Never label interpolated progress as exact per-step telemetry.

### 3.4 Why the four backends must not run concurrently for measurement

Do not start Serial/OpenMP/CUDA/MPI simultaneously to obtain benchmark durations, because:

- Serial/OpenMP/MPI compete for CPU and memory bandwidth;
- CUDA competes for shared memory bandwidth and CPU launch resources;
- MPI processes compete with OpenMP threads;
- results would not match the existing isolated benchmark methodology.

Correct workflow:

```text
Run each backend separately
    ↓
Store duration/milestones
    ↓
Replay all four together visually
```

---

## 4. Majority-State Aggregation

### 4.1 Adaptive source-to-preview mapping

Use:

```text
previewRows = min(sourceRows, 500)
previewCols = min(sourceCols, 500)
```

| Source grid | Canonical preview | Source tile per preview pixel |
|---:|---:|---:|
| 500×500 | 500×500 | 1×1 |
| 1000×1000 | 500×500 | 2×2 |
| 2000×2000 | 500×500 | 4×4 |
| 4000×4000 | 500×500 | 8×8 |

The 2×2 comparison view displays the same 500×500 canonical frame scaled down by CSS/Canvas to fit each backend panel. It does not create four 4000×4000 canvases.

### 4.2 Majority selection

For each preview pixel:

```text
count Empty
count Tree
count Burning
count Burned
show the state with the largest count
```

Tie priority:

```text
Burning > Burned > Tree > Empty
```

Priority applies only to exact ties.

### 4.3 Compact frames

Pack four states at 2 bits/pixel:

```text
500×500 = 62,500 bytes/frame before Base64
```

Do not send raw 4000² cell arrays to React.

### 4.4 One canonical frame sequence

Because all four backends must produce the same deterministic state at each simulation step, generate one canonical frame sequence for a workload:

```text
framesByStep[0]
framesByStep[5]
framesByStep[10]
...
framesByStep[100]
```

All four panels select from this same sequence using their backend-specific current step.

Benefits:

- no fourfold frame-file duplication;
- consistent correctness evidence;
- smaller trace bundle;
- backend differences come only from progress timing.

---

## 5. Trace and Comparison Bundle Schema

Use schema version 4:

```json
{
  "schemaVersion": 4,
  "mode": "four-backend-comparison",
  "workload": {
    "rows": 4000,
    "cols": 4000,
    "steps": 100,
    "density": 0.7,
    "seed": 42
  },
  "preview": {
    "rows": 500,
    "cols": 500,
    "aggregationRows": 8,
    "aggregationCols": 8,
    "method": "majority-state",
    "tieBreakPriority": ["burning", "burned", "tree", "empty"]
  },
  "frames": [
    {
      "step": 0,
      "cells2BitBase64": "...",
      "sourceCounts": {
        "empty": 0,
        "tree": 0,
        "burning": 0,
        "burned": 0
      }
    }
  ],
  "backends": {
    "serial": {
      "medianMs": 14993.021,
      "progressSource": "benchmark-duration-interpolation",
      "milestones": []
    },
    "openmp": {
      "medianMs": 4209.511,
      "workers": 4,
      "progressSource": "sampled-backend-trace",
      "milestones": []
    },
    "cuda": {
      "medianMs": 111.522,
      "blockSize": 256,
      "progressSource": "sampled-backend-trace",
      "milestones": []
    },
    "mpi": {
      "medianMs": 5362.650,
      "workers": 4,
      "progressSource": "sampled-backend-trace",
      "milestones": []
    }
  },
  "correctness": {
    "allChecksumsMatch": true,
    "checksum": "15495257518842739619"
  }
}
```

Matching key:

```text
rows|cols|steps|density|seed|ignitionRow|ignitionCol
```

Do not combine timing records from different workloads.

---

## 6. Trace Strategy by Backend

### 6.1 Serial

Use `std::chrono::steady_clock` sampled every configured step interval.

Trace mode only:

```cpp
if (step % traceStepInterval == 0) {
    milestones.push_back({step, elapsedMs(start)});
}
```

### 6.2 OpenMP

Record milestones after the implicit timestep barrier and grid swap. Do not log inside every worker's cell loop.

This records global backend progress, not individual OpenMP thread progress.

### 6.3 CUDA

CUDA kernel launches are asynchronous. Accurate sampled milestones require CUDA events and synchronization at sample boundaries:

```cpp
cudaEventRecord(marker);
cudaEventSynchronize(marker);
```

This introduces overhead, so use only in explain trace mode and sample every 5/10 steps.

Formal CUDA runtime remains from the uninstrumented benchmark.

### 6.4 MPI

Rank 0 records global timestep milestones after all ranks complete the sampled timestep. Use a barrier only in trace mode if required for a clear global milestone.

This trace does not show MPI ranks separately because the user wants MPI as one of four backend lanes.

---

## 7. New Electron Workflow

### Buttons

```text
[Run Benchmark]
[Generate Four-Backend Playback]
```

### Generate Four-Backend Playback

1. Validate that matching benchmark records exist for all four backends.
2. If any are missing, run them sequentially or show exactly which are missing.
3. Generate/load canonical majority-state frames.
4. Optionally generate sampled trace milestones sequentially.
5. Validate all checksums.
6. Write one schema-v4 comparison bundle.
7. Open the synchronized 2×2 player.

Trace generation is a separate job type and never enters benchmark table timing.

### Cancellation

Cancel must terminate the currently running backend and mark the comparison job incomplete. It must not keep a partially valid bundle.

---

## 8. UI Replacement

### Remove

- `ParallelWorkMap.tsx`;
- Serial/OpenMP/MPI/CUDA static work maps;
- CUDA representative blocks;
- warp lane icons;
- old `.work-*` styles;
- MPI-rank-only plan/components if any are not yet implemented.

### Add

```text
FourBackendPlayback
BackendProgressPanel
MajorityFrameCanvas
ComparisonTimeline
PlaybackMethodBadge
```

### Controls

```text
Play / Pause
Previous frame
Next frame
Reset
Master elapsed-time slider
Playback speed: 0.5× / 1× / 2× / 4× / Auto-compressed
```

### Auto-compressed playback

A 15-second real duration can play normally. For much longer workloads, offer:

```text
Auto-compressed: slowest backend finishes in 20 seconds
```

All relative finish-time ratios must remain unchanged.

Example:

```ts
visualElapsedMs = visualPlayerRatio * slowestBackendMedianMs;
```

This compresses presentation time without changing backend ordering/proportions.

---

## 9. Files to Change

```text
wildfire_common.hpp
serial_wildfire.cpp
openmp_wildfire.cpp
cuda_wildfire.cu
mpi_wildfire.cpp
CMakeLists.txt

scripts/
  generate_comparison_bundle.py       # new
  verify_comparison_bundle.py         # new
  prepare_dashboard_data.py           # modify

dashboard/electron/runner/
  configValidator.cjs
  commandBuilder.cjs
  resultValidator.cjs
  runManager.cjs

dashboard/electron/
  main.cjs
  preload.cjs

dashboard/src/
  App.tsx
  types.ts
  frameCodec.ts
  style.css
  desktopApi.d.ts
  components/
    ParallelWorkMap.tsx               # delete
    LiveRunPanel.tsx                  # modify
    FourBackendPlayback.tsx           # new
    BackendProgressPanel.tsx          # new
    MajorityFrameCanvas.tsx           # new
    ComparisonTimeline.tsx            # new
  lib/
    majorityAggregation.ts            # new
    progressInterpolation.ts          # new
    comparisonBundle.ts               # new
  tests/
    FourBackendPlayback.test.tsx      # new
    progressInterpolation.test.ts     # new
    majorityAggregation.test.ts       # new

dashboard/tests/electron/
  comparisonCommand.test.cjs          # new

docs/
  four-backend-playback.md            # new
```

---

## 10. Step-by-Step Implementation Plan

### Task 1: Remove the incorrect MPI-rank plan before implementation

**Objective:** Prevent accidental implementation of the wrong four-process interpretation.

**Files:**

- Delete: `.hermes/plans/2026-07-12_163821-mpi-time-process-majority-preview.md`
- Keep: `.hermes/plans/2026-07-12_164350-four-backend-time-majority-playback.md`

**Verification:**

```bash
rg "MPI Rank 0|four-rank process timeline" .hermes/plans
```

Expected: no active implementation plan instructs a four-rank-only UI.

**Commit:** include this cleanup with Task 2; do not create a plan-only commit unless project convention requires it.

---

### Task 2: Define backend progress interpolation with tests

**Objective:** Given one master elapsed time, calculate each backend's current step honestly.

**Files:**

- Create: `dashboard/src/lib/progressInterpolation.ts`
- Create: `dashboard/src/lib/progressInterpolation.test.ts`

**Tests first:**

```ts
it('shows CUDA finished while Serial is still running', () => {
  const elapsed = 200;
  expect(stepAtTime([], 111.522, 100, elapsed)).toBe(100);
  expect(stepAtTime([], 14993.021, 100, elapsed)).toBe(1);
});
```

Also test:

- elapsed 0 → step 0;
- elapsed ≥ duration → final step;
- milestone exact timestamp;
- interpolation between milestones;
- non-monotonic milestones rejected;
- empty milestones use duration interpolation;
- zero/negative/NaN duration rejected;
- progress never exceeds 100%.

**RED:**

```bash
cd dashboard
npm test -- --run src/lib/progressInterpolation.test.ts
```

**GREEN:** implement binary-search milestone selection/interpolation.

**Commit:**

```bash
git add dashboard/src/lib/progressInterpolation.ts dashboard/src/lib/progressInterpolation.test.ts
git commit -m "test: define four-backend progress timing"
```

---

### Task 3: Define majority-state aggregation with tests

**Objective:** Specify exact large-grid downsampling and tie behavior.

**Files:**

- Create: `dashboard/src/lib/majorityAggregation.ts`
- Create: `dashboard/src/lib/majorityAggregation.test.ts`

Tests:

- 4×4 → 2×2 expected majority;
- 1000→500 = 2×2 tiles;
- 2000→500 = 4×4 tiles;
- 4000→500 = 8×8 tiles;
- non-divisible dimensions;
- each source cell counted once;
- tie priority `Burning > Burned > Tree > Empty`;
- invalid state/dimensions rejected.

This TypeScript implementation is a reference oracle, not the production 4000² aggregation path.

**Commit:**

```bash
git add dashboard/src/lib/majorityAggregation.ts dashboard/src/lib/majorityAggregation.test.ts
git commit -m "test: define majority-state preview"
```

---

### Task 4: Add common trace/milestone configuration

**Objective:** Enable sampled explain-mode milestones without changing benchmark defaults.

**Files:**

- Modify: `wildfire_common.hpp`
- Create: `tests/progress_trace_test.cpp`
- Modify: `CMakeLists.txt`

New options:

```text
--trace-output FILE.json
--trace-step-interval N
```

Rules:

- omitted options preserve current benchmark path exactly;
- interval > 0;
- trace output separate from benchmark output;
- trace mode forces repetitions=1/warmup=0 internally or rejects incompatible values;
- trace metadata states `untimed-explain`.

**Verification:**

```bash
cmake --build build_verified --config Release --parallel
ctest --test-dir build_verified -C Release -R progress_trace --output-on-failure
python scripts/verify_correctness.py --build-dir build_verified/Release
```

**Commit:**

```bash
git add wildfire_common.hpp tests/progress_trace_test.cpp CMakeLists.txt
git commit -m "feat: add sampled backend progress traces"
```

---

### Task 5: Implement Serial and OpenMP milestones

**Objective:** Record sampled global timestep completion for CPU backends in trace mode.

**Files:**

- Modify: `serial_wildfire.cpp` or common serial runner in `wildfire_common.hpp`
- Modify: `openmp_wildfire.cpp`
- Create/modify: `scripts/verify_comparison_bundle.py`

Tests:

- start step 0/time 0;
- final milestone equals configured steps;
- elapsed time monotonic;
- OpenMP records after timestep barrier/swap;
- normal benchmark JSON unchanged;
- checksum matches untraced result.

**Commit:**

```bash
git add serial_wildfire.cpp wildfire_common.hpp openmp_wildfire.cpp scripts/verify_comparison_bundle.py
git commit -m "feat: trace Serial and OpenMP progress"
```

---

### Task 6: Implement CUDA and MPI milestones

**Objective:** Record sampled global progress for CUDA and MPI explain runs.

**Files:**

- Modify: `cuda_wildfire.cu`
- Modify: `mpi_wildfire.cpp`
- Modify: `scripts/verify_comparison_bundle.py`

CUDA:

- CUDA events at sampled boundaries;
- synchronize only in trace mode;
- document trace overhead;
- final milestone after final kernel completion.

MPI:

- rank 0 global milestone;
- sampled synchronization only in trace mode;
- one MPI backend lane, not per-rank UI;
- final milestone after all ranks finish.

Tests:

- monotonic milestones;
- final step present;
- trace source identified;
- checksums match formal runs;
- no trace instrumentation when options absent.

**Commit:**

```bash
git add cuda_wildfire.cu mpi_wildfire.cpp scripts/verify_comparison_bundle.py
git commit -m "feat: trace CUDA and MPI progress"
```

---

### Task 7: Implement compact canonical majority frames

**Objective:** Produce one bounded frame sequence shared by all four panels.

**Files:**

- Modify: `wildfire_common.hpp`
- Modify: `scripts/prepare_dashboard_data.py`
- Create: `tests/majority_preview_test.cpp`
- Modify: `CMakeLists.txt`

Functions:

```cpp
aggregateMajority(...)
packStates2BitBase64(...)
```

Generate canonical frames from one deterministic backend, preferably Serial for simplicity/correctness.

For 4000², avoid storing every full frame simultaneously. Aggregate and write/stream each selected frame immediately.

Tests:

- C++ output matches TypeScript fixture;
- packed payload round-trip;
- preview ≤500²;
- 4000→500 metadata = 8×8;
- source checksum/counts preserved separately;
- final frame matches backend correctness checksum.

**Commit:**

```bash
git add wildfire_common.hpp scripts/prepare_dashboard_data.py tests/majority_preview_test.cpp CMakeLists.txt
git commit -m "feat: generate canonical majority preview frames"
```

---

### Task 8: Build and verify schema-v4 comparison bundle

**Objective:** Merge matching benchmark durations, optional traces and canonical frames into one validated artifact.

**Files:**

- Create: `scripts/generate_comparison_bundle.py`
- Create: `scripts/verify_comparison_bundle.py`
- Create: `dashboard/src/lib/comparisonBundle.ts`
- Create: `dashboard/src/lib/comparisonBundle.test.ts`

Generation rules:

- all four backend records required;
- exact workload matching;
- all checksums equal;
- canonical frames cover step 0/final;
- duration uses formal median runtime;
- sampled milestones are optional;
- missing milestones use explicitly labeled interpolation;
- no fabricated trace points.

Verification:

```bash
python scripts/generate_comparison_bundle.py \
  --benchmarks results/generated/benchmarks.json \
  --grid 4000 \
  --steps 100 \
  --density 0.7 \
  --seed 42 \
  --output results/live/comparison-4000.json

python scripts/verify_comparison_bundle.py results/live/comparison-4000.json
```

**Commit:**

```bash
git add scripts dashboard/src/lib
git commit -m "feat: build four-backend comparison bundles"
```

---

### Task 9: Extend Electron runner for comparison generation

**Objective:** Generate/load comparison bundles through trusted Electron IPC.

**Files:**

- Modify: `dashboard/electron/runner/configValidator.cjs`
- Modify: `dashboard/electron/runner/commandBuilder.cjs`
- Modify: `dashboard/electron/runner/resultValidator.cjs`
- Modify: `dashboard/electron/runner/runManager.cjs`
- Modify: `dashboard/electron/main.cjs`
- Modify: `dashboard/electron/preload.cjs`
- Modify: `dashboard/src/desktopApi.d.ts`
- Create: `dashboard/tests/electron/comparisonCommand.test.cjs`

New API:

```ts
generateComparison(config): Promise<{ runId: string }>;
readComparison(runId: string): Promise<ComparisonBundle>;
```

Security:

- only whitelisted workload fields;
- internal script/executable paths;
- `shell:false`;
- one active job;
- controlled output path;
- cancellation cleans incomplete bundle;
- comparison job does not create benchmark rows.

**Commit:**

```bash
git add dashboard/electron dashboard/src/desktopApi.d.ts dashboard/tests/electron
git commit -m "feat: generate four-backend playback in Electron"
```

---

### Task 10: Build bounded MajorityFrameCanvas

**Objective:** Render one packed canonical frame safely in each backend panel.

**Files:**

- Create: `dashboard/src/components/MajorityFrameCanvas.tsx`
- Create: `dashboard/src/tests/MajorityFrameCanvas.test.tsx`
- Modify: `dashboard/src/frameCodec.ts`
- Modify: `dashboard/src/style.css`

Requirements:

- internal Canvas dimensions = preview dimensions, maximum 500×500;
- decode once when frame changes;
- one `ImageData` pass;
- optional single burning mask pass;
- no source-cell DOM elements;
- no 4000×4000 Canvas;
- labels explain source/preview/tile dimensions;
- final dark frame is not shown on initial load; Reset starts at elapsed 0.

**Commit:**

```bash
git add dashboard/src/components/MajorityFrameCanvas.tsx dashboard/src/tests dashboard/src/frameCodec.ts dashboard/src/style.css
git commit -m "feat: render bounded majority frames"
```

---

### Task 11: Build backend progress panels

**Objective:** Show backend-specific current step, completion time and progress source.

**Files:**

- Create: `dashboard/src/components/BackendProgressPanel.tsx`
- Create: `dashboard/src/tests/BackendProgressPanel.test.tsx`
- Modify: `dashboard/src/style.css`

Each panel displays:

```text
CUDA · block 256
Step 72 / 100
72%
Elapsed to current point
Median completion: 111.522 ms
Running / Finished
Sampled trace / Interpolated
```

Tests:

- finished badge appears once master time exceeds backend duration;
- final frame remains visible;
- zero time shows step 0;
- exact source badge shown;
- no backend exceeds final step;
- CUDA/OpenMP/MPI configuration labels correct.

**Commit:**

```bash
git add dashboard/src/components/BackendProgressPanel.tsx dashboard/src/tests dashboard/src/style.css
git commit -m "feat: display backend progress panels"
```

---

### Task 12: Build synchronized 2×2 FourBackendPlayback

**Objective:** Drive four backend panels from one master wall-clock cursor.

**Files:**

- Create: `dashboard/src/components/FourBackendPlayback.tsx`
- Create: `dashboard/src/components/ComparisonTimeline.tsx`
- Create: `dashboard/src/tests/FourBackendPlayback.test.tsx`
- Modify: `dashboard/src/App.tsx`

Behavior:

- master duration = slowest formal median;
- same master elapsed time passed to all panels;
- each backend independently calculates current step;
- panel chooses canonical frame nearest at-or-before current step;
- faster backend freezes on final frame after completion;
- Reset = time 0 and pauses;
- Play/Pause uses `requestAnimationFrame`;
- visibility change pauses;
- playback speed and auto-compress preserve ratios;
- frame selection uses binary search.

Critical test:

At 200 ms using current 4000² results:

```text
CUDA = finished
Serial = early step
OpenMP = early/intermediate step
MPI = early/intermediate step
```

**Commit:**

```bash
git add dashboard/src/components dashboard/src/tests dashboard/src/App.tsx
git commit -m "feat: synchronize four backend playback panels"
```

---

### Task 13: Remove old representative process UI

**Objective:** Remove every obsolete thread/block/rank illustration.

**Files:**

- Delete: `dashboard/src/components/ParallelWorkMap.tsx`
- Modify: `dashboard/src/App.tsx`
- Modify: `dashboard/src/style.css`
- Remove obsolete tests.

Remove selectors/references:

```text
ParallelWorkMap
work-map-wrap
work-grid
work-band
work-openmp
work-mpi
work-cuda
halo-note
warp-lanes
workPulse
representative block
not live profiler telemetry
```

Verification:

```bash
rg "ParallelWorkMap|work-band|warp-lanes|representative block" dashboard/src
```

Expected: no matches.

**Commit:**

```bash
git add -A dashboard/src
git commit -m "refactor: remove representative process maps"
```

---

### Task 14: Update Electron live-run UI

**Objective:** Add a distinct comparison-generation action without confusing it with benchmark execution.

**Files:**

- Modify: `dashboard/src/components/LiveRunPanel.tsx`
- Modify: `dashboard/src/App.tsx`
- Create/update: `dashboard/src/tests/LiveRunPanel.test.tsx`

Buttons:

```text
Run Benchmark
Generate Four-Backend Playback
```

Rules:

- comparison requires matching four-backend data;
- missing records listed clearly;
- optional `Run Missing Backends Sequentially` action;
- playback generation excluded from benchmark table;
- completed bundle opens automatically;
- browser mode disables generation;
- cancellation supported;
- warning explains sequential measurement and synchronized replay.

**Commit:**

```bash
git add dashboard/src/components/LiveRunPanel.tsx dashboard/src/App.tsx dashboard/src/tests
git commit -m "feat: add four-backend playback action"
```

---

### Task 15: Generate and verify actual comparison artifacts

**Objective:** Produce real 500/1000/2000/4000 comparison bundles from current benchmark records.

Generate:

```text
500×500, 100 steps
1000×1000, 100 steps
2000×2000, 100 steps
4000×4000, 100 steps
```

Use current verified benchmark medians and checksums.

For the 4000² bundle verify:

```text
Serial: 14993.021 ms
OpenMP: 4209.511 ms
CUDA: 111.522 ms
MPI: 5362.650 ms
Checksum: 15495257518842739619
Preview: 500×500
Aggregation: 8×8
```

Do not commit large bundles unless their size is acceptable and needed for offline demo. Prefer Electron user-data plus one smaller bundled fallback.

**Verification:**

```bash
python scripts/verify_comparison_bundle.py results/live/comparison-500.json
python scripts/verify_comparison_bundle.py results/live/comparison-1000.json
python scripts/verify_comparison_bundle.py results/live/comparison-2000.json
python scripts/verify_comparison_bundle.py results/live/comparison-4000.json
```

---

### Task 16: Full regression and demo QA

**Objective:** Prove the comparison is correct, honest and presentation-ready.

Commands:

```bash
cmake --build build_verified --config Release --parallel
ctest --test-dir build_verified -C Release --output-on-failure
python scripts/verify_correctness.py --build-dir build_verified/Release
python scripts/verify_comparison_bundle.py results/live/comparison-4000.json

cd dashboard
node --test tests/electron/*.test.cjs
npm test -- --run
npm run build
npm run electron
```

Manual Electron QA:

1. Select 4000×4000/100 steps.
2. Generate Four-Backend Playback.
3. Confirm 2×2 panels show Serial/OpenMP/CUDA/MPI.
4. At time 0 all panels show step 0.
5. At ~200 ms CUDA is finished while others are not.
6. At ~4.3 seconds OpenMP is finished; MPI and Serial remain.
7. At ~5.4 seconds MPI is finished; Serial remains.
8. At ~15 seconds all are finished.
9. Confirm all four final frames/checksums match.
10. Confirm labels show 4000 source → 500 preview → 8×8 cells/pixel.
11. Confirm Reset returns to visible initial state.
12. Confirm old CUDA block/warp map is absent.
13. Confirm comparison generation does not add fake benchmark rows.
14. Confirm browser mode remains read-only.
15. Confirm no Electron/browser console errors.

Documentation:

- Create: `docs/four-backend-playback.md`
- Modify: `README.md`

Explain:

- isolated measurement then synchronized replay;
- sampled trace vs interpolation;
- majority-state aggregation;
- identical final output as correctness evidence;
- why concurrent benchmarking is invalid.

**Final commit:**

```bash
git add README.md docs dashboard scripts wildfire_common.hpp serial_wildfire.cpp openmp_wildfire.cpp cuda_wildfire.cu mpi_wildfire.cpp CMakeLists.txt
git commit -m "docs: verify four-backend time comparison"
```

---

## 11. Quality Gates

### Correctness

- matching workload only;
- four checksums equal;
- same canonical frame sequence used by all panels;
- final frame identical;
- progress never exceeds total steps;
- milestone timestamps monotonic.

### Timing honesty

- formal median durations from isolated benchmarks;
- trace mode excluded from formal timing;
- interpolated panels explicitly labeled;
- no simultaneous resource-contending benchmark runs;
- playback compression preserves relative finish ratios.

### Rendering

- maximum canonical Canvas 500×500;
- four panels do not allocate four source-sized grids;
- no DOM node per source pixel;
- 4000→500 majority aggregation;
- old representative map completely removed;
- Reset starts at elapsed 0.

### UX

A viewer can immediately answer:

- Which backend is currently furthest?
- Which backend finished first?
- At this wall-clock time, what timestep has each backend reached?
- Why do final fire results match?
- Is progress sampled or interpolated?
- How many source cells does one displayed pixel represent?

---

## 12. Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Four concurrent real runs distort timing | Run separately, replay together |
| CUDA finishes too quickly to see | Shared slowest-backend axis + pause/scrub + auto-compress |
| Linear interpolation oversimplifies per-step cost | Use sampled traces when available; label fallback clearly |
| Trace overhead changes duration | Use formal benchmark median for panel finish time |
| Four Canvas panels become heavy | Shared decoded frame cache and bounded 500 preview |
| Majority hides minority fire | Burning-first only on ties; show full burning counts |
| Final frame looks dark | initial cursor zero; explicit Reset; current-step label |
| Workload records mismatch | strict matching key validation |
| User thinks different panels use different rules | common checksum/canonical-frame banner |
| Large comparison bundle | 2-bit frames, shared sequence, sampled intervals |
| Old work map remains visible | delete component/CSS and enforce no-match search |

---

## 13. Definition of Done

- [ ] Four panels simultaneously show Serial, OpenMP, CUDA and MPI.
- [ ] One master elapsed-time cursor drives every panel.
- [ ] Each backend displays current timestep, progress, runtime and status.
- [ ] Faster backends finish and freeze while slower backends continue.
- [ ] Formal isolated benchmark medians determine finish times.
- [ ] Sampled traces are used where available; interpolation is labeled.
- [ ] All panels use the same deterministic canonical frame sequence.
- [ ] Final frames and checksums match across all four backends.
- [ ] 4000×4000 is majority-aggregated to maximum 500×500.
- [ ] One display pixel represents 8×8 source cells for 4000².
- [ ] Packed frames use 2-bit state encoding.
- [ ] Old ParallelWorkMap, CUDA blocks and warp lanes are removed.
- [ ] Electron offers Generate Four-Backend Playback.
- [ ] Comparison generation does not pollute formal benchmark records.
- [ ] Reset begins at elapsed time zero, not the dark final frame.
- [ ] React, Node, C++, correctness and production-build tests pass.
- [ ] A real 4000² comparison visibly demonstrates CUDA → OpenMP/MPI → Serial completion order based on measured times.
