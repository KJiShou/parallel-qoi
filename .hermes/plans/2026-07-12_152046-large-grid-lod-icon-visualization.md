# Large-Grid Visualization LOD and Icon Overlay Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** 让 dashboard 能展示和比较 proposal 中的 500×500、1000×1000、2000×2000、4000×4000 实验，而不会因为逐 cell 解码、逐 burning cell 创建 gradient 或大量 icon 而卡顿。

**Architecture:** 完整 grid 继续由 Serial/OpenMP/CUDA/MPI backend 真实计算并用于 runtime、speedup、efficiency、checksum 和 scalability。Dashboard 不直接渲染数百万个 cells，而使用固定最大 512×512 的 LOD aggregated preview；少量 icons 只标记 ignition point、active fire-front hotspots 和 burned-area summary，不采用“一格一个 icon”。Benchmark dataset 和 visualization preview dataset 分开，避免 UI rendering 影响实验计时或让用户误以为 preview resolution 等于 computation grid resolution。

**Tech Stack:** C++17, existing Serial/OpenMP/CUDA/MPI executables, Python 3 preprocessing, packed binary/Base64 LOD frames, React 19, TypeScript, Canvas 2D, Web Worker, Vitest, Python unittest.

---

## 1. Requirements Confirmed from the Assignment

The provided Experiment and Evaluation Plan includes:

| Variable | Planned values |
|---|---|
| Grid size | 500×500, 1000×1000, 2000×2000, 4000×4000 |
| Timesteps | 100, 500, 1000 |
| OpenMP thread count | 1, 2, 4, 8, 16 |
| MPI process count | 1, 2, 4, 8 |
| CUDA block size | 128, 256, 512, 1024 |
| Tree density | 60%, 70%, 80% |

Required metrics:

- execution time;
- speedup;
- efficiency;
- final burned percentage;
- checksum;
- scalability.

The dashboard must therefore support these full experiment dimensions in tables/charts even when it does not animate every original cell.

> Note: the current C++ CLI only accepts CUDA block sizes 128, 256 and 512. Supporting 1024 requires a separate validated implementation change and device capability check; the dashboard must not display a 1024 result unless the benchmark was actually run successfully.

---

## 2. Why Per-Cell Icons Are Not the Main Solution

### Current bottleneck

`dashboard/src/App.tsx` currently:

1. decodes `rows × cols` cells for every frame;
2. creates full-size `ImageData`;
3. scans every cell;
4. creates up to 2,600 `CanvasGradient` objects for burning cells;
5. draws up to 700 extra fire-front rectangles.

At 500×500 this is already noticeable. At 4000×4000, one frame contains 16,000,000 cells, so decoding and drawing the full frame is unsuitable for interactive playback.

### Why one icon per cell is worse

Do not use one SVG/React/DOM icon for every cell:

- 4000×4000 would require up to 16 million visual elements;
- even Canvas `drawImage` per cell would create millions of draw calls;
- icons hide density patterns when zoomed out;
- memory and event/layout overhead would exceed the current raster approach.

### Where icons are useful

Use only a small bounded number of icons:

- one ignition marker;
- 5–20 fire-front hotspot markers;
- optional wind-direction icon if wind is later implemented;
- backend/platform icons in cards/table;
- warning/verified icons for benchmark status.

The main wildfire field should remain a raster/heatmap preview, not an icon grid.

---

## 3. Proposed Adaptive Display Modes

### Mode A — Exact Cell View

Use for source grids up to `500×500`:

- preview can remain one output pixel per source cell;
- single `putImageData` per frame;
- no per-cell gradient creation;
- optional one pre-rendered glow overlay generated from a mask.

### Mode B — Aggregated LOD View

Use for `1000×1000`, `2000×2000`, `4000×4000`:

- source simulation runs at full size;
- source cells are aggregated into a maximum `512×512` preview;
- each preview pixel summarizes a source tile;
- UI label clearly states, for example:

```text
Source simulation: 4000 × 4000 cells
Display preview:   500 × 500 aggregated pixels
Aggregation:       8 × 8 source cells per preview pixel
```

### Mode C — Benchmark-Only View

If preview generation is disabled or data is too large:

