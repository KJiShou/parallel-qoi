# Electron Wildfire Dashboard UX Redesign Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** 将现有简陋的 Electron/React 页面重构成容易操作、容易比较数据、适合 assignment demo 的 wildfire analytics dashboard，并支持用户切换 100×100、250×250、500×500 visualization grid。

**Architecture:** 保持 C++ Serial/OpenMP/CUDA/MPI 为唯一 computation source；Python data-preparation script 生成带 manifest 的预计算 visualization datasets 和 benchmark datasets。React dashboard 拆成清晰的 scenario controls、增强型 Canvas renderer、summary cards、charts 和可过滤 table；Electron 只负责安全地承载静态 dashboard，不参与 benchmark timing，也不直接修改 simulation data。

**Tech Stack:** Electron, React 19, TypeScript, Vite, HTML Canvas 2D, CSS, Python 3, C++17 executables, Vitest + React Testing Library, JSON manifest, packed 2-bit frame payloads.

---

## 1. Current Context

Current implementation:

- `dashboard/src/main.tsx` contains the entire UI, data loading, playback, Canvas drawing, metrics and table in one file.
- `dashboard/src/style.css` is one compressed line and has no maintainable token/component structure.
- `dashboard/public/data/demo_serial.json` contains only one 100×100 scenario.
- `dashboard/public/data/benchmarks.json` currently contains 128×128 and 256×256 smoke results.
- Canvas uses direct one-color-per-cell `putImageData`, so it correctly shows states but visually looks like a plain block grid.
- Benchmark table exists, but has no filtering, grouping, explanation tooltip, status badge, sticky header or mobile treatment.
- Playback has play/pause, previous/next and a slider, but no grid-size selector, backend selector, frame speed selector, progress label, reset or loading state.

The redesign must preserve scientific honesty:

1. The authoritative cell states remain `Empty`, `Tree`, `Burning`, and `Burned` from C++ output.
2. Glow, smoke, sparks and soft edges are visual overlays only; they must not change cell states or benchmark results.
3. Visualization scale and benchmark scale remain separate concepts.
4. Dashboard rendering time must never be included in backend runtime.

---

## 2. Proposed User Experience

### Desktop layout

```text
┌──────────────────────────────────────────────────────────────────┐
│ Wildfire Compute Lab                            Dataset: Verified │
│ Compare Serial · OpenMP · CUDA · MPI                             │
├──────────────────────────────────────────────────────────────────┤
│ Grid Size [100×100 ▼]  Backend [Serial ▼]  Speed [1× ▼]  Reset  │
├───────────────────────────────────────┬──────────────────────────┤
│                                       │ Step / Progress          │
│      Enhanced Wildfire Canvas         │ Burning cells            │
│      terrain + fire glow + smoke      │ Burned area %            │
│                                       │ Checksum status          │
│   ◀  Play/Pause  ▶  timeline          │ Runtime / backend        │
├───────────────────────────────────────┴──────────────────────────┤
│ Runtime | Speedup | Efficiency | Correctness summary cards       │
├──────────────────────────────────────────────────────────────────┤
│ Performance Comparison                                           │
│ [Runtime chart] [Speedup chart] [Scaling chart]                  │
├──────────────────────────────────────────────────────────────────┤
│ Benchmark Results Table                                          │
│ Filters · sortable columns · status · efficiency explanation     │
└──────────────────────────────────────────────────────────────────┘
```

### Grid-size choices

Initial supported visualization choices:

- `100×100` — fastest/smoothest playback, useful for explaining individual spread fronts.
- `250×250` — balanced detail and file size.
- `500×500` — dense wildfire pattern for visually impressive demo.

Do not offer a size until its manifest entry and data file both exist. Future sizes can be added through the manifest without changing React components.

### Visual direction

Use a data-dense dark developer dashboard inspired by Sentry, but retain the wildfire identity:

- deep charcoal/purple background, not pure black;
- warm fire palette: amber → orange → red → charcoal;
- lime/green reserved for verified checksum and healthy state;
- structured cards with restrained glass effect;
- Rubik for UI text and JetBrains Mono for measurements/checksums;
- no oversized landing-page hero; this is an application dashboard;
- all important information visible without excessive scrolling on 1440×900.

---

## 3. Target File Structure

```text
dashboard/
  src/
    App.tsx
    main.tsx
    styles/
      tokens.css
      layout.css
      components.css
    types/
      data.ts
    lib/
      dataClient.ts
      frameCodec.ts
      benchmarkMetrics.ts
      colorMap.ts
    hooks/
      useScenario.ts
      usePlayback.ts
    components/
      AppHeader.tsx
      ScenarioToolbar.tsx
      WildfireViewport.tsx
      PlaybackControls.tsx
      SimulationStats.tsx
      SummaryCards.tsx
      PerformanceCharts.tsx
      BenchmarkTable.tsx
      StatusBadge.tsx
      EmptyState.tsx
      ErrorState.tsx
    tests/
      dataClient.test.ts
      frameCodec.test.ts
      benchmarkMetrics.test.ts
      usePlayback.test.tsx
      ScenarioToolbar.test.tsx
      BenchmarkTable.test.tsx
      WildfireViewport.test.tsx
  public/data/
    manifest.json
    scenarios/
      serial-100.json
      serial-250.json
      serial-500.json
    benchmarks.json
scripts/
  prepare_dashboard_data.py
  test_prepare_dashboard_data.py
```

---

## 4. Data Contracts

### Manifest

Create `dashboard/public/data/manifest.json`:

```json
{
  "schemaVersion": 2,
  "generatedAt": "2026-07-12T15:00:00+08:00",
  "visualizationScenarios": [
    {
      "id": "serial-100",
      "label": "100 × 100",
      "backend": "serial",
      "rows": 100,
      "cols": 100,
      "steps": 200,
      "frameInterval": 5,
      "url": "/data/scenarios/serial-100.json"
    },
    {
      "id": "serial-250",
      "label": "250 × 250",
      "backend": "serial",
      "rows": 250,
      "cols": 250,
      "steps": 300,
      "frameInterval": 10,
      "url": "/data/scenarios/serial-250.json"
    },
    {
      "id": "serial-500",
      "label": "500 × 500",
      "backend": "serial",
      "rows": 500,
      "cols": 500,
      "steps": 400,
      "frameInterval": 20,
      "url": "/data/scenarios/serial-500.json"
    }
  ],
  "benchmarksUrl": "/data/benchmarks.json"
}
```

### Packed frame format

A plain `500×500` integer array repeated across many frames is unnecessarily large. Pack four 2-bit cell states into each byte, then Base64 encode it:

```json
{
  "schemaVersion": 2,
  "scenarioId": "serial-500",
  "rows": 500,
  "cols": 500,
  "steps": 400,
  "frames": [
    {
      "step": 0,
      "burningCells": 1,
      "burnedCells": 0,
      "cells2BitBase64": "..."
    }
  ]
}
```

Packing rule:

```text
byte = cell0 | (cell1 << 2) | (cell2 << 4) | (cell3 << 6)
```

This preserves exact states and reduces frame payload substantially. The browser decoder must verify that the decoded cell count equals `rows × cols`.

### Benchmark records

Keep the existing benchmark fields and add explicit correctness/timing metadata during preparation:

```ts
export type BenchmarkRecord = {
  backend: 'serial' | 'openmp' | 'cuda' | 'mpi';
  rows: number;
  cols: number;
  workers: number;
  blockSize: number;
  runtimeMs: { samples: number[]; mean: number; median: number; stddev: number };
  speedup: number;
  efficiency: number | null;
  burnedCells: number;
  checksum: string;
  correctness: 'match' | 'mismatch';
  timingScope: 'simulation' | 'kernel' | 'end-to-end';
};
```

