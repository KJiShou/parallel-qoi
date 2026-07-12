export type Backend = 'serial' | 'openmp' | 'cuda' | 'mpi';
export type Frame = { step: number; burningCells?: number; burnedCells?: number; cells?: number[]; cells2BitBase64?: string };
export type ScenarioEntry = { id: string; label: string; backend: Backend; rows: number; cols: number; steps: number; frameInterval: number; url: string };
export type Manifest = { schemaVersion: number; generatedAt: string; visualizationScenarios: ScenarioEntry[]; benchmarksUrl: string };
export type Scenario = ScenarioEntry & { frames: Frame[] };
export type Benchmark = { backend: Backend; rows: number; cols: number; workers: number; blockSize: number; runtimeMs: { samples: number[]; mean: number; median: number; stddev: number }; speedup: number; efficiency: number | null; burnedCells: number; checksum: string; correctness?: 'match' | 'mismatch' };
