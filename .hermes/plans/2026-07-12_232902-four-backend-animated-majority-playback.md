# Four-Backend Animated Majority Playback Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Replace the current separate progress cards and single wildfire preview with four simultaneous backend panels—Serial, OpenMP, CUDA, and MPI—where each panel combines progress and wildfire animation at the same elapsed-time position. The user selects only source grid, density, and which methods to run; every preview remains a 500×500 majority-compressed canvas.

**Architecture:** A selected run executes each checked backend sequentially so timings remain isolated. Before those timed runs, the desktop runner creates one canonical visualization trace for the exact selected grid/density/seed/100-step workload; it is a deterministic source sequence shared by all panels, not a fake different simulation. The UI replays the shared trace four times against one elapsed-time axis, but each panel maps the same elapsed time to its own measured median duration. Thus CUDA can be at the final frame while Serial is still at an early frame. For source grids above 500×500, each fixed preview pixel represents a source tile and uses a deterministic majority state.

**Tech Stack:** C++17 wildfire executables; Electron main/preload IPC; React + TypeScript + Canvas 2D; Vitest; Node `node:test`; compact 2-bit Base64 frame codec.

---

## Product decisions and acceptance criteria

### Fixed controls

The runner must expose only:

```text
Source grid: 500×500 | 1000×1000 | 2000×2000 | 4000×4000
Density:     60% | 70% | 80%
Methods:     ☑ Serial  ☑ OpenMP  ☑ CUDA  ☑ MPI
```

Use fixed, visible constants rather than controls:

```text
steps       = 100
repetitions = 3
seed        = 42
OpenMP      = 4 threads
MPI         = 4 processes
CUDA        = block size 256
preview     = 500×500 pixels
```

The UI must state the fixed benchmark settings in compact text. Do not render selectors for Steps, Repetitions, individual backend, experiment grid, benchmark grid, or chart.

### Run behavior

- Require at least one checked method.
- `Run selected methods` collects every checked method automatically in the deterministic order `Serial → OpenMP → CUDA → MPI`.
- Runs are sequential, never concurrently; this is required for comparable CPU/GPU timings.
- CUDA must be independently uncheckable. If its executable/preflight is unavailable, disable it with a reason and allow the other selected methods to run.
- Collection progress uses `completed / selected`, not hard-coded `/ 4`.
- A failure is represented in the affected panel; the queue continues to the next selected method.
- Each successful result persists through the existing Electron run store.

### Playback behavior

- Render a 2×2 panel grid for the selected methods, with an explicit empty/disabled placeholder only for unselected methods; do not hide the method identity.
- Every visible panel includes: backend name, real median runtime, status, `Step N / 100`, percentage progress, a bounded Canvas wildfire animation, and its colored progress bar.
- One master elapsed-time slider runs from `0` to the slowest selected successful median. Play/pause/reset control all panels.
- At master time `t`, a method with median duration `d` has `progress = clamp(t / d, 0, 1)` and frame step `floor(progress × 100)` snapped to the trace's recorded frame interval.
- When a faster backend reaches its duration it stays on the completed final frame while slower backends keep advancing.
- Label this truthfully as `Shared deterministic fire trace · progress positioned by isolated median runtime`; do not call it physical GPU/CPU telemetry.
- When a requested grid/density trace does not exist yet, the UI shows `Preparing compressed trace…`, not a stale scenario or invented frame.

### Fixed 500×500 preview rule

| Selected source grid | Canvas dimensions | Source cells per displayed pixel |
|---:|---:|---:|
| 500×500 | 500×500 | 1×1 exact state |
| 1000×1000 | 500×500 | 2×2 majority state |
| 2000×2000 | 500×500 | 4×4 majority state |
| 4000×4000 | 500×500 | 8×8 majority state |

For every preview bin, count `EMPTY`, `TREE`, `BURNING`, and `BURNED`. Use the most frequent state. Resolve an exact tie with this fixed order so an active fire front is preserved:

```text
BURNING > BURNED > TREE > EMPTY
```

The UI must state both source resolution and aggregation, e.g.:

```text
Source: 4000×4000 · Display: 500×500 · 8×8 cells/pixel · majority-state
```

---

### Task 1: Document the new data contract in TypeScript

**Objective:** Replace the old scenario-only frame assumption with a typed live playback bundle that can represent selected methods, a canonical compressed trace, and collected results.

**Files:**
- Modify: `dashboard/src/types.ts`
- Create: `dashboard/src/playbackTypes.test.ts`

**Step 1: Write failing contract tests**

```ts
import { describe, expect, it } from 'vitest';
import { validatePlaybackBundle } from './playbackTypes';

it('accepts a 4000 source grid with a fixed 500 preview and 8×8 aggregation', () => {
  expect(validatePlaybackBundle({
    schemaVersion: 2,
    sourceRows: 4000,
    sourceCols: 4000,
    previewRows: 500,
    previewCols: 500,
    aggregationRows: 8,
    aggregationCols: 8,
    steps: 100,
    density: 0.7,
    frames: [{ step: 0, cells2BitBase64: 'AAAA' }],
  }).valid).toBe(true);
});
```

**Step 2: Run the test to verify failure**

Run:

```bash
cd dashboard && npm run test:run -- playbackTypes.test.ts
```

Expected: FAIL because `validatePlaybackBundle` and the live playback types do not exist.

**Step 3: Add minimal types and validation**

Add exact exported shapes:

```ts
export type PlaybackFrame = { step: number; cells2BitBase64: string };
export type PlaybackBundle = {
  schemaVersion: 2;
  sourceRows: number; sourceCols: number;
  previewRows: 500; previewCols: 500;
  aggregationRows: number; aggregationCols: number;
  steps: 100; density: number; seed: number;
  frames: PlaybackFrame[];
};
export type MethodStatus = 'unselected' | 'pending' | 'preparing-trace' | 'running' | 'complete' | 'failed' | 'unavailable';
```

Validation must reject non-500 preview dimensions, invalid aggregation, duplicate/non-monotonic steps, and no frames.

**Step 4: Run the test to verify pass**

Run:

```bash
cd dashboard && npm run test:run -- playbackTypes.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add dashboard/src/types.ts dashboard/src/playbackTypes.test.ts
git commit -m "feat: add compressed playback bundle types"
```

---

### Task 2: Add majority-state aggregation unit tests in C++

**Objective:** Make the 500×500 display rule deterministic and testable independent of any UI.

**Files:**
- Modify: `wildfire_common.hpp`
- Create: `tests/majority_preview_test.cpp`
- Modify: `CMakeLists.txt` or the current test build target where C++ tests are registered

**Step 1: Write failing tests**

```cpp
TEST(MajorityPreview, PicksMostFrequentStateInTwoByTwoTile) {
  std::vector<int> source = {TREE, TREE, EMPTY, BURNING};
  EXPECT_EQ(wildfire::aggregateTileMajority(source, 0, 0, 2, 2, 2, 2), TREE);
}

TEST(MajorityPreview, PreservesBurningOnAnExactTie) {
  std::vector<int> source = {TREE, BURNING, EMPTY, BURNED};
  EXPECT_EQ(wildfire::aggregateTileMajority(source, 0, 0, 2, 2, 2, 2), BURNING);
}
```

**Step 2: Run to verify failure**

Run the project’s existing C++ test target (determine the exact command from `CMakeLists.txt`; do not create a second test framework).

Expected: compile failure because `aggregateTileMajority` does not exist.

**Step 3: Implement a reusable aggregator**

In `wildfire_common.hpp`, add:

