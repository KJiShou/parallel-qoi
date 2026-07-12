import type { Backend } from './types';
import type { RunConfig } from './desktopApi';

export const BACKEND_ORDER: Backend[] = ['serial', 'openmp', 'cuda', 'mpi'];
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