---

## 5. Step-by-Step Implementation Plan

### Task 1: Add dashboard test infrastructure

**Objective:** Establish a test command before changing UI behavior.

**Files:**

- Modify: `dashboard/package.json`
- Create: `dashboard/vitest.config.ts`
- Create: `dashboard/src/tests/setup.ts`

**Step 1: Add a failing smoke test**

Create `dashboard/src/tests/app-smoke.test.tsx` expecting an `App` export that does not yet exist:

```tsx
import { render, screen } from '@testing-library/react';
import { App } from '../App';

test('renders the wildfire dashboard title', () => {
  render(<App />);
  expect(screen.getByRole('heading', { name: /wildfire compute lab/i })).toBeInTheDocument();
});
```

**Step 2: Verify RED**

Run:

```bash
cd dashboard
npm test -- --run src/tests/app-smoke.test.tsx
```

Expected: FAIL because `src/App.tsx` does not exist.

**Step 3: Add test dependencies/scripts**

Add `vitest`, `jsdom`, `@testing-library/react`, `@testing-library/jest-dom`, and `@testing-library/user-event`. Add:

```json
"test": "vitest",
"test:run": "vitest run"
```

**Step 4: Commit**

```bash
git add dashboard/package.json dashboard/package-lock.json dashboard/vitest.config.ts dashboard/src/tests
git commit -m "test: add dashboard test infrastructure"
```

---

### Task 2: Define strict manifest, scenario and benchmark types

**Objective:** Make data loading predictable and reject malformed datasets clearly.

**Files:**

- Create: `dashboard/src/types/data.ts`
- Create: `dashboard/src/lib/dataClient.ts`
- Create: `dashboard/src/tests/dataClient.test.ts`

**Step 1: Write failing tests**

Test:

- valid manifest is accepted;
- missing `visualizationScenarios` is rejected;
- unsupported `schemaVersion` is rejected;
- failed HTTP response includes URL/status in the error.

Desired API:

```ts
const manifest = await loadManifest('/data/manifest.json');
const scenario = await loadScenario(manifest.visualizationScenarios[0]);
const benchmarks = await loadBenchmarks(manifest.benchmarksUrl);
```

**Step 2: Verify RED**

```bash
npm test -- --run src/tests/dataClient.test.ts
```

Expected: FAIL because loaders do not exist.

**Step 3: Implement minimal loaders and runtime guards**

Do not silently cast `unknown` data. Validate schema version, dimensions, URLs and required fields.

**Step 4: Verify GREEN and commit**

```bash
npm test -- --run src/tests/dataClient.test.ts
npm run build
git add dashboard/src/types dashboard/src/lib/dataClient.ts dashboard/src/tests/dataClient.test.ts
git commit -m "feat: add dashboard data contracts"
```

---

### Task 3: Implement exact 2-bit frame codec

**Objective:** Support 500×500 frames without oversized integer-array JSON.

**Files:**

- Create: `dashboard/src/lib/frameCodec.ts`
- Create: `dashboard/src/tests/frameCodec.test.ts`
- Create: `scripts/test_prepare_dashboard_data.py`
- Modify later: `scripts/prepare_dashboard_data.py`

**Step 1: Write failing TypeScript tests**

Test round-trip examples:

```ts
expect(decode2BitCells(encodeFixture([0, 1, 2, 3]), 4)).toEqual(
  new Uint8Array([0, 1, 2, 3])
);
```

Also test incomplete final byte and invalid decoded length.

**Step 2: Write failing Python tests**

Test `pack_cells_2bit([0,1,2,3]) == bytes([0b11100100])` and reject states outside `0..3`.

**Step 3: Implement decoder/packer**

TypeScript decoder returns `Uint8Array`; Python packer returns Base64.

**Step 4: Verify both suites**

```bash
npm test -- --run src/tests/frameCodec.test.ts
python -m unittest scripts/test_prepare_dashboard_data.py -v
```