```cpp
inline int choosePreviewState(const std::array<int, 4>& counts) {
    constexpr int priority[] = {BURNING, BURNED, TREE, EMPTY};
    int best = EMPTY;
    for (int state : priority)
        if (counts[state] > counts[best] || (counts[state] == counts[best] && state == BURNING)) best = state;
    return best;
}
```

Implement `aggregatePreview500(const std::vector<int>& source, const SimulationConfig&)` which:

- derives aggregation as `rows / 500` and validates an exact divisor for supported grids;
- counts all states for each bin;
- emits exactly 250,000 states;
- does not allocate a second full-resolution grid.

Correct the tie implementation if needed so the explicit priority order—not array position—is the deciding rule.

**Step 4: Run the C++ tests**

Expected: all existing and new C++ tests PASS.

**Step 5: Commit**

```bash
git add wildfire_common.hpp tests/majority_preview_test.cpp CMakeLists.txt
git commit -m "feat: add deterministic majority preview aggregation"
```

---

### Task 3: Add compact 2-bit encoding tests

**Objective:** Ensure a 500×500 frame is stored compactly instead of as a massive JSON integer array.

**Files:**
- Modify: `wildfire_common.hpp`
- Create: `tests/preview_codec_test.cpp`
- Modify: `dashboard/src/frameCodec.ts`
- Modify: `dashboard/src/frameCodec.test.ts`

**Step 1: Write failing browser codec tests**

```ts
it('round-trips four two-bit wildfire states', () => {
  expect(decode2BitFrame(encode2BitFrame(Uint8Array.from([0, 1, 2, 3])), 4))
    .toEqual(Uint8Array.from([0, 1, 2, 3]));
});
```

**Step 2: Run the focused Vitest file**

```bash
cd dashboard && npm run test:run -- frameCodec.test.ts
```

Expected: FAIL for missing codec exports.

**Step 3: Implement packing on both sides**

- Pack four states into one byte in C++.
- Base64 encode the byte payload without JSON arrays.
- Decode the Base64 payload to `Uint8Array` in `frameCodec.ts`.
- Assert decoded length equals exactly 250,000 cells before Canvas rendering.

**Step 4: Add a size assertion**

The C++ test must assert raw packed size is exactly:

```text
500 × 500 × 2 bits = 62,500 bytes
```

**Step 5: Run all codec tests**

```bash
cd dashboard && npm run test:run -- frameCodec.test.ts
```

Expected: PASS.

**Step 6: Commit**

```bash
git add wildfire_common.hpp tests/preview_codec_test.cpp dashboard/src/frameCodec.ts dashboard/src/frameCodec.test.ts
git commit -m "feat: encode fixed preview frames as packed two-bit data"
```

---

### Task 4: Replace raw `--frames` output with a schema-v2 compressed playback trace

**Objective:** Generate one valid canonical trace for any selected grid/density without serializing full grids.

**Files:**
- Modify: `wildfire_common.hpp:38-41, 55-58, 180-191`
- Modify: `serial_wildfire.cpp` only if it owns serial frame wiring
- Test: `tests/preview_trace_test.cpp`

**Step 1: Write a failing trace fixture test**

Invoke the serial executable with:

```bash
./serial_wildfire --rows 1000 --cols 1000 --steps 100 --density 0.7 --seed 42 \
  --frames tmp/trace.json --frame-interval 5 --repetitions 1
```

Assert JSON contains:

```json
{
  "schemaVersion": 2,
  "sourceRows": 1000,
  "previewRows": 500,
  "aggregationRows": 2,
  "steps": 100,
  "density": 0.7
}
```

Assert every frame has `cells2BitBase64`, never `cells`.

**Step 2: Run and verify failure**

Expected: current schemaVersion is 1 and raw `cells` arrays are produced.

**Step 3: Implement `writeCompressedPlaybackTrace`**

Replace the existing raw `writeFrames` format with schema-v2 output:

