import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FourBackendTimeComparison } from './FourBackendTimeComparison';
import type { LiveTrace } from '../desktopApi';
import type { Benchmark } from '../types';

vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);

const emptyCells = btoa(String.fromCharCode(...new Uint8Array(62500)));
const burning = (active: boolean) => btoa(String.fromCharCode(active ? 1 : 0, ...new Uint8Array(31249)));
const trace: LiveTrace = {
  schemaVersion: 2, sourceRows: 500, sourceCols: 500, previewRows: 500, previewCols: 500,
  aggregationRows: 1, aggregationCols: 1, steps: 250, frameInterval: 10, density: .7, seed: 42,
  frames: Array.from({ length: 26 }, (_, index) => ({ step: index * 10, cells2BitBase64: emptyCells, burningMaskBase64: burning(index < 2) })),
};
const record = { backend: 'serial', rows: 500, cols: 500, runtimeMs: { median: 2 }, speedup: 1 } as Benchmark;

describe('throughput playback copy', () => {
  it('shows uncapped derived throughput separately from bounded animation depth and extinction sampling', () => {
    render(<FourBackendTimeComparison records={[record]} rows={500} density={.7} seed={42} traceSteps={250} steps={100} selected={['serial']} liveTrace={trace} frameIndex={0} />);
    expect(screen.getByText('250,000 derived steps in 5.0 s')).toBeInTheDocument();
    expect(screen.getByText('Animation available through Step 250')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Master playback timeline'), { target: { value: '5000' } });
    expect(screen.getByText('Animation held at Step 20')).toBeInTheDocument();
    expect(screen.getByText('Fire extinguished: first sampled extinguished Step 20')).toBeInTheDocument();
    expect(screen.queryByText(/trace cap reached/i)).not.toBeInTheDocument();
  });
});
