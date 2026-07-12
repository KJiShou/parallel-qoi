# Fixed-Time Step-Throughput Playback Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Change the four-backend wildfire comparison from “all methods stop at 100 steps” to a fixed 5-second virtual-time race that shows how many simulation steps Serial, OpenMP, CUDA, and MPI can complete in the same time, while preserving the existing fixed-100-step benchmark for valid runtime, speedup, efficiency, and checksum comparisons.

**Architecture:** Keep the timed benchmark as an isolated, fixed workload: 100 steps and 3 repetitions per selected backend. After all selected benchmark results are available, derive each backend’s measured step throughput from its median, calculate how many steps it could complete during a 5,000 ms comparison window, and generate one canonical native compressed trace only up to the maximum step needed for playback, capped at 1,000. Replay that shared deterministic trace in four Canvas tiles against one virtual-time axis; faster backends advance to later trace steps, while extinguished or capped animations hold their final frame. The UI must distinguish measured results, derived throughput, and visual playback so it never implies live hardware telemetry.

**Tech Stack:** C++17/OpenMP native trace generator; Electron IPC and allowlisted process runner; React + TypeScript; Canvas 2D; 2-bit Base64 compressed frames; Vitest; Node `node:test`; CMake/MSBuild.

---

## Product decisions and acceptance criteria

### Keep the formal benchmark unchanged

The data-collection workload remains:

```text
steps       = 100
repetitions = 3
seed        = 42
OpenMP      = 4 threads
MPI         = 4 processes
CUDA        = block size 256
```

The result table continues to report:

```text
median runtime
speedup vs Serial
efficiency
checksum correctness
```

Do not calculate formal speedup from different final step counts.

### Add a fixed-time visual race

Use these fixed visualization constants:

```text
virtual comparison window = 5,000 ms
screen playback duration  = 10,000 ms
maximum trace step        = 1,000
trace frame interval      = 10 steps
```

For a backend with a measured median `medianMs` from the 100-step benchmark:

```ts
stepsPerMs = 100 / medianMs
rawStepAtTime = Math.floor(virtualElapsedMs * stepsPerMs)
displayedStep = Math.min(rawStepAtTime, 1000)
```

Each panel displays:

```text
Step N
N steps completed in 5.0 s
steps/s
throughput vs Serial
Fire status: active / extinguished
Trace cap reached (when applicable)
```

### Trace generation order

Change the batch workflow from:

```text
trace → benchmark methods
```

to:

```text
selected benchmark methods
→ derive measured step rates
→ calculate maximum required playback step
→ native compressed trace pass
→ synchronized playback ready
```

This prevents generating an arbitrary trace before knowing how many steps the selected methods can reach.

### Canonical trace and truthfulness

- The trace represents the same deterministic simulation state sequence for every backend: same grid, density, seed, and update rules.
- Each backend tile selects a different trace frame based on its measured step throughput.
- The trace pass is separate and excluded from benchmark timing.
- The UI must say:

```text
Fixed 5-second virtual-time comparison
Step positions derived from isolated 100-step medians
Shared deterministic native trace · not live hardware telemetry
```

### Fire visibility

Keep majority-state compression as the base state. Add one native `burningMaskBase64` bitmask per frame:

```text
majority pixel color = Empty / Tree / Burning / Burned
burning overlay      = true if the source tile contains at least one Burning cell
```

The Canvas renders the majority-state image first, then applies an orange glow to pixels whose burning mask bit is set. This preserves the user-requested majority rule while preventing a thin fire front from disappearing inside an 8×8 tile.

---

### Task 1: Add fixed-time playback math as pure TypeScript functions

**Objective:** Define and test the distinction between measured benchmark runtime, derived step throughput, and capped playback steps.

**Files:**
- Modify: `dashboard/src/runConfig.ts`
- Modify: `dashboard/src/runConfig.test.ts`

**Step 1: Write failing tests**

```ts
import {
  FIXED_TIME_PLAYBACK,
  stepsPerSecond,
  stepAtVirtualTime,
  requiredTraceSteps,
} from './runConfig';

it('derives throughput from a measured 100-step median', () => {
  expect(stepsPerSecond(250)).toBeCloseTo(400);
});

it('calculates progress in a five-second virtual window', () => {
  expect(stepAtVirtualTime(2500, 250)).toBe(1000);
});

it('caps native trace generation at one thousand steps', () => {
  expect(requiredTraceSteps([250, 50, 5])).toBe(1000);
});
```

