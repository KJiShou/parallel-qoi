# Electron Live Benchmark Runner and Parallel Work Map Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** 在 Electron dashboard 内加入安全、可取消、可保存结果的 Run Benchmark 功能，并用 Parallel Work Map 清楚解释 Serial、OpenMP、CUDA、MPI 如何分配工作，而不是重复展示四个完全相同的 wildfire spread animation。

**Architecture:** React renderer 只负责配置、状态和展示；Electron preload 暴露最小化 IPC API；Electron main process 使用 `child_process.spawn(..., { shell: false })` 启动白名单 executable。真实 benchmark run 保持无 instrumentation，避免 progress logging 污染 runtime；Parallel Work Map 是独立的 educational visualization，显示算法的数据分配策略，并明确标注不是 CPU/GPU profiler 的实时 telemetry。运行结果保存在 Electron user-data 目录，验证 checksum 后合并进 dashboard 的 live results table。

**Tech Stack:** Electron IPC, Node.js `child_process`, React 19, TypeScript, C++17, OpenMP, CUDA, MS-MPI, JSON Lines event protocol, Vitest, Node test runner, CTest.

---

## 1. Key Design Decisions

### 1.1 Electron can run the executables, browser mode cannot

The button works only in Electron because normal browser React cannot execute local `.exe` files.

```text
React renderer
    ↓ validated IPC request
Electron preload
    ↓ narrow contextBridge API
Electron main process
    ↓ spawn(shell: false)
Serial / OpenMP / CUDA / mpiexec + MPI executable
    ↓ JSON result file + status events
Electron main process
    ↓ validated run events/result
React renderer
```

When the same dashboard is opened through Vite/browser, the UI must show:

```text
Live execution is available in the Electron desktop app.
```

It must not expose a broken Run button.

### 1.2 The identical fire spread is expected

Serial, OpenMP, CUDA and MPI intentionally use:

- the same initial grid;
- the same seed;
- the same cellular automata rules;
- the same timestep count;
- deterministic double buffering.

Therefore, their visual fire spread should match. A different fire animation would normally indicate a correctness bug.

The comparison value is:

- runtime;
- speedup;
- efficiency;
- scalability;
- thread/process/block work distribution;
- communication and synchronization overhead.

### 1.3 Do not instrument the timed benchmark loop

Printing the active thread/process at every timestep would distort performance, especially for OpenMP/CUDA.

Implement two distinct modes:

| Mode | Purpose | Instrumentation | Included in benchmark timing? |
|---|---|---|---|
| `benchmark` | Produce runtime/result | No per-step trace | Yes |
| `explain` | Show work assignment | Static/untimed mapping metadata | No |

The UI must never label the work map as actual real-time hardware utilization.

---

## 2. Recommended UI

### Configuration and run panel

```text
┌ Run a New Experiment ─────────────────────────────────────────────┐
│ Backend       [OpenMP ▼]                                         │
│ Grid          [1000 × 1000 ▼]                                    │
│ Timesteps     [100 ▼]                                            │
│ Density       [70% ▼]                                            │
│ Seed          [42]                                                │
│ Threads       [4 ▼]        ← OpenMP only                          │
│ Processes     [4 ▼]        ← MPI only                             │
│ Block size    [256 ▼]      ← CUDA only                            │
│ Repetitions   [3 ▼]                                             │
│                                                                  │
│ [Run Benchmark] [Cancel]  Status: Running CUDA 2/3 repetitions    │
└──────────────────────────────────────────────────────────────────┘
```

### Tabs beneath the configuration

```text
[Result & Performance] [Fire Spread] [Parallel Work Map] [Run Log]
```

#### Result & Performance

- median, mean and standard deviation;
- speedup against matching Serial baseline;
- OpenMP/MPI efficiency;
- burned cells/percentage;
- checksum and correctness badge;
- raw timing samples.

#### Fire Spread

Use one canonical deterministic preview. When switching backend, keep the same fire frames and display:

```text
Expected identical output — this validates cross-backend correctness.
```

