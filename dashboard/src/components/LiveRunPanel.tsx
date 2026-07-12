import React from 'react';
import type { Backend } from '../types';
import type { RunConfig } from '../desktopApi';
import { BACKEND_ORDER, visualizationDepthForGrid } from '../runConfig';

type Props = { config: RunConfig; onConfig: (config: RunConfig) => void; selected: Backend[]; onSelected: (methods: Backend[]) => void; onRun: () => void; onCancel: () => void; running: boolean; phase: string; log: string[]; desktop: boolean; completed: number; total: number; currentBackend: string };
const names: Record<Backend, string> = { serial: 'Serial', openmp: 'OpenMP', cuda: 'CUDA', mpi: 'MPI' };
export function LiveRunPanel({ config, onConfig, selected, onSelected, onRun, onCancel, running, phase, log, desktop, completed, total, currentBackend }: Props) {
  const toggle = (backend: Backend) => onSelected(selected.includes(backend) ? selected.filter((item) => item !== backend) : [...selected, backend]);
  return <section className="card live-panel">
    <div className="section-head"><div><div className="eyebrow">ELECTRON LIVE RUNNER</div><h2>Run selected methods</h2></div><span className={desktop ? 'status-ok' : 'muted'}>{desktop ? 'DESKTOP MODE' : 'BROWSER PREVIEW · READ ONLY'}</span></div>
    <p className="muted">Runs checked methods sequentially in the isolated order Serial → OpenMP → CUDA → MPI. A failed method does not stop the remaining selected methods. After benchmark completion, a separate playback trace is prepared.</p>
    <div className="run-form">
      <label>Source grid<select disabled={running} value={config.rows} onChange={(e) => onConfig({ ...config, rows: Number(e.target.value) as RunConfig['rows'], cols: Number(e.target.value) as RunConfig['cols'] })}>{[500, 1000, 2000, 4000].map((size) => <option key={size} value={size}>{size} × {size}</option>)}</select></label>
      <label>Density<select disabled={running} value={config.density} onChange={(e) => onConfig({ ...config, density: Number(e.target.value) as RunConfig['density'] })}><option value="0.6">60%</option><option value="0.7">70%</option><option value="0.8">80%</option></select></label>
      <fieldset className="method-picker"><legend>Methods</legend>{BACKEND_ORDER.map((backend) => <label key={backend}><input type="checkbox" disabled={running} checked={selected.includes(backend)} onChange={() => toggle(backend)} /> {names[backend]}</label>)}</fieldset>
    </div>
    <p className="fixed-settings">Benchmark · 100 steps × 3 repetitions · seed 42 · OpenMP 4 threads · MPI 4 processes · CUDA block 256<br/>Playback · uncapped derived 5-second throughput · work-budgeted visualization through Step {visualizationDepthForGrid(config.rows)}</p>
    <div className="run-actions"><button className="primary" disabled={!desktop || running || selected.length === 0} onClick={onRun}>Run selected methods</button>{running && <button onClick={onCancel}>Cancel current run</button>}<span className="run-phase">{desktop ? phase : 'Electron runner unavailable in browser'}</span></div>
    <div className="queue-progress"><div className="queue-progress-head"><span>{running ? `Running ${currentBackend}…` : phase}</span><b>{completed} / {total} selected</b></div><progress max={Math.max(total, 1)} value={completed} /><div className="queue-steps">{BACKEND_ORDER.map((backend) => <span className={selected.includes(backend) ? (BACKEND_ORDER.indexOf(backend) < completed ? 'done' : backend === currentBackend.toLowerCase() && running ? 'active' : '') : 'muted'} key={backend}>{names[backend]}</span>)}</div></div>
    {log.length > 0 && <details className="run-log"><summary>Runner output</summary><pre>{log.join('\n')}</pre></details>}
  </section>;
}