**Step 2: Run the focused test and verify RED**

Run:

```bash
cd dashboard
npm run test:run -- runConfig.test.ts
```

Expected: FAIL because the constants and helpers do not exist.

**Step 3: Add minimal implementation**

```ts
export const FIXED_TIME_PLAYBACK = {
  virtualWindowMs: 5000,
  screenDurationMs: 10000,
  maximumTraceStep: 1000,
  traceFrameInterval: 10,
  benchmarkSteps: 100,
} as const;

export function stepsPerSecond(medianMs: number): number {
  if (!Number.isFinite(medianMs) || medianMs <= 0) return 0;
  return FIXED_TIME_PLAYBACK.benchmarkSteps / medianMs * 1000;
}

export function stepAtVirtualTime(virtualMs: number, medianMs: number): number {
  return Math.min(
    FIXED_TIME_PLAYBACK.maximumTraceStep,
    Math.floor(Math.max(0, virtualMs) * stepsPerSecond(medianMs) / 1000),
  );
}

export function requiredTraceSteps(medians: number[]): number {
  return Math.max(
    1,
    ...medians.map((median) => stepAtVirtualTime(FIXED_TIME_PLAYBACK.virtualWindowMs, median)),
  );
}
```

**Step 4: Run focused and full tests**

```bash
cd dashboard
npm run test:run -- runConfig.test.ts
npm test -- --run
```

Expected: PASS.

**Step 5: Commit**

```bash
git add dashboard/src/runConfig.ts dashboard/src/runConfig.test.ts
git commit -m "feat: add fixed-time playback throughput math"
```

---

### Task 2: Extend the native trace schema with requested maximum step

**Objective:** Let Electron request only the trace depth required by measured backend throughput instead of always generating 100 steps.

**Files:**
- Modify: `wildfire_common.hpp`
- Modify: `dashboard/tests/electron/nativeTrace.test.cjs`

**Step 1: Write a failing native test**

```js
test('trace-only respects a requested 250-step depth', () => {
  execFileSync(serial, [
    '--rows','500','--cols','500',
    '--steps','250',
    '--density','0.7','--seed','42',
    '--frames',tracePath,
    '--frame-interval','10',
    '--trace-only',
  ]);
  const trace = JSON.parse(fs.readFileSync(tracePath, 'utf8'));
  assert.equal(trace.steps, 250);
  assert.equal(trace.frames.at(-1).step, 250);
  assert.equal(trace.frameInterval, 10);
});
```

**Step 2: Run and verify RED**

```bash
cd dashboard
node --test tests/electron/nativeTrace.test.cjs
```

Expected: FAIL because schema-v2 does not yet include `frameInterval`, and any final partial interval behavior is not guaranteed.

**Step 3: Update native schema output**

In `wildfire_common.hpp`, ensure schema-v2 includes:

```json
{
  "steps": 250,
  "frameInterval": 10,
  "frames": [
    {"step": 0},
    {"step": 10},
    {"step": 20},
    {"step": 250}
  ]
}
```

The final requested step must always be present even when it is not evenly divisible by the interval.

**Step 4: Run native tests**

```bash
cd dashboard
node --test tests/electron/nativeTrace.test.cjs
```

Expected: PASS.

**Step 5: Commit**

```bash
git add wildfire_common.hpp dashboard/tests/electron/nativeTrace.test.cjs
git commit -m "feat: support variable-depth native playback traces"
```

---

### Task 3: Add a native burning-presence mask

**Objective:** Preserve visible fire fronts after majority compression without changing the majority-state base color.

**Files:**
- Modify: `wildfire_common.hpp`
- Modify: `dashboard/tests/electron/nativeTrace.test.cjs`
- Modify: `dashboard/src/frameCodec.ts`
- Modify: `dashboard/src/frameCodec.test.ts`

**Step 1: Write failing native assertions**

For each generated frame assert:

```js
assert.equal(typeof frame.burningMaskBase64, 'string');
assert.equal(Buffer.from(frame.burningMaskBase64, 'base64').length, 31250);
```

A 500×500 one-bit mask must occupy:

```text
250,000 bits = 31,250 bytes
```

**Step 2: Write failing browser decoder tests**

```ts
it('decodes a one-bit burning overlay mask', () => {
  const decoded = decodeBitMask(btoa(String.fromCharCode(0b00000101)), 8);
  expect([...decoded]).toEqual([1,0,1,0,0,0,0,0]);
});
```

**Step 3: Run tests and verify RED**

```bash
cd dashboard
node --test tests/electron/nativeTrace.test.cjs
npm run test:run -- frameCodec.test.ts
```

Expected: FAIL for missing mask fields/decoder.

**Step 4: Implement native packing**

During each 500×500 tile aggregation:

```cpp
bool containsBurning = counts[BURNING] > 0;
if (containsBurning)
    burningMask[pixelIndex / 8] |= static_cast<std::uint8_t>(1u << (pixelIndex % 8));
```

Emit both:

```json
{
  "cells2BitBase64": "...",
  "burningMaskBase64": "..."
}
```

Do not alter the majority state selection logic.

**Step 5: Implement `decodeBitMask`**

```ts
export function decodeBitMask(encoded: string, expectedLength: number): Uint8Array {
  const bytes = Uint8Array.from(atob(encoded), (value) => value.charCodeAt(0));
  const output = new Uint8Array(expectedLength);
  for (let index = 0; index < expectedLength; index += 1)
    output[index] = (bytes[index >> 3] >> (index & 7)) & 1;
  return output;
}
```

Validate encoded byte length before decoding.

**Step 6: Run all relevant tests**

Expected: PASS.

**Step 7: Commit**

```bash
git add wildfire_common.hpp dashboard/tests/electron/nativeTrace.test.cjs dashboard/src/frameCodec.ts dashboard/src/frameCodec.test.ts
git commit -m "feat: preserve compressed fire fronts with native overlay masks"
```

---

### Task 4: Generate the trace after benchmark results

**Objective:** Reorder the Electron workflow so trace depth is derived from measured selected-method medians.

**Files:**
- Modify: `dashboard/src/App.tsx`
- Modify: `dashboard/src/desktopApi.d.ts`
- Modify: `dashboard/electron/runner/commandBuilder.cjs`
- Modify: `dashboard/electron/runner/runManager.cjs`
- Modify: `dashboard/tests/electron/runner.test.cjs`

**Step 1: Write failing command-builder tests**

```js
test('trace command accepts only validated playback depth and fixed interval', () => {
  const command = buildTraceCommand(config, {
    rootDir: 'C:/project',
    buildDir: 'C:/project/build',
    traceSteps: 250,
  });
  assert.deepEqual(valueAfter(command.args, '--steps'), '250');
  assert.deepEqual(valueAfter(command.args, '--frame-interval'), '10');
});
```

Also test rejection of:

```text
traceSteps < 1
traceSteps > 1000
non-integer traceSteps
```

**Step 2: Run and verify RED**

```bash
cd dashboard
node --test tests/electron/runner.test.cjs
```

Expected: FAIL because trace depth is currently fixed at 100.

**Step 3: Extend `startTrace` safely**

Renderer sends only:

```ts
{
  rows,
  cols,
  density,
  seed,
  traceSteps
}
```

Electron validates:

```js
Number.isInteger(traceSteps) && traceSteps >= 1 && traceSteps <= 1000
```

The native executable path, output path, trace interval, warmup, and repetitions remain allowlisted/fixed in Electron main code.

**Step 4: Reorder App batch state**

Change `start()` to launch selected benchmark methods immediately. After the last selected method completes:

```ts
const traceSteps = requiredTraceSteps(successfulResults.map((row) => row.runtimeMs.median));
setPhase(`Preparing ${traceSteps}-step compressed playback trace`);
window.wildfireDesktop.startTrace({
  rows,
  cols,
  density,
  seed,
  traceSteps,
});
```

The batch is considered data-complete before the trace, but playback controls remain disabled until `trace-completed`.

**Step 5: Handle partial failures**

