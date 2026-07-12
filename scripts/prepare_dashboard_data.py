#!/usr/bin/env python3
from __future__ import annotations
import argparse, base64, json, subprocess, tempfile
from pathlib import Path

def pack_cells(cells: list[int]) -> str:
    packed = bytearray((len(cells) + 3) // 4)
    for i, state in enumerate(cells):
        if state not in (0, 1, 2, 3): raise ValueError(f'invalid state {state}')
        packed[i // 4] |= state << ((i % 4) * 2)
    return base64.b64encode(packed).decode('ascii')

def prepare(exe: Path, output: Path, scenario_id: str, rows: int, cols: int, steps: int, interval: int) -> None:
    with tempfile.TemporaryDirectory() as tmp:
        raw = Path(tmp) / 'frames.json'
        cmd = [str(exe), '--rows', str(rows), '--cols', str(cols), '--steps', str(steps), '--density', '0.7', '--seed', '42', '--repetitions', '1', '--frame-interval', str(interval), '--frames', str(raw)]
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode: raise RuntimeError(result.stdout + result.stderr)
        source = json.loads(raw.read_text())
    frames = []
    for raw_frame in source['frames']:
        cells = raw_frame['cells']
        frames.append({'step': raw_frame['step'], 'burningCells': cells.count(2), 'burnedCells': cells.count(3), 'cells2BitBase64': pack_cells(cells)})
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps({'schemaVersion': 2, 'scenarioId': scenario_id, 'rows': rows, 'cols': cols, 'steps': steps, 'frameInterval': interval, 'frames': frames}, separators=(',', ':')))

def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--build-dir', default='build_verified/Release')
    parser.add_argument('--output-dir', default='dashboard/public/data/scenarios')
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]; exe = (root / args.build_dir / 'wildfire_serial.exe').resolve(); out = root / args.output_dir
    specs = [('serial-100', '100', 100, 100, 200, 5), ('serial-250', '250', 250, 250, 300, 10), ('serial-500', '500', 500, 500, 400, 20)]
    entries = []
    for scenario_id, label, rows, cols, steps, interval in specs:
        prepare(exe, out / f'{scenario_id}.json', scenario_id, rows, cols, steps, interval)
        entries.append({'id': scenario_id, 'label': f'{label} × {label}', 'backend': 'serial', 'rows': rows, 'cols': cols, 'steps': steps, 'frameInterval': interval, 'url': f'./data/scenarios/{scenario_id}.json'})
    manifest = {'schemaVersion': 2, 'generatedAt': 'generated-local', 'visualizationScenarios': entries, 'benchmarksUrl': './data/benchmarks.json'}
    (root / 'dashboard/public/data/manifest.json').write_text(json.dumps(manifest, indent=2))
    print(f'Generated {len(entries)} visualization scenarios in {out}')

if __name__ == '__main__': main()