```json
{
  "schemaVersion": 2,
  "sourceRows": 4000,
  "sourceCols": 4000,
  "previewRows": 500,
  "previewCols": 500,
  "aggregationRows": 8,
  "aggregationCols": 8,
  "steps": 100,
  "density": 0.7,
  "seed": 42,
  "frames": [
    { "step": 0, "cells2BitBase64": "..." },
    { "step": 5, "cells2BitBase64": "..." }
  ]
}
```

Use fixed `frameInterval = 5`, yielding 21 frames including Step 0 and Step 100. Reject unsupported dimensions instead of silently emitting the wrong aggregation.

**Step 4: Verify a 4000×4000 trace**

Run a serial trace-only command for `4000×4000`, then assert:

- every decoded frame is 500×500;
- aggregation is 8×8;
- output is materially smaller than a raw full-grid JSON frame;
- final decoded state checksum agrees with a separately generated downsample of final simulation state.

**Step 5: Commit**

```bash
git add wildfire_common.hpp serial_wildfire.cpp tests/preview_trace_test.cpp
git commit -m "feat: emit compact majority-compressed playback traces"
```

---

### Task 5: Add a trace-only execution mode and isolate it from benchmark timing

**Objective:** Generate the canonical animation trace without contaminating the three-repetition performance measurement.

**Files:**
- Modify: `wildfire_common.hpp`
- Modify: `dashboard/electron/runner/commandBuilder.cjs`
- Modify: `dashboard/electron/runner/runManager.cjs`
- Test: `dashboard/tests/electron/runner.test.cjs`

**Step 1: Add failing command-builder tests**

```js
it('builds a serial trace command with one repetition and fixed frame interval', () => {
  const command = buildTraceCommand({ rows: 4000, cols: 4000, density: 0.7, seed: 42 });
  assert.deepEqual(command.args.includes('--frames'), true);
  assert.deepEqual(command.args.includes('--frame-interval'), true);
  assert.equal(command.args.includes('--repetitions'), true);
});
```

**Step 2: Verify failure**

Run:

```bash
cd dashboard && node --test tests/electron/runner.test.cjs
```

Expected: FAIL because trace commands and a trace path do not exist.

**Step 3: Implement the separate trace pass**

The run manager workflow must be:

```text
validate selected methods
→ run serial trace-only pass once with repetitions=1, no warmup, frame interval=5
→ save trace.json under Electron user-data/<batch-id>/
→ sequentially run selected benchmark executables with repetitions=3
→ persist each result and emit batch events
```

Do not include trace-pass elapsed time in any backend median or displayed benchmark runtime.

**Step 4: Emit typed batch events**

Extend `dashboard/src/desktopApi.ts` and preload contract with events such as:

```ts
type BatchEvent =
  | { type: 'trace-ready'; batchId: string; tracePath: string }
  | { type: 'method-started'; batchId: string; backend: Backend }
  | { type: 'method-completed'; batchId: string; backend: Backend; result: RunResult }
  | { type: 'method-failed'; batchId: string; backend: Backend; message: string }
  | { type: 'batch-completed'; batchId: string };
```

Keep IPC allowlisted; renderer supplies method IDs only, never executables or arbitrary command arguments.

**Step 5: Run Electron runner tests**

Expected: all prior tests plus trace and selected-method queue tests PASS.

**Step 6: Commit**

```bash
git add dashboard/electron dashboard/src/desktopApi.ts dashboard/tests/electron/runner.test.cjs wildfire_common.hpp
git commit -m "feat: generate isolated canonical playback trace before benchmark batch"
```

---

### Task 6: Add selected-method validation and availability reporting

**Objective:** Let users opt out of CUDA/MPI/OpenMP safely while preserving a clear explanation for unavailable methods.

**Files:**
- Modify: `dashboard/electron/runner/commandBuilder.cjs`
- Modify: `dashboard/electron/main.cjs`
- Modify: `dashboard/electron/preload.cjs`
- Modify: `dashboard/src/desktopApi.ts`
- Test: `dashboard/tests/electron/runner.test.cjs`

