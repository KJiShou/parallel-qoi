import { describe, expect, it } from 'vitest';
import { FIXED_RUN_SETTINGS, buildSelectedConfigs } from './runConfig';

describe('selected run configuration', () => {
  it('builds only checked methods in deterministic queue order with fixed settings', () => {
    const configs = buildSelectedConfigs({ rows: 2000, density: 0.8, methods: ['mpi', 'serial', 'cuda'] });
    expect(configs.map((config) => config.backend)).toEqual(['serial', 'cuda', 'mpi']);
    expect(configs.every((config) => config.steps === 100 && config.repetitions === 3 && config.seed === 42)).toBe(true);
    expect(configs.find((config) => config.backend === 'openmp')).toBeUndefined();
    expect(configs.find((config) => config.backend === 'cuda')?.blockSize).toBe(256);
    expect(configs.find((config) => config.backend === 'mpi')?.processes).toBe(4);
    expect(FIXED_RUN_SETTINGS.previewSize).toBe(500);
  });

  it('rejects an empty method selection', () => {
    expect(() => buildSelectedConfigs({ rows: 500, density: 0.6, methods: [] })).toThrow('Select at least one method');
  });
});