- show experiment configuration icon/card;
- show runtime, speedup, efficiency, checksum and burned percentage;
- show final burned-percentage radial indicator;
- show no fake animation;
- provide message: `Animation preview was not generated for this benchmark run.`

---

## 4. LOD Aggregation Model

For each output preview pixel, aggregate a rectangular tile of source cells:

```text
source row range = [floor(y * sourceRows / previewRows),
                    floor((y + 1) * sourceRows / previewRows))
source col range = [floor(x * sourceCols / previewCols),
                    floor((x + 1) * sourceCols / previewCols))
```

Store three 8-bit ratios per preview pixel:

```text
R = burned ratio  (0–255)
G = tree ratio    (0–255)
B = burning ratio (0–255)
```

Empty ratio is implied by the remaining proportion.

Recommended blended display:

```ts
red   = burnedRatio * burnedColor + burningRatio * fireOuterColor;
green = treeRatio * treeColor + burningRatio * fireMidColor;
blue  = emptyRatio * backgroundColor + burningRatio * fireCoreColor;
```

This is better than “dominant state only” because a large tile containing 10% burning cells remains visibly active instead of being hidden by a tree majority.

### Preview resolution

| Source grid | Preview resolution | Source cells per preview pixel |
|---:|---:|---:|
| 500×500 | 500×500 | 1×1 |
| 1000×1000 | 500×500 | 2×2 |
| 2000×2000 | 500×500 | 4×4 |
| 4000×4000 | 500×500 | 8×8 |

The preview remains visually consistent while source computation scales by 64× from 500² to 4000².

---

## 5. Revised Data Contract

### Manifest entry

```json
{
  "id": "serial-4000-preview",
  "label": "4000 × 4000",
  "backend": "serial",
  "sourceRows": 4000,
  "sourceCols": 4000,
  "previewRows": 500,
  "previewCols": 500,
  "aggregationRows": 8,
  "aggregationCols": 8,
  "steps": 1000,
  "frameInterval": 100,
  "displayMode": "lod-density",
  "url": "./data/scenarios/serial-4000-preview.json"
}
```

### LOD frame

```json
{
  "step": 500,
  "burningCells": 18432,
  "burnedCells": 9218340,
  "burnedPercentage": 57.6146,
  "lodRgbBase64": "...",
  "hotspots": [
    { "row": 1950, "col": 2070, "intensity": 0.91 }
  ]
}
```

Each `lodRgbBase64` frame contains:

```text
previewRows × previewCols × 3 bytes
```

For 500×500 preview:

```text
500 × 500 × 3 = 750,000 bytes before Base64
```

Store only selected frames for large grids, such as initial, every 100 steps and final. Do not save all 1,000 timesteps.

---

## 6. Target File Changes

```text
wildfire_common.hpp
serial_wildfire.cpp
openmp_wildfire.cpp
cuda_wildfire.cu
mpi_wildfire.cpp
scripts/
  prepare_dashboard_data.py
  run_benchmarks.py
  test_prepare_dashboard_data.py
  validate_dashboard_data.py
dashboard/src/
  App.tsx
  types.ts
  dataClient.ts
  frameCodec.ts
  lodCodec.ts
  lodCodec.test.ts
  render/
    exactRenderer.ts
    lodRenderer.ts
    iconOverlay.ts
  workers/
    frameDecode.worker.ts
  components/
    WildfireViewport.tsx
    ViewModeBadge.tsx
    HotspotOverlay.tsx
    ExperimentSelector.tsx
    BenchmarkOnlyState.tsx
  tests/
    WildfireViewport.test.tsx
    ExperimentSelector.test.tsx
dashboard/public/data/
  manifest.json
  scenarios/
README.md
docs/dashboard-demo-guide.md
```

---

## 7. Step-by-Step Implementation Plan

### Task 1: Add a performance regression fixture

**Objective:** Reproduce the current large-frame bottleneck before changing rendering.

**Files:**

- Create: `dashboard/src/render/renderPerformance.test.ts`
- Create: `dashboard/src/tests/fixtures/largeFrame.ts`

**Step 1: Write failing test**

