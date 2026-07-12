export type Backend = 'serial' | 'openmp' | 'cuda' | 'mpi';
export type DisplayMode = 'exact-cells' | 'lod-density' | 'benchmark-only';
export type Hotspot = { row: number; col: number; intensity: number };
export type Frame = { step: number; burningCells?: number; burnedCells?: number; burnedPercentage?: number; cells?: number[]; cells2BitBase64?: string; burningMaskBase64?: string; lodRgbBase64?: string; hotspots?: Hotspot[] };
export type ScenarioEntry = { id: string; label: string; backend: Backend; rows: number; cols: number; steps: number; frameInterval: number; url?: string; displayMode: DisplayMode; previewRows?: number; previewCols?: number; aggregationRows?: number; aggregationCols?: number };
export type Manifest = { schemaVersion: number; generatedAt: string; visualizationScenarios: ScenarioEntry[]; benchmarksUrl: string };
export type Scenario = ScenarioEntry & { frames: Frame[] };
export type Benchmark = { backend: Backend; rows: number; cols: number; steps?: number; density?: number; workers: number; blockSize: number; runtimeMs: { samples: number[]; mean: number; median: number; stddev: number }; speedup: number; efficiency: number | null; burnedCells: number; checksum: string; correctness?: 'match' | 'mismatch' };
