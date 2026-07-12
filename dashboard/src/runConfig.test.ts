import { describe, expect, it } from 'vitest';
import { FIXED_RUN_SETTINGS, FIXED_TIME_PLAYBACK, buildSelectedConfigs, cappedStepAtVirtualTime, rawStepAtVirtualTime, requiredTraceSteps, stepsPerSecond } from './runConfig';

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
  it('rejects an empty method selection', () => expect(() => buildSelectedConfigs({ rows: 500, density: 0.6, methods: [] })).toThrow('Select at least one method'));
});

describe('fixed-time playback math', () => {
  it('publishes the fixed benchmark and playback contract', () => expect(FIXED_TIME_PLAYBACK).toEqual({ virtualWindowMs: 5000, screenDurationMs: 10000, maxTraceStep: 1000, traceFrameInterval: 10, benchmarkSteps: 100 }));
  it('derives steps per second from the isolated median', () => expect(stepsPerSecond(250)).toBe(400));
  it('derives raw and capped virtual-time steps', () => { expect(rawStepAtVirtualTime(2500, 250)).toBe(1000); expect(cappedStepAtVirtualTime(5000, 250)).toBe(1000); });
  it('selects a bounded positive trace depth', () => { expect(requiredTraceSteps([1000])).toBe(500); expect(requiredTraceSteps([250, 50, 5])).toBe(1000); expect(requiredTraceSteps([])).toBe(1); });
  it('handles invalid medians safely', () => { expect(stepsPerSecond(0)).toBe(0); expect(rawStepAtVirtualTime(100, Number.NaN)).toBe(0); });
});