Create a deterministic 500×500 frame and assert the optimized renderer uses one raster pass and zero per-cell gradient creation. Expose renderer diagnostics only in tests:

```ts
expect(result.gradientObjectsCreated).toBe(0);
expect(result.rasterWrites).toBe(1);
```

**Step 2: Verify RED**

```bash
cd dashboard
npm test -- --run src/render/renderPerformance.test.ts
```

Expected: FAIL because the current renderer creates gradients in a loop and has no diagnostics API.

**Step 3: Commit test only**

```bash
git add dashboard/src/render/renderPerformance.test.ts dashboard/src/tests/fixtures/largeFrame.ts
git commit -m "test: reproduce large-grid rendering bottleneck"
```

---

### Task 2: Move rendering out of `App.tsx`

**Objective:** Separate data/UI state from Canvas rendering so render modes can be tested independently.

**Files:**

- Create: `dashboard/src/components/WildfireViewport.tsx`
- Create: `dashboard/src/render/exactRenderer.ts`
- Modify: `dashboard/src/App.tsx:10-25`
- Create: `dashboard/src/tests/WildfireViewport.test.tsx`

**TDD behavior:**

- exact frame renders through one `putImageData` call;
- renderer never mutates decoded cell data;
- no `createRadialGradient` inside a per-burning-cell loop;
- frame changes trigger one redraw;
- renderer can be cancelled when scenario changes.

**Implementation:**

Replace thousands of gradients with:

1. one base-state `ImageData` raster;
2. one burning-mask offscreen canvas;
3. one blurred/composited mask draw;
4. optional single colorized overlay.

**Verification:**

```bash
npm test -- --run src/tests/WildfireViewport.test.tsx src/render/renderPerformance.test.ts
npm run build
```

**Commit:**

```bash
git add dashboard/src
git commit -m "perf: replace per-cell fire gradients with raster masks"
```

---

### Task 3: Define LOD preview types and codec

**Objective:** Add an exact contract for aggregated density frames.

**Files:**

- Modify: `dashboard/src/types.ts`
- Create: `dashboard/src/lodCodec.ts`
- Create: `dashboard/src/lodCodec.test.ts`

**Types:**

```ts
export type DisplayMode = 'exact-cells' | 'lod-density' | 'benchmark-only';

export type LodFrame = {
  step: number;
  burningCells: number;
  burnedCells: number;
  burnedPercentage: number;
  lodRgbBase64: string;
  hotspots: Hotspot[];
};
```

**Tests:**

- decode exact expected byte length;
- reject truncated Base64;
- reject preview dimensions above configured limit;
- preserve density values exactly;
- do not allocate source-grid-sized arrays.

**Verification:**

```bash
npm test -- --run src/lodCodec.test.ts
```

**Commit:**

```bash
git add dashboard/src/types.ts dashboard/src/lodCodec.ts dashboard/src/lodCodec.test.ts
git commit -m "feat: add LOD density frame codec"
```

---

### Task 4: Add C++ preview aggregation without affecting benchmark timing

**Objective:** Generate bounded-size preview frames directly from full simulation grids.

**Files:**

- Modify: `wildfire_common.hpp`
- Modify: `serial_wildfire.cpp`
- Modify: `openmp_wildfire.cpp`
- Modify: `cuda_wildfire.cu`
- Modify: `mpi_wildfire.cpp`
- Create: `tests/test_preview_aggregation.cpp`
- Modify: `CMakeLists.txt`

**New CLI options:**

```text
--preview-output <path>
--preview-size <max dimension, default 500>
--preview-interval <steps>
```

**Important timing rule:**

Preview aggregation and file writing must execute outside measured benchmark samples. For benchmark runs:

1. run timed repetitions with preview disabled;
2. run one separate untimed visualization pass when preview is requested;
3. write preview metadata stating `excludedFromBenchmarkTiming: true`.

**Tests:**

- 4×4 source aggregated to 2×2 expected ratios;
- non-divisible source dimensions distribute cells correctly;
- state counts in preview metadata match source grid counts;
- checksum remains unchanged;
- preview generation does not change reported `runtimeMs` samples.

**Verification:**