#### Parallel Work Map

Display backend-specific strategy:

- Serial: one scan band progressing over rows;
- OpenMP: row bands colored by thread ownership;
- MPI: process partitions, two ghost rows and animated halo exchange arrows;
- CUDA: grid divided into CUDA blocks; selected block expands to show thread-to-cell mapping.

#### Run Log

- start time;
- validated command summary without unsafe raw command editing;
- stdout/stderr lines;
- exit code;
- output JSON path;
- validation messages.

---

## 3. Backend-Specific Work Map

### 3.1 Serial

```text
Single CPU thread
┌────────────────────┐
│ completed rows      │
├────────────────────┤
│ current scan row →  │
├────────────────────┤
│ pending rows        │
└────────────────────┘
```

Display concept: sequential row scan. Do not animate every actual cell for large grids.

### 3.2 OpenMP

Current implementation uses:

```cpp
#pragma omp parallel for schedule(static)
```

With static scheduling, show deterministic row-band ownership:

```text
Thread 0 → rows 0–249
Thread 1 → rows 250–499
Thread 2 → rows 500–749
Thread 3 → rows 750–999
```

For uneven row counts, use the same static partition logic as the executable/compiler model and state that exact chunk assignment may depend on OpenMP runtime rules if chunk size is not explicitly set.

Recommended improvement for explainability:

```cpp
#pragma omp parallel for schedule(static, calculatedChunk)
```

Only adopt an explicit chunk if performance/correctness tests confirm it does not harm the implementation. Otherwise, label the map as an illustrative static ownership model.

### 3.3 MPI

Show exact row partitions from the same `counts` and `displs` logic used by `MPI_Scatterv`:

```text
Rank 0 rows + bottom ghost exchange
Rank 1 top/bottom ghost exchange
Rank 2 top/bottom ghost exchange
Rank 3 top ghost exchange
```

Animate only two events per timestep:

1. halo exchange;
2. local compute.

This directly supports explanation of:

- SPMD;
- distributed memory;
- ghost rows;
- `MPI_Sendrecv`;
- communication overhead.

### 3.4 CUDA

Do not attempt to display millions of actual GPU threads as icons.

Show:

```text
Source grid
    ↓ flattened cell index
CUDA grid of blocks
    ↓ select one block
Block 256 threads
    ↓ threadIdx.x maps to cell index
```

Display:

- total cells;
- block size;
- total block count;
- final partial block utilization;
- one selected block with up to 32 representative warp lanes;
- note that actual execution order/SM scheduling requires NVIDIA profiling tools and is not represented by the educational map.

Formula:

```text
totalCells = rows × cols
blocks = ceil(totalCells / blockSize)
cellIndex = blockIdx.x × blockDim.x + threadIdx.x
```

---

## 4. Run Configuration Contract

```ts
export type RunConfig = {
  backend: 'serial' | 'openmp' | 'cuda' | 'mpi';
  rows: 500 | 1000 | 2000 | 4000;
  cols: 500 | 1000 | 2000 | 4000;
  steps: 100 | 500 | 1000;
  density: 0.6 | 0.7 | 0.8;
  seed: number;
  repetitions: 1 | 3 | 5;
  threads?: 1 | 2 | 4 | 8 | 16;
  processes?: 1 | 2 | 4 | 8;
  blockSize?: 128 | 256 | 512 | 1024;
};
```

Validation rules:

- rows must equal cols;
- only listed sizes are accepted;
- ignition defaults to grid centre;
- OpenMP requires `threads`;
- MPI requires `processes` and `processes <= rows`;
- CUDA requires `blockSize`;
- CUDA 1024 is enabled only when `cudaGetDeviceProperties().maxThreadsPerBlock >= 1024` and the executable accepts it;
- paths are selected internally, never supplied by the renderer;
- output paths are generated internally using UUID/timestamp;
- only one benchmark job runs at a time initially.

---

## 5. IPC Contract

### Preload API