**Step 1: Write failing tests**

```js
it('rejects an empty selected-method list', () => {
  assert.throws(() => validateBatchConfig({ methods: [] }), /at least one/i);
});

it('continues with serial when the CUDA executable is unavailable', async () => {
  // mock CUDA executable lookup false; assert Serial command is still launched
});
```

**Step 2: Implement preflight**

Expose a read-only `getMethodAvailability()` IPC that reports:

```ts
{ serial: { available: true }, cuda: { available: false, reason: 'CUDA executable not found' } }
```

Availability is based on the known allowlisted executable path, not a shell probe entered by the renderer.

**Step 3: Implement queue rules**

- Empty checked list: disable the run button and show `Select at least one method.`
- Unavailable method: checkbox disabled; show reason inline.
- A process that starts but exits unsuccessfully: mark that panel failed, preserve stderr, continue with remaining selected methods.
- Without Serial: display `Speedup: N/A (Serial not selected)`; never calculate a false baseline.

**Step 4: Verify**

```bash
cd dashboard && node --test tests/electron/runner.test.cjs
```

Expected: PASS.

**Step 5: Commit**

```bash
git add dashboard/electron dashboard/src/desktopApi.ts dashboard/tests/electron/runner.test.cjs
git commit -m "feat: support selected backend batches and availability checks"
```

---

### Task 7: Simplify the collection form to grid, density, and checkboxes

**Objective:** Remove controls the user does not need and make the data-collection action unambiguous.

**Files:**
- Modify: `dashboard/src/components/LiveRunPanel.tsx`
- Modify: `dashboard/src/App.tsx`
- Modify: `dashboard/src/style.css`
- Test: `dashboard/src/components/LiveRunPanel.test.tsx`

**Step 1: Write failing UI tests**

```tsx
expect(screen.getByLabelText('Source grid')).toBeVisible();
expect(screen.getByLabelText('Density')).toBeVisible();
expect(screen.getByLabelText('Serial')).toBeChecked();
expect(screen.queryByLabelText('Steps')).not.toBeInTheDocument();
expect(screen.queryByLabelText('Repetitions')).not.toBeInTheDocument();
expect(screen.queryByLabelText('Backend')).not.toBeInTheDocument();
```

**Step 2: Run test to confirm failure**

```bash
cd dashboard && npm run test:run -- LiveRunPanel.test.tsx
```

Expected: FAIL because the current panel has Steps and Repetitions controls and hard-coded four-method status.

**Step 3: Implement the constrained form**

Render:

```tsx
<label>Source grid <select aria-label="Source grid">...</select></label>
<label>Density <select aria-label="Density">...</select></label>
<fieldset aria-label="Methods">
  <legend>Methods to run</legend>
  <label><input type="checkbox" checked={selected.serial} /> Serial</label>
  ...
</fieldset>
```

- Default all available methods checked.
- Retain fixed settings in non-editable copy: `100 steps · 3 repetitions · seed 42`.
- Change CTA to `Run selected methods`.
- Change queue head to `N / M selected methods completed`.

**Step 4: Run UI tests**

Expected: PASS.

**Step 5: Commit**

```bash
git add dashboard/src/components/LiveRunPanel.tsx dashboard/src/App.tsx dashboard/src/style.css dashboard/src/components/LiveRunPanel.test.tsx
git commit -m "feat: simplify live controls to grid density and methods"
```

---

### Task 8: Replace the single viewport with a reusable compact animation canvas

**Objective:** Render any schema-v2 compressed frame correctly at fixed 500×500 dimensions, with no hotspots or old scenario dependency.

**Files:**
- Create: `dashboard/src/components/WildfirePlaybackCanvas.tsx`
- Create: `dashboard/src/components/WildfirePlaybackCanvas.test.tsx`
- Modify: `dashboard/src/frameCodec.ts`
- Modify: `dashboard/src/style.css`