```bash
cmake --build build_verified --config Release --parallel
ctest --test-dir build_verified -C Release --output-on-failure
python scripts/verify_correctness.py --build-dir build_verified/Release
```

**Commit:**

```bash
git add wildfire_common.hpp *_wildfire.* tests CMakeLists.txt
git commit -m "feat: generate untimed LOD preview frames"
```

---

### Task 5: Generate proposal-aligned visualization scenarios

**Objective:** Replace current 100/250/500-only manifest with source sizes matching the experiment plan.

**Files:**

- Modify: `scripts/prepare_dashboard_data.py`
- Create: `scripts/test_prepare_dashboard_data.py`
- Modify: `dashboard/public/data/manifest.json`
- Generate: `dashboard/public/data/scenarios/serial-500-preview.json`
- Generate: `dashboard/public/data/scenarios/serial-1000-preview.json`
- Generate: `dashboard/public/data/scenarios/serial-2000-preview.json`
- Generate: `dashboard/public/data/scenarios/serial-4000-preview.json`

**Scenario defaults:**

| Source grid | Demo timesteps | Preview interval | Preview |
|---:|---:|---:|---:|
| 500² | 100 | 10 | 500² exact |
| 1000² | 500 | 50 | 500² LOD |
| 2000² | 500 | 50 | 500² LOD |
| 4000² | 1000 | 100 | 500² LOD |

If a 4000² visualization pass is too expensive for routine development, the script must support:

```bash
python scripts/prepare_dashboard_data.py --sizes 500,1000
python scripts/prepare_dashboard_data.py --sizes 500,1000,2000,4000 --profile final
```

**Tests:**

- manifest source dimensions match requested sizes;
- all previews are ≤500×500;
- aggregation factor is accurate;
- frame files remain below configured size cap;
- no source-grid-sized array is emitted into dashboard JSON;
- generated preview data is marked untimed.

**Commit:**

```bash
git add scripts dashboard/public/data
git commit -m "data: add proposal-aligned LOD scenarios"
```

---

### Task 6: Add Web Worker frame decoding

**Objective:** Keep React controls responsive while Base64/LOD frames are decoded.

**Files:**

- Create: `dashboard/src/workers/frameDecode.worker.ts`
- Create: `dashboard/src/hooks/useDecodedFrame.ts`
- Create: `dashboard/src/hooks/useDecodedFrame.test.tsx`
- Modify: `dashboard/src/components/WildfireViewport.tsx`

**Behavior:**

- decoding occurs outside the main UI thread;
- stale decode results are discarded when user changes frame/size quickly;
- only one current and one next decoded frame are cached;
- worker is terminated when viewport unmounts;
- loading indicator appears for delayed frames.

**Verification:**

```bash
npm test -- --run dashboard/src/hooks/useDecodedFrame.test.tsx
npm run build
```

**Commit:**

```bash
git add dashboard/src/workers dashboard/src/hooks dashboard/src/components/WildfireViewport.tsx
git commit -m "perf: decode large preview frames in a worker"
```

---

### Task 7: Implement the LOD density renderer

**Objective:** Render every source grid through a bounded 500×500 raster.

**Files:**

- Create: `dashboard/src/render/lodRenderer.ts`
- Create: `dashboard/src/render/lodRenderer.test.ts`
- Modify: `dashboard/src/components/WildfireViewport.tsx`

**Rendering:**

- one `ImageData` generated from three density channels;
- one fire-intensity mask;
- one blurred mask draw;
- no loop that creates gradients/icons per cell;
- Canvas internal size equals preview dimensions, never source dimensions for LOD mode;
- scaling to CSS viewport uses GPU-friendly Canvas compositing.

**Tests:**

- 4000² source entry creates only 500² Canvas pixels;
- mixed tree/burning tile produces expected blended color;
- no source-sized `Uint8Array(4000*4000)` allocation;
- render diagnostics show bounded operations.

**Performance gate:**

- target frame render ≤16–33 ms on the current machine;
- playback controls respond immediately during 4000² preview;
- no growing memory usage across repeated playback loops.

**Commit:**

```bash
git add dashboard/src/render dashboard/src/components/WildfireViewport.tsx
git commit -m "perf: add bounded LOD density renderer"
```

---