**Step 5: Commit**

```bash
git add dashboard/src/lib/frameCodec.ts dashboard/src/tests/frameCodec.test.ts scripts/test_prepare_dashboard_data.py
git commit -m "feat: add compact wildfire frame codec"
```

---

### Task 4: Generate 100×100, 250×250 and 500×500 visualization datasets

**Objective:** Produce selectable scenario files from the actual C++ executable.

**Files:**

- Create: `scripts/prepare_dashboard_data.py`
- Create: `dashboard/public/data/manifest.json`
- Create: `dashboard/public/data/scenarios/serial-100.json`
- Create: `dashboard/public/data/scenarios/serial-250.json`
- Create: `dashboard/public/data/scenarios/serial-500.json`
- Modify: `README.md`

**Step 1: Extend failing Python tests**

Test that preparation:

- invokes the executable with fixed seed/density;
- includes initial and final frames;
- computes burning/burned counts from unpacked cells;
- writes manifest entries only after scenario files succeed;
- enforces a maximum final file size;
- never changes benchmark runtime fields.

**Step 2: Implement the script**

Use an intermediate temporary JSON from the Serial executable, pack each frame, write schema v2 output, then remove temporary data.

Suggested commands generated by the script:

```bash
wildfire_serial.exe --rows 100 --cols 100 --steps 200 --frame-interval 5 ...
wildfire_serial.exe --rows 250 --cols 250 --steps 300 --frame-interval 10 ...
wildfire_serial.exe --rows 500 --cols 500 --steps 400 --frame-interval 20 ...
```

**Step 3: Verify generated data**

```bash
python scripts/prepare_dashboard_data.py --build-dir build_verified/Release
python -m unittest scripts/test_prepare_dashboard_data.py -v
```

Expected:

- three scenario files;
- valid manifest;
- all decoded frame lengths match dimensions;
- checksums/stats derive from exact C++ states;
- no file exceeds the configured limit.

**Step 4: Commit**

```bash
git add scripts dashboard/public/data README.md
git commit -m "data: add selectable wildfire visualization datasets"
```

---

### Task 5: Split the monolithic App and add loading/error states

**Objective:** Replace the 40-line compressed monolith with maintainable application structure.

**Files:**

- Create: `dashboard/src/App.tsx`
- Modify: `dashboard/src/main.tsx`
- Create: `dashboard/src/components/EmptyState.tsx`
- Create: `dashboard/src/components/ErrorState.tsx`
- Create: `dashboard/src/hooks/useScenario.ts`
- Modify: `dashboard/src/tests/app-smoke.test.tsx`

**Step 1: Update failing test**

Expect:

- application title;
- loading indicator before manifest resolves;
- actionable error message when data load fails;
- no blank page.

**Step 2: Implement App shell**

`main.tsx` should only mount `<App />`. `App.tsx` coordinates manifest, selected scenario, benchmark data and child components.

**Step 3: Verify**

```bash
npm test -- --run src/tests/app-smoke.test.tsx
npm run build
```

**Step 4: Commit**

```bash
git add dashboard/src
git commit -m "refactor: split dashboard application shell"
```

---

### Task 6: Add grid-size, backend and playback controls

**Objective:** Let users clearly select visualization size and control playback.

**Files:**

- Create: `dashboard/src/components/ScenarioToolbar.tsx`
- Create: `dashboard/src/components/PlaybackControls.tsx`
- Create: `dashboard/src/hooks/usePlayback.ts`
- Create: `dashboard/src/tests/ScenarioToolbar.test.tsx`
- Create: `dashboard/src/tests/usePlayback.test.tsx`

**Step 1: Write failing behavior tests**

Test:

- grid dropdown contains 100×100, 250×250 and 500×500 from manifest;
- selecting 500×500 resets frame index and loads `serial-500`;
- play/pause toggles;
- previous/next is bounded;
- reset returns to step 0;
- speed options are 0.5×, 1×, 2×, 4×;
- playback stops at final frame;
- controls disable while scenario is loading.

