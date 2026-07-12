import React from 'react';
import type { Backend, Benchmark, Scenario } from '../types';
import { decodeFrame } from '../frameCodec';
import { aggregationForGrid } from '../runConfig';

const ORDER: Backend[] = ['serial', 'openmp', 'cuda', 'mpi'];
const COLORS = ['#151822', '#285d3b', '#ff6b35', '#2d2a32'];
const LABELS: Record<Backend, string> = { serial: 'Serial', openmp: 'OpenMP', cuda: 'CUDA', mpi: 'MPI' };

type Props = { records: Benchmark[]; rows: number; steps: number; selected: Backend[]; scenario?: Scenario; frameIndex: number };
function FireCanvas({ scenario, frameIndex, label }: { scenario?: Scenario; frameIndex: number; label: string }) {
  const ref = React.useRef<HTMLCanvasElement>(null);
  React.useEffect(() => {
    const canvas = ref.current; const frame = scenario?.frames[frameIndex]; if (!canvas || !frame) return;
    canvas.width = 500; canvas.height = 500; const ctx = canvas.getContext('2d'); if (!ctx) return;
    let cells: Uint8Array;
    try { cells = decodeFrame(frame, 500 * 500); } catch { ctx.fillStyle = COLORS[0]; ctx.fillRect(0, 0, 500, 500); return; }
    const image = ctx.createImageData(500, 500);
    for (let i = 0; i < cells.length; i += 1) { const color = Number.parseInt(COLORS[cells[i]].slice(1), 16); image.data[i * 4] = color >> 16; image.data[i * 4 + 1] = (color >> 8) & 255; image.data[i * 4 + 2] = color & 255; image.data[i * 4 + 3] = 255; }
    ctx.putImageData(image, 0, 0);
  }, [scenario, frameIndex]);
  return <canvas ref={ref} className="backend-fire-canvas" width={500} height={500} aria-label={`${label} shared deterministic fire trace`} />;
}
export function FourBackendTimeComparison({ records, rows, steps, selected, scenario, frameIndex }: Props) {
  const trace = scenario?.rows === rows ? scenario : undefined;
  const current = ORDER.map((backend) => ({ backend, row: records.find((r) => r.backend === backend && r.rows === rows && r.cols === rows) })).filter(({ backend }) => selected.includes(backend));
  const successful = current.map(({ row }) => row).filter((row): row is Benchmark => Boolean(row));
  const duration = Math.max(...successful.map((row) => row.runtimeMs.median), 1);
  const [time, setTime] = React.useState(0); const [playing, setPlaying] = React.useState(false);
  React.useEffect(() => { if (!playing) return; const id = window.setInterval(() => setTime((value) => { if (value >= duration) { setPlaying(false); return duration; } return Math.min(duration, value + duration / 100); }), 50); return () => window.clearInterval(id); }, [playing, duration]);
  return <section className="card time-comparison"><div className="section-head"><div><div className="eyebrow">SYNCHRONIZED BACKEND PLAYBACK</div><h2>Shared deterministic fire trace</h2></div><span className="muted">2 × 2 backend grid</span></div>
    <p className="muted">Every tile replays the same deterministic trace. Progress is positioned by each method's isolated median runtime; this is not hardware telemetry.</p>
    <div className="time-controls"><button className="primary" onClick={() => setPlaying((value) => !value)} disabled={!successful.length}>{playing ? 'Pause' : 'Play'}</button><button onClick={() => { setPlaying(false); setTime(0); }}>Reset</button><input aria-label="Master playback timeline" type="range" min="0" max={duration} step="0.001" value={time} onChange={(e) => { setPlaying(false); setTime(Number(e.target.value)); }} /><b>{time.toFixed(1)} / {duration.toFixed(1)} ms</b></div>
    <div className="backend-comparison-grid">{ORDER.map((backend) => { const found = current.find((item) => item.backend === backend); const row = found?.row; if (!selected.includes(backend)) return <div className="backend-tile missing" key={backend}><b>{LABELS[backend]}</b><span>Not selected for this batch</span></div>; if (!row) return <div className="backend-tile missing" key={backend}><b>{LABELS[backend]}</b><span>Unavailable or no result yet</span><small>Tile will remain explicit until this method completes.</small></div>; const ratio = Math.min(1, time / Math.max(row.runtimeMs.median, 0.001)); const step = Math.min(steps, Math.floor(ratio * steps)); const tileFrame = Math.min((trace?.frames.length ?? 1) - 1, Math.floor(ratio * Math.max(0, (trace?.frames.length ?? 1) - 1))); return <div className={`backend-tile tile-${backend}`} key={backend}><div className="backend-tile-head"><b>{LABELS[backend]}</b><span className={trace ? 'status-ok' : 'muted'}>{trace ? (ratio >= 1 ? 'Complete' : 'Ready') : 'Preparing trace'}</span></div><FireCanvas scenario={trace} frameIndex={tileFrame} label={LABELS[backend]} />{!trace && <div className="trace-pending">Preparing compressed trace for {rows}×{rows}…</div>}<div className="tile-meta"><span>Step {step} / {steps}</span><span>{Math.round(ratio * 100)}%</span></div><progress max="100" value={ratio * 100} /><div className="tile-meta"><span>Status: {ratio >= 1 ? 'complete' : 'replay'}</span><b>Median {row.runtimeMs.median.toFixed(2)} ms</b></div></div>; })}</div>
    <div className="trace-caption">Source: {rows}×{rows} · Display: 500×500 · {aggregationForGrid(rows)}×{aggregationForGrid(rows)} cells/pixel · majority-state · progress positioned by isolated median runtime</div>
  </section>;
}
