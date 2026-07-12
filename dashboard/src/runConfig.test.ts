import { describe, expect, it } from 'vitest';
import { FIXED_RUN_SETTINGS, FIXED_TIME_PLAYBACK, buildSelectedConfigs, firstSampledExtinguishedStep, rawStepAtVirtualTime, requiredTraceSteps, stepsPerSecond, visualizationDepthForGrid } from './runConfig';

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
  it('publishes the fixed benchmark and playback contract', () => expect(FIXED_TIME_PLAYBACK).toEqual({ virtualWindowMs: 5000, screenDurationMs: 10000, traceFrameInterval: 10, benchmarkSteps: 100 }));
  it('maps each supported grid to a grid-relative depth bounded by the serial trace work budget', () => {
    expect([500, 1000, 2000, 4000].map(visualizationDepthForGrid)).toEqual([250, 500, 500, 125]);
    for (const grid of [500,1000,2000,4000]) expect(visualizationDepthForGrid(grid)*grid*grid).toBeLessThanOrEqual(2_000_000_000);
  });
  it('derives steps per second from the isolated median', () => expect(stepsPerSecond(250)).toBe(400));
  it('keeps derived virtual-time steps uncapped', () => expect(rawStepAtVirtualTime(5000, 2)).toBe(250000));
  it('selects a grid-bounded positive trace depth', () => {
    expect(requiredTraceSteps([1000], 500)).toBe(250);
    expect(requiredTraceSteps([250, 50, 5], 1000)).toBe(500);
    expect(requiredTraceSteps([250, 5], 4000)).toBe(125);
    expect(requiredTraceSteps([], 4000)).toBe(1);
  });
  it('handles invalid medians safely', () => { expect(stepsPerSecond(0)).toBe(0); expect(rawStepAtVirtualTime(100, Number.NaN)).toBe(0); });
  it('reports the first sampled extinguished step after the last burning frame', () => {
    const frames = [{ step: 0 }, { step: 10 }, { step: 20 }, { step: 30 }, { step: 40 }];
    expect(firstSampledExtinguishedStep(frames, [true, false, true, false, false])).toBe(30);
    expect(firstSampledExtinguishedStep(frames, [true, true, true, true, true])).toBeUndefined();
  });
});
