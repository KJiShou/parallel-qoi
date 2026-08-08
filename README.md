# Parallel QOI Converter

An interactive Windows Electron application for converting PNG/BMP images to
the standard Quite OK Image Format (QOI), validating the decoded pixels, and
comparing Serial, OpenMP, CUDA, and MPI execution models.

The repository has two runtime layers:

- `src/` and `include/` contain the C++17 native core, shared QOI primitives,
  validation, metrics, and the four backend algorithms.
- `dashboard/` contains the Electron main process and the Arco Design React
  renderer. The renderer uses a restricted preload API and never starts native
  processes or reads arbitrary files directly.

## Backend algorithm files

These are the main files to edit when working on parallel algorithms:

| Backend | Algorithm file | Responsibility |
| --- | --- | --- |
| Serial | `src/backends/serial_encoder.cpp` | Sequential block encoding and correctness baseline |
| OpenMP | `src/backends/openmp_encoder.cpp` | Static-scheduled CPU block encoding |
| CUDA | `src/backends/cuda_encoder.cu` | GPU block kernel, transfers, and device output merge |
| MPI | `src/backends/mpi_encoder.cpp` | Rank distribution, local encoding, gather, and rank-0 merge |

The shared code in `src/core/` owns image loading, block partitioning, QOI
state propagation, QOI chunk primitives, output assembly, validation, and JSON
metrics. `src/core/qoi_codec.cpp` is deliberately shared; it is not a fifth
backend algorithm.

One-pass remains an internal native experiment through `pqoi_control` and is
not shown in the Electron product UI.

## Requirements

For the Windows development build:

- Visual Studio 2022 C++ workload
- CMake 3.21 or newer
- Node.js and pnpm for the dashboard
- NVIDIA CUDA Toolkit and a compatible GPU for CUDA builds
- Microsoft MPI runtime, SDK, headers, and libraries for MPI builds

The current full preset targets CUDA Compute Capability 8.9.

## Build the native backends

Serial and OpenMP build:

```powershell
cmake --preset windows-msvc
cmake --build --preset windows-msvc-release
ctest --test-dir build-msvc -C Release --output-on-failure
```

Complete CUDA and MPI build:

```powershell
cmake --preset windows-full
cmake --build --preset windows-full-release
ctest --test-dir build-full -C Release --output-on-failure
```

The executables are written to `build-msvc/Release` or `build-full/Release`.

## Run the native CLI

All ordinary backends use the same argument contract:

```text
--input <path> --output <path> --result <path> --preview <path>
--blocks <count> --threads <count> --segment-length <pixels> --validate
```

Serial baseline:

```powershell
build-msvc\Release\pqoi_serial.exe `
  --input image.bmp `
  --output out.qoi `
  --result result.json `
  --preview decoded.bmp `
  --validate
```

OpenMP example:

```powershell
build-msvc\Release\pqoi_openmp.exe `
  --input image.bmp --output openmp.qoi `
  --result openmp.json --preview openmp.bmp `
  --threads 8 --blocks 32 --validate
```

CUDA example:

```powershell
build-full\Release\pqoi_cuda.exe `
  --input image.bmp --output cuda.qoi `
  --result cuda.json --preview cuda.bmp `
  --segment-length 1024 --blocks 32 --validate
```

MPI must be launched through `mpiexec`:

```powershell
mpiexec -n 4 build-full\Release\pqoi_mpi.exe `
  --input image.bmp --output mpi.qoi `
  --result mpi.json --preview mpi.bmp --validate
```

`result.json` is the stable integration boundary between native executables
and Electron. It contains backend configuration, phase timings, output size,
compression ratio, throughput, and complete pixel validation status. The
schema is documented in `benchmark/schemas/benchmark-result.schema.json`.

## Run the Electron dashboard

```powershell
cd dashboard
pnpm install
pnpm run dev
```

The dashboard provides:

- **Convert**: upload one PNG/BMP, choose a backend, preview decoded QOI, and
  save only after validation succeeds.
- **Compare**: run selected backends sequentially and compare encode runtime,
  throughput, speedup, output size, phase timings, and validation.
- **Performance charts**: Runtime, Throughput, and Phase Breakdown tabs using
  existing native result data without network requests.

The Electron main process detects executable, CUDA, and MPI availability. An
unavailable backend stays visible but disabled with a reason; Serial is the
fallback correctness baseline.

## Project layout

```text
parallel-qoi/
├── include/pqoi/       C++ public interfaces and data structures
├── src/core/           Shared image, QOI, validation, metrics, and CLI code
├── src/backends/       Serial, OpenMP, CUDA, and MPI algorithms
├── src/cli/            Executable entry points
├── dashboard/electron/ Electron main process, IPC, and native process runner
├── dashboard/src/      Arco Design renderer pages and components
├── benchmark/          Benchmark scripts, config, and result schema
├── tests/               Native unit tests
└── third_party/        Vendored QOI and stb_image dependencies
```

Generated build directories, dashboard dependencies, packaged output, and
benchmark result files are excluded by `.gitignore`.
