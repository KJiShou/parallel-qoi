# Methodology Code Snippets — Wildfire Simulation

These snippets are extracted from the actual implementation files in this folder. They are intended for the proposal methodology section.

## Serial CPU Baseline

Source file: `serial_wildfire.cpp`

```cpp
for (int step = 0; step < cfg.steps; ++step) {
    for (int r = 0; r < cfg.rows; ++r) {
        for (int c = 0; c < cfg.cols; ++c) {
            next[index2D(r, c, cfg.cols)] = updateCellCPU(current, r, c, cfg.rows, cfg.cols);
        }
    }
    current.swap(next);
}
```

## OpenMP Shared-Memory Version

Source file: `openmp_wildfire.cpp`

```cpp
#pragma omp parallel for schedule(static)
for (int r = 0; r < cfg.rows; ++r) {
    for (int c = 0; c < cfg.cols; ++c) {
        next[index2D(r, c, cfg.cols)] = updateCellCPU(current, r, c, cfg.rows, cfg.cols);
    }
}
```

## CUDA GPU Version

Source file: `cuda_wildfire.cu`

```cpp
__global__ void wildfireStepKernel(const int* current, int* next, int rows, int cols) {
    const int idx = blockIdx.x * blockDim.x + threadIdx.x;
    const int totalCells = rows * cols;

    if (idx >= totalCells) return;

    const int row = idx / cols;
    const int col = idx % cols;
    next[idx] = updateCellGPU(current, row, col, rows, cols);
}
```

## MPI Distributed-Memory Version

Source file: `mpi_wildfire.cpp`

```cpp
MPI_Sendrecv(&current[localIndex(1, 0, cols)], cols, MPI_INT, up, 0,
             &current[localIndex(localRows + 1, 0, cols)], cols, MPI_INT, down, 0,
             MPI_COMM_WORLD, MPI_STATUS_IGNORE);

MPI_Sendrecv(&current[localIndex(localRows, 0, cols)], cols, MPI_INT, down, 1,
             &current[localIndex(0, 0, cols)], cols, MPI_INT, up, 1,
             MPI_COMM_WORLD, MPI_STATUS_IGNORE);
```
