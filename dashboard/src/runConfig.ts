import type { Backend } from './types';
import type { RunConfig } from './desktopApi';

export const BACKEND_ORDER: Backend[] = ['serial', 'openmp', 'cuda', 'mpi'];
export const FIXED_TIME_PLAYBACK = { virtualWindowMs: 5000, screenDurationMs: 10000, traceFrameInterval: 10, benchmarkSteps: 100 } as const;
export const FIXED_RUN_SETTINGS = {
  steps: 100 as const,
  repetitions: 3 as const,
  seed: 42,
  openmpThreads: 4 as const,
  mpiProcesses: 4 as const,
  cudaBlockSize: 256 as const,
  previewSize: 500 as const,
};

export type RunSelection = { rows: 500 | 1000 | 2000 | 4000; density: 0.6 | 0.7 | 0.8; methods: Backend[] };

export function buildSelectedConfigs(selection: RunSelection): RunConfig[] {
  const methods = BACKEND_ORDER.filter((backend) => selection.methods.includes(backend));
  if (!methods.length) throw new Error('Select at least one method');
  return methods.map((backend) => ({
    backend,
    rows: selection.rows,
    cols: selection.rows,
    density: selection.density,
    ...FIXED_RUN_SETTINGS,
    threads: backend === 'openmp' ? FIXED_RUN_SETTINGS.openmpThreads : undefined,
    processes: backend === 'mpi' ? FIXED_RUN_SETTINGS.mpiProcesses : undefined,
    blockSize: backend === 'cuda' ? FIXED_RUN_SETTINGS.cudaBlockSize : undefined,
  } as RunConfig));
}

export function aggregationForGrid(rows: number): number {
  return Math.max(1, Math.floor(rows / FIXED_RUN_SETTINGS.previewSize));
}

export function stepsPerSecond(medianMs: number): number { return Number.isFinite(medianMs) && medianMs > 0 ? FIXED_TIME_PLAYBACK.benchmarkSteps * 1000 / medianMs : 0; }
export function rawStepAtVirtualTime(virtualMs: number, medianMs: number): number { return Math.floor(Math.max(0, virtualMs) * stepsPerSecond(medianMs) / 1000); }
export const TRACE_CELL_UPDATE_BUDGET = 2_000_000_000;
export function visualizationDepthForGrid(grid: number): number { const geometricDepth=Math.max(1,Math.floor(grid/2));const budgetDepth=Math.max(1,Math.floor(TRACE_CELL_UPDATE_BUDGET/(grid*grid)));return Math.min(geometricDepth,budgetDepth); }
export function requiredTraceSteps(medians: number[], grid: number): number {
  const derivedMaximum = Math.max(1, ...medians.map((median) => rawStepAtVirtualTime(FIXED_TIME_PLAYBACK.virtualWindowMs, median)));
  return Math.min(derivedMaximum, visualizationDepthForGrid(grid));
}
export function firstSampledExtinguishedStep(frames: { step: number }[], burningByFrame: boolean[]): number | undefined {
  let lastBurning = -1;
  for (let index = 0; index < Math.min(frames.length, burningByFrame.length); index += 1) if (burningByFrame[index]) lastBurning = index;
  const firstExtinguished = lastBurning + 1;
  return firstExtinguished < frames.length ? frames[firstExtinguished].step : undefined;
}