**Step 1: Write a failing Canvas test**

```tsx
render(<WildfirePlaybackCanvas bundle={bundle} frameIndex={0} label="Serial wildfire animation" />);
expect(screen.getByLabelText('Serial wildfire animation')).toBeVisible();
```

Also test that a 4000 source bundle sets canvas dimensions to `500` and does not create 16 million DOM nodes.

**Step 2: Implement minimal Canvas behavior**

- Decode `cells2BitBase64` to 250,000 state values.
- Write `ImageData(500, 500)` with the standard four colors.
- `canvas.width = 500`, `canvas.height = 500` regardless of source resolution.
- Memoize decoded frames by frame index/base64 string.
- Do not render a `♨` icon per cell; remove current hotspot overlay behavior from this playback surface.

**Step 3: Add visible source/aggregation caption**

```text
4000×4000 source → 500×500 display · 8×8 cells/pixel · majority-state
```

**Step 4: Run focused tests**

```bash
cd dashboard && npm run test:run -- WildfirePlaybackCanvas.test.tsx frameCodec.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add dashboard/src/components/WildfirePlaybackCanvas.tsx dashboard/src/components/WildfirePlaybackCanvas.test.tsx dashboard/src/frameCodec.ts dashboard/src/style.css
git commit -m "feat: render fixed-size compressed wildfire playback canvas"
```

---

### Task 9: Build four simultaneous animation-and-progress panels

**Objective:** Make the four backend differences visible in the same component rather than separating cards from the preview.

**Files:**
- Replace: `dashboard/src/components/FourBackendTimeComparison.tsx`
- Create: `dashboard/src/components/FourBackendPlaybackGrid.test.tsx`
- Modify: `dashboard/src/style.css`

**Step 1: Write failing component tests**

```tsx
render(<FourBackendTimeComparison
  bundle={bundle}
  methods={['serial', 'openmp', 'cuda', 'mpi']}
  results={results}
/>);
expect(screen.getByLabelText('Serial wildfire animation')).toBeVisible();
expect(screen.getByLabelText('CUDA wildfire animation')).toBeVisible();
expect(screen.getAllByText(/Step \d+ \/ 100/)).toHaveLength(4);
```

Test at a master time where CUDA has completed and Serial has not:

```tsx
expect(screen.getByTestId('cuda-status')).toHaveTextContent('Finished');
expect(screen.getByTestId('serial-status')).toHaveTextContent('Running');
```

**Step 2: Implement elapsed-time mapping**

Use pure helpers so they are independently testable:

```ts
export function methodProgress(masterMs: number, medianMs: number): number {
  return Math.min(1, Math.max(0, masterMs / medianMs));
}
export function frameIndexForProgress(progress: number, frames: PlaybackFrame[]): number {
  return Math.min(frames.length - 1, Math.floor(progress * (frames.length - 1)));
}
```

For each selected method render:

```text
Method name · Running / Finished / Failed
Step N / 100
500×500 Canvas
colored progress bar
real median runtime
speedup / efficiency where valid
```

For unselected methods render a muted `Not selected` tile, preserving the 2×2 visual structure. For failed methods show the failure reason and no invented completed state.

**Step 3: Add master playback controls**

Use one Play/Pause, Reset, and accessible range slider. The slider max is the largest successful selected median. Reset time to zero whenever the trace, selected grid, density, or result set changes.

**Step 4: Run tests**

```bash
cd dashboard && npm run test:run -- FourBackendPlaybackGrid.test.tsx
```

Expected: PASS.

**Step 5: Commit**

```bash
git add dashboard/src/components/FourBackendTimeComparison.tsx dashboard/src/components/FourBackendPlaybackGrid.test.tsx dashboard/src/style.css
git commit -m "feat: combine four backend animations with synchronized progress"
```

---

### Task 10: Remove obsolete scenario and backend filter UI

