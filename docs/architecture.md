# Architecture

The native side owns image bytes, QOI state, block summaries, ordered output
and official `qoi.h` validation. Every executable emits the same result JSON.

The Electron main process owns paths, temporary directories, child processes,
backend detection and Save As. The preload script exposes a small typed IPC
surface. The React renderer owns only view state and never starts a process or
reads arbitrary filesystem paths.

```text
React renderer
    │ typed preload API
Electron main / IPC
    │ argument array + temporary job directory
C++ backend executable
    │ qoi + preview + result.json
Electron main → renderer preview/metrics
```