```ts
export type WildfireDesktopApi = {
  getCapabilities(): Promise<Capabilities>;
  startRun(config: RunConfig): Promise<{ runId: string }>;
  cancelRun(runId: string): Promise<void>;
  listRuns(): Promise<RunSummary[]>;
  readRun(runId: string): Promise<RunResult>;
  onRunEvent(listener: (event: RunEvent) => void): () => void;
};
```

Expose through:

```js
contextBridge.exposeInMainWorld('wildfireDesktop', {
  getCapabilities: () => ipcRenderer.invoke('wildfire:get-capabilities'),
  startRun: config => ipcRenderer.invoke('wildfire:start-run', config),
  cancelRun: runId => ipcRenderer.invoke('wildfire:cancel-run', runId),
  listRuns: () => ipcRenderer.invoke('wildfire:list-runs'),
  readRun: runId => ipcRenderer.invoke('wildfire:read-run', runId),
  onRunEvent: listener => {
    const wrapped = (_event, payload) => listener(payload);
    ipcRenderer.on('wildfire:run-event', wrapped);
    return () => ipcRenderer.removeListener('wildfire:run-event', wrapped);
  }
});
```

Do not expose `ipcRenderer`, `child_process`, filesystem APIs or arbitrary command execution.

### Run events

```ts
export type RunEvent =
  | { type: 'queued'; runId: string }
  | { type: 'started'; runId: string; backend: string; startedAt: string }
  | { type: 'log'; runId: string; stream: 'stdout' | 'stderr'; line: string }
  | { type: 'completed'; runId: string; result: RunResult }
  | { type: 'failed'; runId: string; message: string; exitCode?: number }
  | { type: 'cancelled'; runId: string };
```

Do not claim percentage progress unless the executable emits reliable structured progress. Initially show elapsed time and current phase:

```text
Preparing → Running → Validating → Saving → Completed
```

---

## 6. Safe Process Launching

Executable map inside Electron main:

```js
const EXECUTABLES = {
  serial: 'wildfire_serial.exe',
  openmp: 'wildfire_openmp.exe',
  cuda: 'wildfire_cuda.exe',
  mpi: 'wildfire_mpi.exe'
};
```

Commands are constructed as argument arrays:

```js
spawn(serialExe, ['--rows', '1000', '--cols', '1000', ...], {
  shell: false,
  windowsHide: true
});
```

MPI:

```js
spawn(mpiexecPath, ['-n', '4', mpiExe, '--rows', '1000', ...], {
  shell: false,
  windowsHide: true
});
```

Never create one shell command string and never accept arbitrary executable paths or arguments from the renderer.

### Cancellation

On Windows:

1. try `child.kill()`;
2. if the process tree remains, run internally constructed `taskkill /PID <pid> /T /F`;
3. mark run as cancelled, not failed;
4. remove incomplete temporary output;
5. keep a cancellation log entry.

---

## 7. Result Storage

Use:

```text
app.getPath('userData')/
  wildfire-runs/
    index.json
    <run-id>/
      config.json
      result.json
      stdout.log
      stderr.log
```

`result.json` keeps the existing backend output plus:

```json
{
  "runId": "...",
  "createdAt": "...",
  "status": "completed",
  "config": { "backend": "openmp", "rows": 1000 },
  "result": { "runtimeMs": {}, "checksum": "..." },
  "validation": {
    "serialBaselineFound": true,
    "checksumMatch": true,
    "speedup": 3.44,
    "efficiency": 0.86
  }
}
```

A run is compared only with a Serial baseline that matches:

- rows/cols;
- timesteps;
- density;
- seed;
- ignition point;
- repetitions/timing scope where applicable.

If no matching Serial baseline exists, display:

```text
Speedup pending — run the matching Serial baseline first.
```

Do not compare against a different workload.

---

## 8. Target File Structure