**Objective:** Ensure the dashboard has one clear run configuration and one clear four-method comparison, not conflicting controls.

**Files:**
- Modify: `dashboard/src/App.tsx`
- Delete: obsolete single-scenario viewport helpers from `dashboard/src/App.tsx`
- Delete or stop loading unused scenario code in `dashboard/src/dataClient.ts` if no other page uses it
- Modify: `dashboard/src/types.ts`
- Modify: `dashboard/src/style.css`
- Test: `dashboard/src/App.test.tsx`

**Step 1: Write failure-level UI assertions**

```tsx
expect(screen.queryByLabelText('Experiment grid')).not.toBeInTheDocument();
expect(screen.queryByLabelText('Backend')).not.toBeInTheDocument();
expect(screen.queryByLabelText('Benchmark grid')).not.toBeInTheDocument();
expect(screen.queryByLabelText('Chart')).not.toBeInTheDocument();
expect(screen.queryByText('AGGREGATED PLAYBACK')).not.toBeInTheDocument();
```

**Step 2: Replace the main layout**

Order the page as:

```text
Header
→ Collect results: Grid + Density + Method checkboxes + selected-method queue progress
→ Four-backend synchronized animation/progress grid
→ measured result summary/table for the just-selected source grid and density
→ short methodology note about fixed 500×500 majority preview and isolated timing
```

Retain the result table but filter it internally to the active grid/density/selected-method batch. Remove user-facing backend and chart filtering. A fixed runtime comparison may remain only if it uses the same active results and does not introduce another selector.

**Step 3: Remove stale wording**

Delete or replace:

```text
Experiment grid
Backend
Benchmark grid
Chart
AGGREGATED PLAYBACK
PARALLEL WORK MAP
```

**Step 4: Run App tests**

```bash
cd dashboard && npm run test:run -- App.test.tsx
```

Expected: PASS.

**Step 5: Commit**

```bash
git add dashboard/src/App.tsx dashboard/src/dataClient.ts dashboard/src/types.ts dashboard/src/style.css dashboard/src/App.test.tsx
git commit -m "refactor: center dashboard on selected-method animated comparison"
```

---

### Task 11: Wire batch results and trace persistence into the UI

**Objective:** Make a completed Electron batch immediately drive the four-panel animation instead of relying on static benchmark fixtures.

**Files:**
- Modify: `dashboard/src/App.tsx`
- Modify: `dashboard/src/desktopApi.ts`
- Modify: `dashboard/electron/main.cjs`
- Modify: `dashboard/electron/preload.cjs`
- Test: `dashboard/src/App.test.tsx`

**Step 1: Write failing UI event tests**

Mock event order:

```ts
trace-ready → method-started(serial) → method-completed(serial)
→ method-started(openmp) → method-completed(openmp)
→ batch-completed
```

Assert:

- grid appears as `500×500` immediately when trace is ready;
- serial changes from Pending to Complete;
- its median result appears in the tile;
- playback controls become enabled after a trace and at least one successful result;
- all result rows are tied to the batch configuration.

**Step 2: Implement batch-scoped state**

Keep a single explicit UI model:

```ts
type ActiveBatch = {
  id: string;
  config: FixedRunConfig;
  selectedMethods: Backend[];
  statuses: Record<Backend, MethodStatus>;
  trace?: PlaybackBundle;
  results: Partial<Record<Backend, Benchmark>>;
  errors: Partial<Record<Backend, string>>;
};
```

Never append a completed run to an unrelated grid/density comparison. Historical runs may stay in Electron storage but must not silently enter the active animation grid.

**Step 3: Verify full UI event flow**

```bash
cd dashboard && npm run test:run -- App.test.tsx
```

Expected: PASS.

**Step 4: Commit**

```bash
git add dashboard/src/App.tsx dashboard/src/desktopApi.ts dashboard/electron/main.cjs dashboard/electron/preload.cjs dashboard/src/App.test.tsx
git commit -m "feat: drive four-panel playback from active benchmark batches"
```

