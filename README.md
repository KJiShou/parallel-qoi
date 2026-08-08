# Parallel QOI Converter

An interactive Electron desktop app for converting RGB/RGBA images to the
standard Quite OK Image Format (QOI), then comparing Serial, OpenMP, CUDA and
MPI execution models.

The project is intentionally split into two layers:

- `src/` is native C++17 code. It owns image loading, QOI state, encoding,
  validation, metrics and the CLI contract.
- `dashboard/` is an Electron + React + TypeScript UI. The renderer never
  starts processes or reads arbitrary files; the preload API exposes only
  the conversion operations required by the UI.

## First vertical slice

The Serial backend is the always-available baseline. It supports PNG and BMP
input through Windows Imaging Component on Windows and the vendored
`stb_image` fallback on other platforms. Native QOI input is also accepted.
It writes a `.qoi`, a decoded BMP preview, and a JSON result.

```powershell
cmake --preset windows-msvc
cmake --build --preset windows-msvc-release
build-msvc\Release\pqoi_serial.exe --input image.bmp --output out.qoi `
  --result result.json --preview decoded.bmp --validate
```

On Windows the binaries are written to `build-msvc/Release`. Use that path
when starting a CLI directly.

Run the desktop app from `dashboard/` after installing Node dependencies:

```powershell
cd dashboard
pnpm install
pnpm dev
```

For the complete Windows build, use `windows-full`; it enables the real CUDA
kernel backend and MPI scatter/gather backend and targets CUDA architecture 89:

```powershell
cmake --preset windows-full
cmake --build --preset windows-full-release
```

The Electron app exposes Serial, OpenMP, CUDA and MPI. One-pass remains an
internal native control target for research experiments and is not shown in
the product UI. Backend detection checks the executable, NVIDIA GPU/runtime,
and MPI launcher before enabling a choice.

## CLI contract

Every backend accepts the same flags:

```text
--input <path> --output <path> --result <path> --preview <path>
--blocks <count> --threads <count> --segment-length <pixels> --validate
```

`result.json` is the stable integration boundary. See
`benchmark/schemas/benchmark-result.schema.json`.