- At least one successful method: generate trace based on successful medians.
- All methods failed: do not generate trace; display `No successful methods available for playback.`
- Cancellation: do not automatically start a trace.

**Step 6: Run runner tests**

Expected: PASS.

**Step 7: Commit**

```bash
git add dashboard/src/App.tsx dashboard/src/desktopApi.d.ts dashboard/electron/runner/commandBuilder.cjs dashboard/electron/runner/runManager.cjs dashboard/tests/electron/runner.test.cjs
git commit -m "feat: derive playback trace depth after benchmark collection"
```

---

### Task 5: Model measured and derived values explicitly

**Objective:** Prevent the UI from presenting estimated fixed-time steps as directly measured per-step telemetry.

**Files:**
- Modify: `dashboard/src/types.ts`
- Create: `dashboard/src/playbackModel.ts`
- Create: `dashboard/src/playbackModel.test.ts`

**Step 1: Write failing model tests**

```ts
it('creates a derived throughput record from a measured benchmark median', () => {
  expect(createPlaybackRecord({ backend: 'serial', medianMs: 250 })).toEqual({
    backend: 'serial',
    benchmarkSteps: 100,
    medianMs: 250,
    stepsPerSecond: 400,
    stepsInWindow: 1000,
    stepSource: 'derived-from-100-step-median',
  });
});
```

**Step 2: Verify RED**

```bash
cd dashboard
npm run test:run -- playbackModel.test.ts
```

Expected: FAIL because the model does not exist.

**Step 3: Implement explicit types**

```ts
export type PlaybackRecord = {
  backend: Backend;
  benchmarkSteps: 100;
  medianMs: number;
  stepsPerSecond: number;
  stepsInWindow: number;
  stepSource: 'derived-from-100-step-median';
};
```

Serial-relative throughput:

```ts
throughputSpeedup = backend.stepsPerSecond / serial.stepsPerSecond
```

If Serial is not selected/successful, return `null` rather than inventing a baseline.

**Step 4: Run tests**

Expected: PASS.

**Step 5: Commit**

```bash
git add dashboard/src/types.ts dashboard/src/playbackModel.ts dashboard/src/playbackModel.test.ts
git commit -m "feat: model derived fixed-time backend throughput"
```

---

### Task 6: Convert the master timeline to virtual comparison time

**Objective:** Make one 10-second on-screen playback represent the 0–5,000 ms virtual comparison window.

**Files:**
- Modify: `dashboard/src/components/FourBackendTimeComparison.tsx`
- Create: `dashboard/src/components/FourBackendTimeComparison.test.tsx`

**Step 1: Write failing UI tests**

```tsx
expect(screen.getByText('Fixed 5-second virtual-time comparison')).toBeVisible();
expect(screen.getByLabelText('Virtual comparison time')).toHaveAttribute('max', '5000');
```

Use fake timers to advance half of the 10-second screen playback and assert the virtual label becomes approximately:

```text
2,500 / 5,000 ms
```

**Step 2: Run and verify RED**

```bash
cd dashboard
npm run test:run -- FourBackendTimeComparison.test.tsx
```

Expected: FAIL because the current slider max is the slowest backend median.

**Step 3: Implement virtual-time playback**

Use animation-frame timestamps or a 50 ms interval with a conversion:

```ts
virtualElapsedMs = Math.min(
  5000,
  screenElapsedMs / 10000 * 5000,
);
```

The range slider always has:

```tsx
min={0}
max={5000}
step={10}
```

Changing grid, density, selected methods, results, or live trace resets playback to zero.

**Step 4: Run tests**

Expected: PASS.

**Step 5: Commit**

```bash
git add dashboard/src/components/FourBackendTimeComparison.tsx dashboard/src/components/FourBackendTimeComparison.test.tsx
git commit -m "feat: use a fixed five-second virtual playback timeline"
```

---

### Task 7: Map each backend to trace steps and frames

**Objective:** Display each backend at the correct deterministic state for its derived fixed-time step count.

**Files:**
- Modify: `dashboard/src/components/FourBackendTimeComparison.tsx`
- Modify: `dashboard/src/components/FourBackendTimeComparison.test.tsx`