---

### Task 12: Perform real Electron end-to-end verification

**Objective:** Verify behavior with actual executables, not only mocked events.

**Files:**
- Optional modify: `README.md` or project report notes to document the user flow and fixed settings

**Step 1: Build all native backends and dashboard**

Run the project’s documented native build commands, then:

```bash
cd dashboard
npm run test:run
node --test tests/electron/runner.test.cjs
npm run build
npm run electron
```

Expected: no TypeScript errors and Electron opens.

**Step 2: Test a 500×500 all-available-method batch**

In Electron select:

```text
Grid: 500×500
Density: 70%
Methods: all available
```

Click `Run selected methods` and verify:

- trace-ready occurs before benchmark queue;
- four queue states move in order;
- all successful checksums match;
- every selected panel receives a result;
- master playback makes CUDA finish before slower methods;
- each panel displays a different frame at an intermediate master time;
- all four final canvases match visually at playback completion.

**Step 3: Test CUDA opt-out / unavailability behavior**

Uncheck CUDA, run the remaining methods, and verify:

- queue total is 3;
- CUDA tile says `Not selected`;
- no CUDA command launches;
- speedup remains valid when Serial is selected.

If CUDA is unavailable on the verification device, verify disabled checkbox reason and successful CPU-only run.

**Step 4: Test 4000×4000 aggregation**

Select:

```text
Grid: 4000×4000
Density: 70%
Methods: Serial + CUDA (or available subset)
```

Verify the visible caption says:

```text
4000×4000 source → 500×500 display · 8×8 cells/pixel · majority-state
```

Verify Canvas backing dimensions remain exactly 500×500, browser/Electron remains responsive, and no raw 16,000,000-element frame JSON is created.

**Step 5: Verify output and repository cleanliness**

```bash
git diff --check
git status --short --branch
```

Only intended tracked source/docs/tests may change. User-data run traces and live result output must be ignored.

**Step 6: Commit**

```bash
git add README.md  # only if documentation changed
git commit -m "docs: document four-backend animated benchmark workflow"
git push origin dev_JiShou
```

---

## Risks, tradeoffs, and safeguards

1. **Visualization is not per-kernel hardware telemetry.** The panels show the same deterministic wildfire state trace at different positions derived from each backend’s real isolated median. The UI must label this truthfully. Collecting true CUDA per-step timing requires synchronization/instrumentation that would distort benchmark timings.
2. **Trace generation adds extra work.** The serial trace pass is intentionally separate and excluded from reported performance data. It guarantees a valid visual source for every selected grid/density.
3. **MPI/CUDA availability varies by computer.** Method checkboxes and preflight availability make CUDA optional without hiding the comparison model.
4. **Majority aggregation may hide rare cells.** The tie priority preserves `BURNING`, and the caption explains the representation. It is a visualization approximation only; performance and final correctness remain full-resolution.
5. **Fixed 100 steps are a product choice.** The UI must clearly state that 100 steps and 3 repetitions are fixed. A later requirement to make them configurable should be a new feature, not an undocumented hidden value.
6. **Batch speedup without Serial is undefined.** Display N/A rather than selecting a different baseline.

## Completion checklist

- [ ] Only Grid, Density, and method checkboxes are editable.
- [ ] `Run selected methods` batch queue works without individual backend selector.
- [ ] One master timeline simultaneously drives four canvas animations and progress bars.
- [ ] All previews are 500×500 Canvas buffers.
- [ ] 1000/2000/4000 use 2×2/4×4/8×8 majority compression.
- [ ] 4000×4000 trace output is compact 2-bit frames, not raw cell arrays.
- [ ] Selected-method success, failure, unavailable, and unselected states are visible.
- [ ] Benchmark medians come only from isolated timed backend runs.
- [ ] React tests, runner tests, native tests, build, and real Electron smoke test pass.