```text
dashboard/
  electron/
    main.cjs
    preload.cjs
    runner/
      capabilities.cjs
      configValidator.cjs
      commandBuilder.cjs
      runStore.cjs
      runManager.cjs
      resultValidator.cjs
  src/
    App.tsx
    global.d.ts
    types.ts
    desktop/
      api.ts
      runTypes.ts
      useLiveRun.ts
      useRunHistory.ts
    components/
      LiveRunPanel.tsx
      RunConfigurationForm.tsx
      RunStatus.tsx
      RunLog.tsx
      RunResultCards.tsx
      ParallelWorkMap.tsx
      SerialWorkMap.tsx
      OpenMPWorkMap.tsx
      MPIWorkMap.tsx
      CUDAWorkMap.tsx
      OutputCorrectnessBanner.tsx
    tests/
      RunConfigurationForm.test.tsx
      ParallelWorkMap.test.tsx
      useLiveRun.test.tsx
  tests/
    electron/
      configValidator.test.cjs
      commandBuilder.test.cjs
      runStore.test.cjs
      runManager.integration.test.cjs
      fixtures/
        fake-backend-success.cjs
        fake-backend-failure.cjs
wildfire_common.hpp
openmp_wildfire.cpp
mpi_wildfire.cpp
cuda_wildfire.cu
README.md
docs/
  live-run-demo-guide.md
  parallel-work-map-explanation.md
```

---

## 9. Step-by-Step Implementation Plan

### Task 1: Define and validate live-run configuration

**Objective:** Reject invalid or unsafe renderer requests before any process starts.

**Files:**

- Create: `dashboard/electron/runner/configValidator.cjs`
- Create: `dashboard/tests/electron/configValidator.test.cjs`
- Create: `dashboard/src/desktop/runTypes.ts`

**Step 1: Write failing tests**

Test:

- valid Serial/OpenMP/CUDA/MPI configs;
- invalid grid/timestep/density;
- missing backend-specific setting;
- unknown fields/executable path attempts;
- CUDA 1024 disabled without capability;
- non-integer seed/repetitions;
- rows different from cols.

**Step 2: Verify RED**

```bash
cd dashboard
node --test tests/electron/configValidator.test.cjs
```

Expected: FAIL because validator does not exist.

**Step 3: Implement whitelist validation**

Return a normalized frozen config; do not pass renderer objects directly to `spawn`.

**Step 4: Verify GREEN**

```bash
node --test tests/electron/configValidator.test.cjs
```

**Step 5: Commit**

```bash
git add dashboard/electron/runner/configValidator.cjs dashboard/tests/electron/configValidator.test.cjs dashboard/src/desktop/runTypes.ts
git commit -m "feat: validate live benchmark configurations"
```

---

### Task 2: Build commands from trusted paths and argument arrays

**Objective:** Construct backend commands without shell injection or renderer-controlled paths.

**Files:**

- Create: `dashboard/electron/runner/capabilities.cjs`
- Create: `dashboard/electron/runner/commandBuilder.cjs`
- Create: `dashboard/tests/electron/commandBuilder.test.cjs`

**Step 1: Write failing tests**

Assert exact command arrays for:

- Serial;
- OpenMP with `--threads`;
- CUDA with `--block-size`;
- MPI with `mpiexec -n`;
- generated output path;
- `shell: false` launch options.

Test that strings containing `&`, `|`, `;`, quotes or paths never enter arguments except generated trusted paths.

**Step 2: Implement capability detection**

Detect:

- executable directory;
- `mpiexec` availability;
- CUDA executable/device availability;
- supported CUDA block sizes;
- write access to runs directory.

**Step 3: Verify**

```bash
node --test tests/electron/commandBuilder.test.cjs
```

**Step 4: Commit**

```bash
git add dashboard/electron/runner dashboard/tests/electron
git commit -m "feat: build safe backend launch commands"
```

---

### Task 3: Implement durable run storage

**Objective:** Preserve completed run results and logs across Electron sessions.

**Files:**

- Create: `dashboard/electron/runner/runStore.cjs`
- Create: `dashboard/tests/electron/runStore.test.cjs`

**Step 1: Write failing tests**