**Step 2: Implement hook/components**

Do not hard-code sizes in React. Render options from manifest.

**Step 3: Verify and commit**

```bash
npm test -- --run src/tests/ScenarioToolbar.test.tsx src/tests/usePlayback.test.tsx
git add dashboard/src/components dashboard/src/hooks dashboard/src/tests
git commit -m "feat: add scenario and playback controls"
```

---

### Task 7: Build a layered wildfire renderer instead of a plain grid

**Objective:** Make fire spread visually compelling while keeping cell-state data exact.

**Files:**

- Create: `dashboard/src/components/WildfireViewport.tsx`
- Create: `dashboard/src/lib/colorMap.ts`
- Create: `dashboard/src/tests/WildfireViewport.test.tsx`

**Rendering layers:**

1. **Authoritative terrain layer** — exact cell states drawn to an offscreen low-resolution canvas.
2. **Scaled visual layer** — draw the offscreen canvas with smoothing enabled only for display scaling.
3. **Fire bloom layer** — burning pixels rendered again with additive blend, warm gradient and controlled blur.
4. **Fire-front highlight** — cells that changed from Tree to Burning receive a brighter yellow edge.
5. **Smoke layer** — deterministic particles seeded from burning-cell positions; opacity and drift depend on frame index, not randomness per render.
6. **Vignette/terrain texture** — subtle non-data decorative overlay; never hides the legend or changes stats.

Suggested palette:

```ts
export const STATE_COLORS = {
  empty: '#171820',
  tree: '#245f3d',
  treeHighlight: '#3f8f55',
  burningCore: '#fff1a8',
  burningMid: '#ff9a3c',
  burningOuter: '#ef3d25',
  burned: '#26242a'
};
```

**Step 1: Write failing tests**

Verify that:

- Canvas dimensions equal scenario dimensions internally;
- one frame of `Uint8Array` is accepted;
- renderer does not mutate input cells;
- changing frame redraws layers;
- reduced-motion preference disables smoke animation but not fire state rendering.

**Step 2: Implement renderer**

Use Canvas only; do not create DOM elements per cell. Cap decorative particles based on viewport size, not total burning-cell count.

**Step 3: Profile 500×500**

Use browser Performance tools or an in-app debug counter. Target:

- controls remain responsive;
- frame render under 16–33 ms on the current machine;
- no unbounded memory growth while playing the full sequence.

**Step 4: Verify and commit**

```bash
npm test -- --run src/tests/WildfireViewport.test.tsx
npm run build
git add dashboard/src/components/WildfireViewport.tsx dashboard/src/lib/colorMap.ts dashboard/src/tests/WildfireViewport.test.tsx
git commit -m "feat: add layered wildfire visualization"
```

---

### Task 8: Add clear simulation statistics and correctness status

**Objective:** Make the current simulation state understandable without reading the table.

**Files:**

- Create: `dashboard/src/components/SimulationStats.tsx`
- Create: `dashboard/src/components/StatusBadge.tsx`
- Create: `dashboard/src/components/SummaryCards.tsx`
- Create: `dashboard/src/lib/benchmarkMetrics.ts`
- Create: `dashboard/src/tests/benchmarkMetrics.test.ts`

**Display:**

- current step / total step;
- burning cells;
- burned cells and percentage;
- selected grid size;
- selected backend;
- checksum status (`Verified match` / `Mismatch`);
- selected backend median runtime;
- speedup vs Serial;
- efficiency only for OpenMP/MPI;
- explanatory label `Not applicable` instead of an unexplained dash for Serial/CUDA.

**Step 1: Write failing metric tests**

Test correct matching by `(backend, rows, cols)`, correct percentage calculation, and explicit efficiency reason:

```ts
expect(formatEfficiency(cudaRecord)).toEqual({
  value: 'Not applicable',
  reason: 'GPU execution does not use the CPU/MPI worker-efficiency formula.'
});
```

