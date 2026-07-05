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