Test:

- create run directory;
- atomic write of config/result/index;
- list newest runs first;
- reject invalid run IDs/path traversal;
- recover from missing/corrupt index using run directories;
- incomplete run remains marked interrupted after restart.

**Step 2: Implement using temporary file + rename**

Do not partially overwrite `index.json`.

**Step 3: Verify and commit**

```bash
node --test tests/electron/runStore.test.cjs
git add dashboard/electron/runner/runStore.cjs dashboard/tests/electron/runStore.test.cjs
git commit -m "feat: persist Electron benchmark runs"
```

---

### Task 4: Implement process lifecycle and cancellation

**Objective:** Start one benchmark at a time, stream logs, validate output and cancel safely.

**Files:**

- Create: `dashboard/electron/runner/runManager.cjs`
- Create: `dashboard/electron/runner/resultValidator.cjs`
- Create: `dashboard/tests/electron/runManager.integration.test.cjs`
- Create: `dashboard/tests/electron/fixtures/fake-backend-success.cjs`
- Create: `dashboard/tests/electron/fixtures/fake-backend-failure.cjs`

**Step 1: Write integration tests with fake executables**

Test:

- started/log/completed event order;
- non-zero exit produces failed event;
- malformed/missing result JSON fails validation;
- cancellation terminates process and removes temp output;
- second concurrent job is rejected;
- long stdout line cannot crash the app;
- Electron window closing cancels active job.

**Step 2: Implement RunManager**

Use line-buffered stdout/stderr, bounded in-memory logs and full logs on disk.

**Step 3: Validate result JSON**

Require backend, dimensions, timing samples, burned cells and checksum.

**Step 4: Verify and commit**

```bash
node --test tests/electron/runManager.integration.test.cjs
git add dashboard/electron/runner dashboard/tests/electron
git commit -m "feat: manage live benchmark processes"
```

---

### Task 5: Wire secure Electron IPC and preload bridge

**Objective:** Expose only the required runner methods to React.

**Files:**

- Modify: `dashboard/electron/main.cjs`
- Modify: `dashboard/electron/preload.cjs`
- Create: `dashboard/src/global.d.ts`
- Create: `dashboard/src/desktop/api.ts`

**Step 1: Write a preload/API contract test**

Verify that exposed keys are exactly:

```text
getCapabilities
startRun
cancelRun
listRuns
readRun
onRunEvent
```

No raw IPC or filesystem function may be exposed.

**Step 2: Register `ipcMain.handle` methods**

Validate sender/window, config and run ID on every request.

**Step 3: Preserve Electron security**

Keep:

```text
contextIsolation: true
sandbox: true
nodeIntegration: false
```

If sandbox prevents the preload bridge in the chosen Electron version, resolve with a narrowly scoped preload-compatible configuration and document it; never enable renderer Node integration.

**Step 4: Verify and commit**

```bash
node --test tests/electron/*.test.cjs
npm run build
git add dashboard/electron dashboard/src/global.d.ts dashboard/src/desktop
git commit -m "feat: expose secure benchmark runner IPC"
```

---

### Task 6: Build the conditional Run Configuration form

**Objective:** Let users select valid experiment settings without seeing irrelevant controls.

**Files:**

- Create: `dashboard/src/components/RunConfigurationForm.tsx`
- Create: `dashboard/src/components/LiveRunPanel.tsx`
- Create: `dashboard/src/tests/RunConfigurationForm.test.tsx`
- Modify: `dashboard/src/App.tsx`

**Behavior tests:**

- Serial shows no worker field;
- OpenMP shows thread count;
- MPI shows process count;
- CUDA shows block size;
- options follow proposal values;
- CUDA 1024 disabled if capability is absent;
- Run disabled while invalid/running/browser-only;
- Cancel visible only during an active run;
- form values survive tab switches but reset after explicit Reset.

**Verification:**

```bash
npm test -- --run src/tests/RunConfigurationForm.test.tsx
npm run build
```

**Commit:**