### Task 8: Add sparse hotspot icons, not cell icons

**Objective:** Use icons only where they improve interpretation.

**Files:**

- Create: `dashboard/src/render/iconOverlay.ts`
- Create: `dashboard/src/components/HotspotOverlay.tsx`
- Create: `dashboard/src/render/iconOverlay.test.ts`
- Modify: `dashboard/src/components/WildfireViewport.tsx`

**Icons:**

- ignition point: one pin/flame icon;
- top active fire-front hotspots: maximum 12 flame markers;
- hotspot size reflects intensity;
- icon positions map from source coordinates to preview coordinates;
- icons have `pointer-events: none` unless tooltip interaction is explicitly added.

**Hard cap:**

```ts
const MAX_HOTSPOT_ICONS = 12;
```

**Tests:**

- never render more than 12 icons;
- highest-intensity hotspots are selected;
- mapping is correct for 4000→500 scale;
- no icons render for benchmark-only mode.

**Commit:**

```bash
git add dashboard/src/render/iconOverlay.ts dashboard/src/components dashboard/src/render/iconOverlay.test.ts
git commit -m "feat: add bounded fire hotspot icons"
```

---

### Task 9: Separate source grid, preview grid and benchmark grid in UI

**Objective:** Prevent users from confusing the displayed preview with the actual tested workload.

**Files:**

- Create: `dashboard/src/components/ExperimentSelector.tsx`
- Create: `dashboard/src/components/ViewModeBadge.tsx`
- Create: `dashboard/src/components/BenchmarkOnlyState.tsx`
- Modify: `dashboard/src/App.tsx`
- Create: `dashboard/src/tests/ExperimentSelector.test.tsx`

**UI fields:**

```text
Experiment grid: 4000 × 4000
Display mode: Aggregated LOD
Preview: 500 × 500
Aggregation: 8 × 8 cells/pixel
Timesteps: 1000
```

Selector values must align with proposal:

- grid: 500, 1000, 2000, 4000;
- timesteps: 100, 500, 1000;
- density: 60%, 70%, 80%;
- backend/result filters;
- OpenMP threads, MPI processes and CUDA block sizes where measured data exists.

Do not create selector options for result combinations that have not been benchmarked.

**Commit:**

```bash
git add dashboard/src/components dashboard/src/App.tsx dashboard/src/tests
git commit -m "feat: separate experiment and preview resolutions"
```

---

### Task 10: Expand benchmark automation to assignment dimensions

**Objective:** Populate tables/charts with the actual test matrix without forcing all combinations into one huge run.

**Files:**

- Modify: `scripts/run_benchmarks.py`
- Create: `scripts/test_run_benchmarks.py`
- Modify: `dashboard/src/types.ts`
- Modify: `dashboard/src/App.tsx`

**Profiles:**

```text
smoke:
  grid 500, steps 100, selected worker settings

scaling:
  grids 500/1000/2000/4000
  OpenMP 1/2/4/8/16
  MPI 1/2/4/8
  CUDA 128/256/512 and 1024 only if validated

final:
  selected grid × timestep × density combinations approved for report
```

Avoid a blind Cartesian product of every variable because it can produce hundreds of long runs. Record an experiment manifest showing exactly what was run and why.

**Validation:**

- each parallel result has matching Serial baseline;
- checksum comparison is automatic;
- failed CUDA 1024 configuration is reported, not fabricated;
- every output row includes grid, steps, density and hardware settings;
- dashboard filters derive from measured rows only.

**Commit:**

```bash
git add scripts dashboard/src
git commit -m "feat: automate assignment-scale benchmark profiles"
```

---

### Task 11: Add large-grid performance and memory verification

**Objective:** Prove that UI responsiveness no longer depends on source grid size.

**Files:**

- Create: `dashboard/src/render/largeGridPerformance.test.ts`
- Create: `dashboard/scripts/profile-render.mjs`
- Modify: `README.md`
- Create: `docs/large-grid-visualization.md`

**Verification matrix:**

| Source | Preview | Expected behavior |
|---:|---:|---|
| 500² | 500² | exact mode |
| 1000² | 500² | 2×2 aggregation |
| 2000² | 500² | 4×4 aggregation |
| 4000² | 500² | 8×8 aggregation |