**Step 1: Write failing frame-selection tests**

For trace steps `[0,10,20,30]`, assert:

```ts
frameForStep(0)  → frame 0
frameForStep(17) → frame 10
frameForStep(30) → frame 30
frameForStep(99) → final frame 30
```

**Step 2: Implement binary-search frame selection**

```ts
export function frameIndexAtOrBefore(frames: PlaybackFrame[], requestedStep: number): number {
  let low = 0;
  let high = frames.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (frames[middle].step <= requestedStep) low = middle;
    else high = middle - 1;
  }
  return low;
}
```

Do not assume frames are evenly spaced because the last frame may be a partial interval.

**Step 3: Render panel metrics**

Each selected successful tile shows:

```text
Step 347
347 steps completed in 5.0 s
69.4 steps/s
3.5× throughput vs Serial
```

At intermediate virtual time, show the current step, not only the final `stepsInWindow`.

**Step 4: Handle cap state**

If `rawStepAtTime > 1000`, display:

```text
Step 1000+ · visualization cap reached
```

Do not claim the backend stopped computing at 1,000.

**Step 5: Run tests**

Expected: PASS.

**Step 6: Commit**

```bash
git add dashboard/src/components/FourBackendTimeComparison.tsx dashboard/src/components/FourBackendTimeComparison.test.tsx
git commit -m "feat: map fixed-time backend throughput to native trace frames"
```

---

### Task 8: Render the native fire-front overlay

**Objective:** Make active burning cells visible in 2×2, 4×4, and 8×8 compressed previews.

**Files:**
- Modify: `dashboard/src/components/FourBackendTimeComparison.tsx`
- Modify: `dashboard/src/components/FourBackendTimeComparison.test.tsx`
- Modify: `dashboard/src/style.css`

**Step 1: Write a failing Canvas test**

Mock a frame whose majority state is TREE but whose burning mask contains that pixel. Assert rendering writes an orange-highlighted pixel rather than pure tree green.

**Step 2: Implement overlay composition**

After writing majority colors:

```ts
if (burningMask[index]) {
  image.data[offset] = 255;
  image.data[offset + 1] = 105;
  image.data[offset + 2] = 45;
}
```

Optionally render a second low-alpha Canvas pass for glow, but do not blur the full 500×500 image every animation tick. Keep rendering bounded.

**Step 3: Show extinguished state**

If the current frame’s mask contains no burning pixels, panel status becomes:

```text
Fire extinguished
```

The computational step count may continue increasing; the animation stays at the stable fire state.

**Step 4: Run tests and build**

```bash
cd dashboard
npm test -- --run
npm run build
```

Expected: PASS.

**Step 5: Commit**

```bash
git add dashboard/src/components/FourBackendTimeComparison.tsx dashboard/src/components/FourBackendTimeComparison.test.tsx dashboard/src/style.css
git commit -m "feat: overlay visible fire fronts on compressed playback"
```

---

### Task 9: Update queue and playback status wording

**Objective:** Clearly separate data collection, trace preparation, and playback readiness.

**Files:**
- Modify: `dashboard/src/components/LiveRunPanel.tsx`
- Modify: `dashboard/src/App.tsx`
- Modify: `dashboard/src/style.css`
- Test: `dashboard/src/components/LiveRunPanel.test.tsx`

**Step 1: Write failing status tests**

Assert these stages can be represented:

```text
Running 2 / 4 selected benchmark methods
Benchmark data complete
Preparing 1000-step compressed playback trace
Playback ready · fixed 5-second comparison
```

**Step 2: Implement distinct progress states**

The collection progress bar tracks selected benchmark methods only. Trace generation gets a separate indeterminate status; do not increment backend completion count for trace generation.

**Step 3: Add explanatory fixed settings**

Replace ambiguous copy with:

```text
Benchmark: 100 steps × 3 repetitions
Playback: derived 5-second step throughput · max 1000 visual steps
```

**Step 4: Run tests**

Expected: PASS.

**Step 5: Commit**

```bash
git add dashboard/src/components/LiveRunPanel.tsx dashboard/src/App.tsx dashboard/src/style.css dashboard/src/components/LiveRunPanel.test.tsx
git commit -m "refactor: distinguish benchmark collection from throughput playback"
```