```bash
git add dashboard/src/components dashboard/src/App.tsx dashboard/src/tests
git commit -m "feat: add Electron benchmark run form"
```

---

### Task 7: Display run status, phases and logs

**Objective:** Give useful feedback without fake progress percentages.

**Files:**

- Create: `dashboard/src/desktop/useLiveRun.ts`
- Create: `dashboard/src/components/RunStatus.tsx`
- Create: `dashboard/src/components/RunLog.tsx`
- Create: `dashboard/src/tests/useLiveRun.test.tsx`

**Phases:**

```text
Queued → Preparing → Running → Validating → Saving → Completed
```

Display elapsed time using renderer timer, not backend timing.

**Tests:**

- event order updates state;
- stale run events ignored;
- cancel state handled;
- failed run shows stderr summary;
- unmount removes IPC listener;
- log display is capped/virtualized.

**Commit:**

```bash
git add dashboard/src/desktop dashboard/src/components dashboard/src/tests
git commit -m "feat: show live benchmark status and logs"
```

---

### Task 8: Validate results against matching Serial baseline

**Objective:** Calculate speedup/efficiency only for comparable workloads.

**Files:**

- Modify: `dashboard/electron/runner/resultValidator.cjs`
- Create: `dashboard/src/components/RunResultCards.tsx`
- Create: `dashboard/src/components/OutputCorrectnessBanner.tsx`
- Create: `dashboard/src/tests/RunResultCards.test.tsx`

**Matching key:**

```text
rows|cols|steps|density|seed|ignitionRow|ignitionCol
```

**Tests:**

- matching Serial baseline calculates speedup;
- non-matching seed/density/steps does not compare;
- OpenMP/MPI efficiency uses worker count;
- CUDA efficiency remains N/A;
- checksum mismatch produces red warning;
- missing baseline produces pending state.

**Commit:**

```bash
git add dashboard/electron/runner/resultValidator.cjs dashboard/src/components dashboard/src/tests
git commit -m "feat: validate live results against serial baseline"
```

---

### Task 9: Build the Parallel Work Map framework

**Objective:** Replace redundant backend fire animations with an educational parallelization view.

**Files:**

- Create: `dashboard/src/components/ParallelWorkMap.tsx`
- Create: `dashboard/src/components/SerialWorkMap.tsx`
- Create: `dashboard/src/components/OpenMPWorkMap.tsx`
- Create: `dashboard/src/components/MPIWorkMap.tsx`
- Create: `dashboard/src/components/CUDAWorkMap.tsx`
- Create: `dashboard/src/tests/ParallelWorkMap.test.tsx`

**Common requirements:**

- source grid size label;
- backend-specific legend;
- work-unit count;
- animation play/pause independent from fire animation;
- `Illustrative work assignment — not live profiler telemetry` label;
- reduced-motion support;
- bounded DOM/Canvas elements regardless grid size.

**Verification:**

```bash
npm test -- --run src/tests/ParallelWorkMap.test.tsx
npm run build
```

**Commit:**

```bash
git add dashboard/src/components dashboard/src/tests/ParallelWorkMap.test.tsx
git commit -m "feat: add parallel work map framework"
```

---

### Task 10: Implement OpenMP thread ownership map

**Objective:** Show how static loop iterations are divided among CPU threads.

**Files:**

- Modify: `dashboard/src/components/OpenMPWorkMap.tsx`
- Create: `dashboard/src/lib/openmpPartition.ts`
- Create: `dashboard/src/lib/openmpPartition.test.ts`

**Display:**

- one colored row band per thread;
- thread labels `T0..T15`;
- animated per-band compute pulse;
- barrier phase at timestep end;
- note explaining shared `current_grid`, shared `next_grid`, unique output cells and implicit barrier.

**Tests:**

- every row is assigned exactly once;
- uneven rows handled;
- no band exceeds grid bounds;
- maximum 16 visual bands;
- barrier appears only after compute phase.

**Commit:**