**Step 2: Implement cards and tooltips**

Use concise tooltips for Speedup, Efficiency and Checksum.

**Step 3: Verify and commit**

```bash
npm test -- --run src/tests/benchmarkMetrics.test.ts
git add dashboard/src/components dashboard/src/lib/benchmarkMetrics.ts dashboard/src/tests
git commit -m "feat: clarify simulation and performance metrics"
```

---

### Task 9: Add readable performance charts

**Objective:** Let users visually compare backends before reading individual table rows.

**Files:**

- Create: `dashboard/src/components/PerformanceCharts.tsx`
- Modify: `dashboard/package.json`
- Create: `dashboard/src/tests/PerformanceCharts.test.tsx`

Use one chart library only (recommended: ECharts) and lazy-load it.

Charts:

1. Median runtime by backend for selected benchmark grid.
2. Speedup by backend.
3. OpenMP/MPI efficiency; CUDA and Serial omitted with a visible note, not plotted as zero.
4. Optional scaling chart when multiple thread/process records become available.

**Tests:**

- selected grid filters chart series;
- missing efficiency is excluded rather than converted to zero;
- units and labels are visible;
- no-data state renders clearly.

**Verification:**

```bash
npm test -- --run src/tests/PerformanceCharts.test.tsx
npm run build
```

**Commit:**

```bash
git add dashboard/package.json dashboard/package-lock.json dashboard/src
git commit -m "feat: add backend performance charts"
```

---

### Task 10: Redesign the benchmark table for filtering and explanation

**Objective:** Keep the required data table but make it useful for actual comparison.

**Files:**

- Create: `dashboard/src/components/BenchmarkTable.tsx`
- Create: `dashboard/src/tests/BenchmarkTable.test.tsx`

Required columns:

- Backend
- Grid size
- Workers / block size
- Median runtime
- Speedup
- Efficiency
- Burned cells
- Checksum status
- Sample count / standard deviation (expandable details)

Interactions:

- filter by grid size;
- filter by backend;
- sort by runtime, speedup and efficiency;
- sticky header;
- row highlight for fastest matching configuration;
- `Verified` badge when checksum matches Serial for the same input;
- `Not applicable` tooltip for Serial/CUDA efficiency;
- expandable row for raw timing samples;
- mobile horizontal scroll without truncating values.

**TDD cycle:**

1. Write tests for filters, sorting, fastest-row marker, checksum badge and efficiency text.
2. Verify tests fail.
3. Implement minimum table behavior.
4. Run tests and full dashboard build.
5. Commit:

```bash
git add dashboard/src/components/BenchmarkTable.tsx dashboard/src/tests/BenchmarkTable.test.tsx
git commit -m "feat: add interactive benchmark results table"
```

---

### Task 11: Apply the dashboard design system and responsive layout

**Objective:** Replace compressed ad-hoc CSS with a coherent, maintainable UI system.

**Files:**

- Create: `dashboard/src/styles/tokens.css`
- Create: `dashboard/src/styles/layout.css`
- Create: `dashboard/src/styles/components.css`
- Modify: `dashboard/src/main.tsx`
- Remove after migration: `dashboard/src/style.css`

Core tokens:

```css
:root {
  --bg-deep: #121019;
  --bg-app: #1a1724;
  --surface-1: #211d2c;
  --surface-2: #2a2438;
  --border: #3d344e;
  --text-primary: #f7f5fb;
  --text-secondary: #b9b1c5;
  --accent-fire: #ff7a3d;
  --accent-fire-soft: #ffb287;
  --accent-verified: #c2ef4e;
  --focus: #8f7bd8;
  --font-ui: 'Rubik', system-ui, sans-serif;
  --font-mono: 'JetBrains Mono', ui-monospace, monospace;
  --radius-sm: 8px;
  --radius-md: 12px;
  --radius-lg: 18px;
}
```