---

### Task 10: Verify correctness and performance end to end

**Objective:** Prove the new mode is accurate, bounded, and honest across small and large grids.

**Files:**
- Optional modify: `README.md`

**Step 1: Build all native targets**

```bash
cmake --build build_verified --config Release
```

Expected: Serial, OpenMP, CUDA, and MPI targets build successfully.

**Step 2: Run all automated tests**

```bash
cd dashboard
node --test tests/electron/runner.test.cjs
node --test tests/electron/nativeTrace.test.cjs
npm test -- --run
npm run build
```

Expected: all PASS.

**Step 3: Verify a real 4000×4000 native trace**

Use measured medians to request the calculated trace depth, then assert:

```text
source: 4000×4000
preview: 500×500
aggregation: 8×8
last frame step: calculated required step
2-bit frame bytes: 62,500
burning-mask bytes: 31,250
no raw cells arrays
```

Record elapsed trace-generation time so it can be assessed separately from benchmark timing.

**Step 4: Verify Electron workflow**

In the desktop app:

1. Select `4000×4000`, `70%`, and all available methods.
2. Click `Run selected methods`.
3. Confirm backend benchmark progress reaches `4 / 4` before trace generation starts.
4. Confirm playback remains disabled while trace is generated.
5. Press Play when ready.
6. At the same virtual time, confirm CUDA/OpenMP/MPI/Serial show different step counts.
7. Confirm thin orange fire fronts remain visible over the majority-state image.
8. Confirm all tiles use 500×500 Canvas backing dimensions.
9. Confirm final result table still reports the fixed-100-step benchmark and matching checksums.

**Step 5: Verify opt-out behavior**

Run without CUDA and confirm:

- selected total is 3;
- no CUDA benchmark process launches;
- trace depth is derived only from successful selected methods;
- CUDA tile remains `Not selected`;
- formal and throughput speedups remain Serial-relative when Serial is selected.

Run without Serial and confirm both speedup displays state `N/A · Serial not selected`.

**Step 6: Check repository cleanliness**

```bash
git diff --check
git status --short --branch
```

Expected: only intended tracked changes before final commit.

**Step 7: Final integration commit and push**

```bash
git add -A
git commit -m "feat: compare wildfire backends by fixed-time step throughput"
git push origin dev_JiShou
```

---

## Risks and tradeoffs

1. **Derived, not measured per-step telemetry:** `steps/s` is derived from the isolated 100-step median. UI wording must make that explicit.
2. **Non-linear per-step cost:** State composition and memory behavior can change over time, so `100 / medianMs` assumes average cost is representative. This is acceptable for visualization but must not replace the formal fixed-workload metrics.
3. **Trace generation cost:** A 1,000-step 4000×4000 canonical trace can take significantly longer than 100 steps. Generate it only after results, cap at 1,000, use a dedicated untimed trace path, and visibly show trace preparation.
4. **Fire extinguishes before the computational cap:** The fire animation can stabilize while computational steps continue. Show both fire status and computational throughput.
5. **CUDA may hit the visualization cap quickly:** Display `1000+` rather than falsely implying it stopped at 1,000.
6. **Majority compression hides rare states:** The one-bit native burning overlay preserves the active front without changing the majority base state.
7. **No Serial baseline:** Both formal speedup and throughput-relative values must be N/A when Serial is not selected or fails.

## Completion checklist

- [ ] Formal benchmark remains fixed at 100 steps × 3 repetitions.
- [ ] Playback uses a fixed 0–5,000 ms virtual timeline.
- [ ] Each backend displays derived steps completed and steps/s.
- [ ] Trace depth is calculated after successful benchmark results and capped at 1,000.
- [ ] Native trace includes majority-state 2-bit frames and a one-bit burning overlay.
- [ ] Canvas backing remains exactly 500×500 for every source grid.
- [ ] Fire fronts remain visible for 8×8 aggregation.
- [ ] UI clearly labels derived throughput and non-telemetry playback.
- [ ] Native builds, Electron runner tests, trace tests, React tests, and production build pass.
- [ ] Real 4000×4000 Electron workflow is manually verified.
