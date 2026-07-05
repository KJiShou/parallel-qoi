#include "wildfire_common.hpp"
#include <cuda_runtime.h>
#include <cstdlib>

#define CUDA_CHECK(call) do { \
    cudaError_t err = (call); \
    if (err != cudaSuccess) { \
        std::cerr << "CUDA error at " << __FILE__ << ":" << __LINE__ \
                  << " - " << cudaGetErrorString(err) << "\n"; \
        std::exit(EXIT_FAILURE); \
    } \
} while (0)

__device__ int index2DDevice(int row, int col, int cols) {
    return row * cols + col;
}

__device__ int updateCellGPU(const int* current, int row, int col, int rows, int cols) {
    const int state = current[index2DDevice(row, col, cols)];

    if (state == EMPTY) return EMPTY;
    if (state == BURNED) return BURNED;
    if (state == BURNING) return BURNED;

    for (int dr = -1; dr <= 1; ++dr) {
        for (int dc = -1; dc <= 1; ++dc) {
            if (dr == 0 && dc == 0) continue;

            const int nr = row + dr;
            const int nc = col + dc;

            if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;

            if (current[index2DDevice(nr, nc, cols)] == BURNING) {
                return BURNING;
            }
        }
    }

    return TREE;
}

__global__ void wildfireStepKernel(const int* current, int* next, int rows, int cols) {
    const int idx = blockIdx.x * blockDim.x + threadIdx.x;
    const int totalCells = rows * cols;

    if (idx >= totalCells) return;

    const int row = idx / cols;
    const int col = idx % cols;
    next[idx] = updateCellGPU(current, row, col, rows, cols);
}

std::vector<int> runCUDAWildfire(const std::vector<int>& initialGrid, const SimulationConfig& cfg) {
    const int totalCells = cfg.rows * cfg.cols;
    const std::size_t totalBytes = static_cast<std::size_t>(totalCells) * sizeof(int);

    int* d_current = nullptr;
    int* d_next = nullptr;

    CUDA_CHECK(cudaMalloc(&d_current, totalBytes));
    CUDA_CHECK(cudaMalloc(&d_next, totalBytes));
    CUDA_CHECK(cudaMemcpy(d_current, initialGrid.data(), totalBytes, cudaMemcpyHostToDevice));

    const int blockSize = 256;
    const int gridSize = (totalCells + blockSize - 1) / blockSize;

    for (int step = 0; step < cfg.steps; ++step) {
        wildfireStepKernel<<<gridSize, blockSize>>>(d_current, d_next, cfg.rows, cfg.cols);
        CUDA_CHECK(cudaGetLastError());
        CUDA_CHECK(cudaDeviceSynchronize());
        std::swap(d_current, d_next);
    }

    std::vector<int> finalGrid(totalCells);
    CUDA_CHECK(cudaMemcpy(finalGrid.data(), d_current, totalBytes, cudaMemcpyDeviceToHost));

    CUDA_CHECK(cudaFree(d_current));
    CUDA_CHECK(cudaFree(d_next));

    return finalGrid;
}

int main() {
    SimulationConfig cfg;
    cfg.rows = 512;
    cfg.cols = 512;
    cfg.steps = 200;
    cfg.treeDensity = 0.70f;
    cfg.seed = 42;
    cfg.ignitionRow = cfg.rows / 2;
    cfg.ignitionCol = cfg.cols / 2;

    const std::vector<int> initialGrid = generateInitialGrid(cfg);

    CUDA_CHECK(cudaDeviceSynchronize());
    const auto start = std::chrono::high_resolution_clock::now();
    const std::vector<int> finalGrid = runCUDAWildfire(initialGrid, cfg);
    CUDA_CHECK(cudaDeviceSynchronize());
    const auto end = std::chrono::high_resolution_clock::now();

    const double milliseconds = std::chrono::duration<double, std::milli>(end - start).count();
    printResult("CUDA GPU", milliseconds, finalGrid);

    return 0;
}