Responsive acceptance criteria:

- 1440×900: canvas, stats and controls visible above the fold.
- 1024×768: canvas and stats remain side-by-side where possible.
- <768px: single-column layout; table scrolls horizontally.
- Keyboard focus is visible.
- Color is never the only correctness indicator.
- `prefers-reduced-motion` disables decorative movement.

**Verification:**

```bash
npm test -- --run
npm run build
npm run dev
```

Inspect at 1440×900, 1024×768 and 390×844.

**Commit:**

```bash
git add dashboard/src/styles dashboard/src/main.tsx dashboard/src/style.css
git commit -m "style: redesign wildfire analytics dashboard"
```

---

### Task 12: Verify Electron packaging and local data loading

**Objective:** Ensure the redesigned UI behaves inside Electron, not only Vite dev server.

**Files:**

- Modify if needed: `dashboard/electron/main.cjs`
- Modify if needed: `dashboard/vite.config.ts`
- Modify: `dashboard/package.json`
- Create: `dashboard/scripts/verify-data.cjs`

**Steps:**

1. Add `verify:data` script to check manifest URLs and scenario files before build.
2. Ensure Vite uses a relative base (`base: './'`) so `file://` loading works in Electron production build.
3. Build dashboard.
4. Launch Electron from `dist/`.
5. Verify:
   - all three grid sizes load;
   - switching scenarios works repeatedly;
   - Canvas, table and charts render;
   - no DevTools errors;
   - no Node integration is exposed to renderer;
   - benchmark data is still precomputed.

Commands:

```bash
cd dashboard
npm run verify:data
npm test -- --run
npm run build
npm run electron
```

**Commit:**

```bash
git add dashboard/electron dashboard/vite.config.ts dashboard/package.json dashboard/scripts
git commit -m "fix: verify Electron dashboard data loading"
```

---

### Task 13: Final usability and performance review

**Objective:** Confirm that a first-time user can understand and operate the dashboard during a demo.

**Files:**

- Modify based on findings: dashboard components/styles/tests
- Modify: `README.md`
- Create: `docs/dashboard-demo-guide.md`

Usability script:

1. Ask a tester to select 500×500 without instruction.
2. Ask them to play, pause, scrub and reset.
3. Ask them to identify which backend is fastest for a selected benchmark grid.
4. Ask why Serial/CUDA efficiency is not shown.
5. Ask them to confirm whether backend outputs match.

Success criteria:

- all five tasks can be completed in under two minutes;
- user does not confuse visualization size with benchmark size;
- user understands that visual effects are decorative overlays;
- table values remain traceable to JSON data;
- 500×500 playback is responsive;
- all tests/builds pass.

Final verification:

```bash
python scripts/verify_correctness.py --build-dir build_verified/Release
python -m unittest scripts/test_prepare_dashboard_data.py -v
cd dashboard
npm run verify:data
npm test -- --run
npm run build
```

Commit:

```bash
git add README.md docs dashboard scripts
git commit -m "docs: add redesigned dashboard demo guide"
```

---

## 6. Files Likely to Change

### Existing files

- `dashboard/src/main.tsx`
- `dashboard/src/style.css` (removed after migration)
- `dashboard/package.json`
- `dashboard/package-lock.json`
- `dashboard/vite.config.ts`
- `dashboard/electron/main.cjs`
- `dashboard/public/data/benchmarks.json`
- `README.md`

### New application files

- `dashboard/src/App.tsx`
- `dashboard/src/components/*.tsx`
- `dashboard/src/hooks/*.ts`
- `dashboard/src/lib/*.ts`
- `dashboard/src/types/data.ts`
- `dashboard/src/styles/*.css`
- `dashboard/src/tests/*`

### New generated/static data files

- `dashboard/public/data/manifest.json`
- `dashboard/public/data/scenarios/serial-100.json`
- `dashboard/public/data/scenarios/serial-250.json`
- `dashboard/public/data/scenarios/serial-500.json`