**Acceptance criteria:**

- Canvas internal pixels never exceed 500×500 for LOD mode;
- main thread has no source-grid decode loop;
- frame operation count remains approximately constant from 1000² to 4000²;
- controls remain usable during playback;
- repeated scenario switching does not leak Workers/ArrayBuffers;
- file-size and load-time warnings are absent;
- backend correctness tests still pass.

Commands:

```bash
cd dashboard
npm test -- --run
npm run build
node scripts/profile-render.mjs
cd ..
python scripts/validate_dashboard_data.py
python scripts/verify_correctness.py --build-dir build_verified/Release
```

**Commit:**

```bash
git add dashboard docs README.md
git commit -m "test: verify large-grid LOD responsiveness"
```

---

## 8. Testing and Validation Summary

### C++ correctness

```bash
cmake --build build_verified --config Release --parallel
ctest --test-dir build_verified -C Release --output-on-failure
python scripts/verify_correctness.py --build-dir build_verified/Release
```

Expected: Serial/OpenMP/CUDA/MPI checksums and burned counts continue to match.

### Data pipeline

```bash
python -m unittest scripts/test_prepare_dashboard_data.py -v
python scripts/validate_dashboard_data.py
```

Expected: source dimensions, preview dimensions, aggregation factors, counts and file sizes are valid.

### Dashboard

```bash
cd dashboard
npm test -- --run
npm run build
npm run dev
```

Test manually:

1. choose 500×500;
2. choose 1000×1000;
3. choose 2000×2000;
4. choose 4000×4000;
5. play/pause/scrub each preview;
6. verify source and preview labels;
7. filter benchmark table by grid/timesteps/workers;
8. confirm no console errors.

---

## 9. Risks and Trade-offs

| Risk | Mitigation |
|---|---|
| Users think 500px preview means simulation ran only 500² | Always show Source Grid and Preview Resolution together |
| Aggregation hides a thin fire front | Store ratios, not dominant state; add bounded hotspot markers |
| Preview generation changes benchmark time | Generate in separate untimed pass |
| 4000² full frame output is enormous | Never emit full cells into dashboard JSON; emit only LOD channels |
| Icons still create clutter | Hard cap at 12 hotspots plus one ignition icon |
| Web Worker complexity | Keep one decoder worker and terminate on unmount |
| CUDA block 1024 unsupported/poor | Check device capability and record failure honestly |
| Full experiment Cartesian product is too long | Use smoke/scaling/final profiles and an explicit experiment manifest |
| LOD colors look like false accuracy | Label as Aggregated Density Preview and document blending method |

---

## 10. Recommended Decision

Use this strategy:

```text
Full simulation grid (500²–4000²)
        ↓ real backend computation and benchmark
Runtime / Speedup / Efficiency / Checksum / Burned %
        ↓ separate untimed preview pass
Maximum 500×500 aggregated density raster
        ↓ Canvas draws one raster + one glow mask
Maximum 12 hotspot icons + one ignition icon
```

Do **not** use one icon per cell. Icons should augment the LOD heatmap, not replace it.

---

## 11. Definition of Done

- [ ] Dashboard supports source experiment grids 500², 1000², 2000² and 4000².
- [ ] Full-size simulations remain the source of benchmark metrics.
- [ ] Preview Canvas never exceeds 500×500 for large-grid LOD mode.
- [ ] No per-cell gradient or per-cell icon loop remains.
- [ ] Main UI thread does not decode source-grid-sized arrays for 1000²–4000².
- [ ] Exact mode remains available for 500².
- [ ] LOD density mode preserves tree/burning/burned ratios.
- [ ] Maximum 12 hotspot icons and one ignition icon are used.
- [ ] UI clearly separates Source Grid, Preview Resolution and Aggregation Factor.
- [ ] Benchmark-only fallback works when preview data is absent.
- [ ] Timesteps, density, threads/processes/block-size filters derive from measured results.
- [ ] Preview generation is excluded from benchmark timing.
- [ ] Large-grid playback remains responsive with no memory leak.
- [ ] Tests, builds, correctness validation and data validation all pass.
