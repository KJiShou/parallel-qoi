# PDC Wildfire Methods

This folder contains real code examples for the four implementations described in the PDC proposal:

1. Serial CPU baseline
2. OpenMP shared-memory CPU version
3. CUDA GPU version
4. MPI distributed-memory version

All implementations use the same deterministic cellular automata wildfire rules, fixed random seed, grid size, timestep count, checksum, and burned-cell validation.

## Build with CMake

On this machine, use the Visual Studio generator:

```bash
cmake -S . -B build_verified -G "Visual Studio 17 2022" -A x64
cmake --build build_verified --config Release
```

The CMake file defaults CUDA architecture to `89`, which matches the RTX 4060 Laptop GPU used for verification.

## Run

```bash
./build_mpi_fallback/Release/wildfire_serial.exe
./build_mpi_fallback/Release/wildfire_openmp.exe
./build_mpi_fallback/Release/wildfire_cuda.exe
mpiexec -n 4 ./build_mpi_fallback/Release/wildfire_mpi.exe
```

`wildfire_mpi.exe` is built through the MS-MPI fallback path in `CMakeLists.txt` when Microsoft MPI SDK is installed.

## Correctness Check

The `Burned cells` and `Checksum` values should match across Serial, OpenMP, CUDA and MPI for the same configuration.

Verified on 4 July 2026 for Serial, OpenMP, CUDA and MPI:

```text
Serial CPU result
Burned cells: 106721
Checksum: 5934029897580874713

OpenMP CPU result
Burned cells: 106721
Checksum: 5934029897580874713

CUDA GPU result
Burned cells: 106721
Checksum: 5934029897580874713

MPI result
Burned cells: 106721
Checksum: 5934029897580874713
MPI processes: 4
```

## Methodology Usage

Use `methodology_code_snippets.md` for short code excerpts in the proposal. Do not paste the full source files into the report unless required.

## Configurable Runs

All backends use the same deterministic Moore-neighbourhood rules, fixed seed, double buffering, and JSON summary contract.

```bash
./build_verified/Release/wildfire_serial.exe --rows 512 --cols 512 --steps 200 --density 0.7 --seed 42 --repetitions 3 --output results/serial.json
./build_verified/Release/wildfire_openmp.exe --rows 512 --cols 512 --steps 200 --density 0.7 --seed 42 --threads 8 --repetitions 3 --output results/openmp.json
./build_verified/Release/wildfire_cuda.exe --rows 512 --cols 512 --steps 200 --density 0.7 --seed 42 --block-size 256 --repetitions 3 --output results/cuda.json
mpiexec -n 4 ./build_verified/Release/wildfire_mpi.exe --rows 512 --cols 512 --steps 200 --density 0.7 --seed 42 --repetitions 3 --output results/mpi.json
```

## Verification and Benchmarking

The correctness gate compares burned cells and checksum across all four implementations, including an MPI case with uneven row partitioning:

```bash
python scripts/verify_correctness.py --build-dir build_verified/Release
python scripts/run_benchmarks.py --profile smoke --build-dir build_verified/Release
```

The benchmark driver writes raw JSON summaries and a consolidated CSV to `results/generated/`. Generated build/results files are ignored by Git.

## Dashboard

The dashboard reads precomputed frames and benchmark data. It does not launch or time the C++ executables from the browser.

```bash
mkdir -p dashboard/public/data
./build_verified/Release/wildfire_serial.exe --rows 100 --cols 100 --steps 50 --density 0.7 --seed 42 --frame-interval 5 --frames results/demo_serial.json --output results/demo_summary.json
cp results/demo_serial.json dashboard/public/data/demo_serial.json
cp results/generated/benchmarks.json dashboard/public/data/benchmarks.json

cd dashboard
npm install
npm run build
npm run dev
```

The dashboard provides Canvas playback, play/pause and frame controls, wildfire state legend, current-frame statistics, and a benchmark result table.