### New scripts/docs

- `scripts/prepare_dashboard_data.py`
- `scripts/test_prepare_dashboard_data.py`
- `dashboard/scripts/verify-data.cjs`
- `docs/dashboard-demo-guide.md`

---

## 7. Test and Validation Matrix

| Area | Test | Expected |
|---|---|---|
| Data manifest | malformed schema/version | explicit error state |
| Frame codec | pack/unpack 0–3 states | exact round trip |
| 500×500 data | decoded cell count | exactly 250,000 cells/frame |
| Scenario selector | switch 100→500 | data reload, frame resets to 0 |
| Playback | play to final frame | stops without overflow |
| Renderer | reduced motion | no animated smoke; states remain visible |
| Metrics | CUDA efficiency | “Not applicable” with explanation |
| Table | filter/sort | deterministic expected rows/order |
| Correctness | checksum comparison | Verified badges for matching records |
| Electron | production `file://` load | manifest/data load successfully |
| Responsive | 390px viewport | controls usable, table scrollable |
| Performance | 500×500 playback | responsive; no memory growth |
| Backend regression | correctness script | Serial/OpenMP/CUDA/MPI all PASS |

---

## 8. Risks and Trade-offs

| Risk | Mitigation |
|---|---|
| 500×500 JSON becomes too large | 2-bit packed Base64 frames and selected frame intervals |
| Decorative fire effects imply different simulation output | Keep exact data layer visible; label overlays as visualization effects |
| Smoke particles reduce performance | deterministic capped particle count; reduced-motion support |
| Benchmark table and visualization use different grid sizes | separate selectors/labels: “Visualization Grid” and “Benchmark Grid” |
| ECharts increases bundle size | lazy-load chart section; one chart library only |
| Electron loads Vite assets incorrectly from `file://` | set Vite relative base and run production Electron verification |
| User thinks CUDA efficiency is missing data | render “Not applicable” with tooltip, not an unexplained dash |
| Future backend-specific frames multiply data size | default to one canonical Serial animation; use backend selector for metrics unless backend frames are intentionally generated |

---

## 9. Open Decisions with Recommended Defaults

1. **Should visualization backend selector change animation data?**  
   Recommended default: No. Use one canonical Serial animation because verified backends produce identical states; backend selector changes metrics/highlighting only. This avoids storing four identical 500×500 frame sets.

2. **Should 1000×1000 be offered for animation?**  
   Recommended default: No initially. Use 500×500 maximum for visualization and reserve 1000×1000+ for benchmarks.

3. **Should fire look realistic or game-like?**  
   Recommended default: scientific-cinematic: exact map states plus restrained bloom, smoke and fire-front highlighting. Avoid cartoon flames that obscure the cellular automata evidence.

4. **Should the dashboard launch executables live?**  
   Recommended default: No. Keep precomputed data workflow for presentation reliability and assignment timing integrity.

---

## 10. Definition of Done

- [ ] User can choose 100×100, 250×250 and 500×500 from a visible control.
- [ ] Switching size loads the correct data and resets playback safely.
- [ ] Wildfire visualization uses layered terrain, fire bloom, smoke and spread-front effects without changing cell states.
- [ ] Playback controls include play/pause, step, scrub, reset and speed selection.
- [ ] Summary cards explain runtime, speedup, efficiency and checksum.
- [ ] Serial/CUDA efficiency shows “Not applicable” with a reason.
- [ ] Performance charts compare backend runtime and speedup.
- [ ] Benchmark table supports filtering, sorting and correctness status.
- [ ] 500×500 dataset remains practical through 2-bit packing.
- [ ] UI is usable at desktop, tablet and mobile widths.
- [ ] Electron production build loads local manifest/data successfully.
- [ ] Dashboard tests, build, data validation and backend correctness all pass.
- [ ] README and demo guide explain how to generate data and run the dashboard.