```bash
git add dashboard/src/components/OpenMPWorkMap.tsx dashboard/src/lib
git commit -m "feat: visualize OpenMP thread ownership"
```

---

### Task 11: Implement exact MPI partition and halo map

**Objective:** Show actual `Scatterv/Gatherv` row counts and ghost-row communication.

**Files:**

- Modify: `dashboard/src/components/MPIWorkMap.tsx`
- Create: `dashboard/src/lib/mpiPartition.ts`
- Create: `dashboard/src/lib/mpiPartition.test.ts`

**Use the same formula as C++:**

```ts
base = rows / processes;
extra = rows % processes;
localRows[rank] = base + (rank < extra ? 1 : 0);
```

**Display phases:**

1. Scatter partitions;
2. top/bottom halo exchange arrows;
3. local compute glow;
4. buffer swap;
5. final Gather.

**Tests:**

- counts/displacements match C++ for divisible/uneven rows;
- rank 0 has no upper neighbor;
- last rank has no lower neighbor;
- interior ranks show two exchanges;
- maximum 8 process bands.

**Commit:**

```bash
git add dashboard/src/components/MPIWorkMap.tsx dashboard/src/lib
git commit -m "feat: visualize MPI partitions and halo exchange"
```

---

### Task 12: Implement CUDA block/thread mapping map

**Objective:** Explain GPU mapping without pretending to show actual SM scheduling.

**Files:**

- Modify: `dashboard/src/components/CUDAWorkMap.tsx`
- Create: `dashboard/src/lib/cudaMapping.ts`
- Create: `dashboard/src/lib/cudaMapping.test.ts`

**Display:**

- total blocks;
- block size;
- total logical threads;
- inactive threads in last block;
- selectable representative block;
- 32-lane warp preview instead of hundreds of icons;
- formula card.

**Tests:**

- block count uses ceiling division;
- last-block active/inactive count correct;
- 1024 disabled if unsupported;
- displayed lane count remains bounded at 32;
- UI contains profiler disclaimer.

**Commit:**

```bash
git add dashboard/src/components/CUDAWorkMap.tsx dashboard/src/lib
git commit -m "feat: visualize CUDA block and thread mapping"
```

---

### Task 13: Integrate live runs into table and charts

**Objective:** Make completed Electron runs immediately visible without modifying bundled static data.

**Files:**

- Create: `dashboard/src/desktop/useRunHistory.ts`
- Modify: `dashboard/src/App.tsx`
- Modify: benchmark table/chart components after refactor
- Create: `dashboard/src/tests/useRunHistory.test.tsx`

**Rules:**

- bundled benchmark data is read-only;
- live runs are a separate data source;
- deduplicate by run ID, never overwrite static evidence;
- allow filters `Bundled`, `Live`, `All`;
- mark live rows with `LOCAL RUN` badge;
- export selected live runs to JSON/CSV through a controlled Electron API if needed;
- failed/cancelled runs never enter performance charts.

**Commit:**

```bash
git add dashboard/src/desktop dashboard/src/App.tsx dashboard/src/tests
git commit -m "feat: merge completed live runs into dashboard"
```

---

### Task 14: Add Electron production and clean-clone verification

**Objective:** Prove the Run button works in packaged/local production conditions.

**Files:**

- Modify: `dashboard/package.json`
- Create: `dashboard/scripts/verify-runner.cjs`
- Modify: `README.md`
- Create: `docs/live-run-demo-guide.md`
- Create: `docs/parallel-work-map-explanation.md`

**Verification sequence:**

```bash
cmake -S . -B build_verified -G "Visual Studio 17 2022" -A x64
cmake --build build_verified --config Release --parallel
python scripts/verify_correctness.py --build-dir build_verified/Release

cd dashboard
node --test tests/electron/*.test.cjs
npm test -- --run
npm run build
npm run electron
```

Manual Electron checks:

1. Run Serial 500²/100 steps.
2. Run OpenMP 500²/100 steps/4 threads.
3. Confirm checksum match and speedup.
4. Run MPI with 4 processes.
5. Run CUDA block 256.
6. Cancel a long 4000² Serial run.
7. Restart Electron and verify completed history remains.
8. Switch between Fire Spread and Parallel Work Map.
9. Verify browser/Vite mode disables live execution.
10. Confirm no renderer console errors and no arbitrary command execution path.

**Commit:**

```bash
git add dashboard README.md docs
git commit -m "docs: verify Electron live benchmark workflow"
```

---

## 10. Tests and Quality Gates

### Security gate

- renderer cannot set executable path;
- renderer cannot inject command fragments;
- `shell` is always false;
- preload exposes only six methods;
- run IDs reject traversal;
- one job at a time;
- output size/log memory bounded.

### Correctness gate

- live result checksum compared only to matching Serial config;
- existing cross-backend correctness script still passes;
- work maps do not modify simulation output;
- explain mode is excluded from benchmark timing.

### Usability gate

A first-time user can:

1. choose backend and workload;
2. understand which worker control applies;
3. run/cancel safely;
4. see completion/failure reason;
5. understand why fire output matches;
6. explain OpenMP/MPI/CUDA mapping using the work map.

### Performance gate

- no unbounded icons/elements;
- logs virtualized/capped;
- work map operations bounded by workers/processes/32 warp lanes, not source cells;
- UI remains responsive during a 4000² child process run.

---

## 11. Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Live CUDA/MPI fails during presentation | Keep bundled verified results and precomputed demo fallback |
| Per-step trace distorts benchmark | Separate benchmark and explain modes |
| User interprets map as real profiler | Persistent disclaimer: illustrative work assignment |
| Arbitrary command injection | whitelist config + internal executable map + `shell:false` |
| Multiple heavy runs freeze machine | one-job queue, cancel support, capability/preflight check |
| MPI child processes remain after cancel | process-tree termination and cancellation integration test |
| No matching Serial baseline | show speedup pending, offer Run matching Serial action |
| Fire animations look identical | explain this as correctness evidence; use work map for differences |
| CUDA 1024 unsupported | detect device capability and disable option |
| Live results disappear | durable user-data run store |
| Static and live rows become confused | separate source badge/filter |

---

## 12. Recommended Implementation Scope

### Required first release

- Run button;
- Serial/OpenMP/CUDA/MPI command launching;
- config validation;
- run status/log/cancel;
- persistent result history;
- matching Serial baseline validation;
- OpenMP/MPI/CUDA/Serial work maps;
- static bundled fallback.

### Optional after first release

- queued multiple runs;
- exported CSV through Electron;
- NVIDIA Nsight/profiler integration;
- live CPU/GPU utilization charts;
- OS hardware telemetry;
- automatic full experiment-matrix scheduler.

Do not add profiler integration before the secure single-run workflow is stable.

---

## 13. Definition of Done

- [ ] Run Benchmark button is available in Electron and disabled in browser mode.
- [ ] Renderer cannot execute arbitrary commands or choose executable paths.
- [ ] Serial/OpenMP/CUDA/MPI runs launch with validated argument arrays.
- [ ] Backend-specific controls appear conditionally.
- [ ] Active run can be cancelled, including MPI process tree.
- [ ] Completed result persists across Electron restart.
- [ ] Result is validated against matching Serial baseline only.
- [ ] Live rows appear in table/charts with `LOCAL RUN` label.
- [ ] Identical fire output is explained as correctness evidence.
- [ ] Parallel Work Map has Serial/OpenMP/MPI/CUDA views.
- [ ] OpenMP map shows bounded thread row bands and barrier.
- [ ] MPI map shows exact partitions, ghost rows and halo exchange.
- [ ] CUDA map shows blocks, representative warp lanes and mapping formula.
- [ ] Every work map states that it is not live profiler telemetry.
- [ ] Benchmark timing excludes explain/trace visualization.
- [ ] Bundled verified results remain available if live execution fails.
- [ ] Electron tests, React tests, build and backend correctness all pass.
