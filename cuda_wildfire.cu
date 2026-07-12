#include "wildfire_common.hpp"
#include <cuda_runtime.h>
#include <cstdlib>

#define CUDA_CHECK(call) do { cudaError_t err = (call); if (err != cudaSuccess) { std::cerr << "CUDA error: " << cudaGetErrorString(err) << "\n"; std::exit(EXIT_FAILURE); } } while (0)

__device__ int updateCellGPU(const int* current, int row, int col, int rows, int cols) {
    const int state = current[row * cols + col];
    if (state == wildfire::EMPTY) return wildfire::EMPTY;
    if (state == wildfire::BURNED) return wildfire::BURNED;
    if (state == wildfire::BURNING) return wildfire::BURNED;
    for (int dr=-1; dr<=1; ++dr) for (int dc=-1; dc<=1; ++dc) {
        if (dr == 0 && dc == 0) continue; int nr=row+dr, nc=col+dc;
        if (nr>=0 && nr<rows && nc>=0 && nc<cols && current[nr*cols+nc] == wildfire::BURNING) return wildfire::BURNING;
    }
    return wildfire::TREE;
}
__global__ void wildfireStepKernel(const int* current, int* next, int rows, int cols) {
    int idx = blockIdx.x * blockDim.x + threadIdx.x; int total = rows * cols; if (idx >= total) return;
    next[idx] = updateCellGPU(current, idx / cols, idx % cols, rows, cols);
}

static std::vector<int> runCuda(const std::vector<int>& initial, const wildfire::SimulationConfig& cfg) {
    int total = cfg.rows * cfg.cols; std::size_t bytes = static_cast<std::size_t>(total) * sizeof(int); int *dCurrent=nullptr,*dNext=nullptr;
    CUDA_CHECK(cudaMalloc(&dCurrent, bytes)); CUDA_CHECK(cudaMalloc(&dNext, bytes)); CUDA_CHECK(cudaMemcpy(dCurrent, initial.data(), bytes, cudaMemcpyHostToDevice));
    int blocks = (total + cfg.blockSize - 1) / cfg.blockSize;
    for (int step=0; step<cfg.steps; ++step) { wildfireStepKernel<<<blocks,cfg.blockSize>>>(dCurrent,dNext,cfg.rows,cfg.cols); CUDA_CHECK(cudaGetLastError()); std::swap(dCurrent,dNext); }
    CUDA_CHECK(cudaDeviceSynchronize()); std::vector<int> result(total); CUDA_CHECK(cudaMemcpy(result.data(),dCurrent,bytes,cudaMemcpyDeviceToHost)); CUDA_CHECK(cudaFree(dCurrent)); CUDA_CHECK(cudaFree(dNext)); return result;
}

int main(int argc, char** argv) {
    try {
        auto cfg = wildfire::parseArgs(argc, argv); auto initial = wildfire::generateInitialGrid(cfg); std::vector<double> samples; std::vector<int> finalGrid;
        for (int i=0;i<cfg.warmup;++i) finalGrid = runCuda(initial,cfg);
        for (int i=0;i<cfg.repetitions;++i) { auto start=std::chrono::steady_clock::now(); finalGrid=runCuda(initial,cfg); auto end=std::chrono::steady_clock::now(); samples.push_back(std::chrono::duration<double,std::milli>(end-start).count()); }
        auto timing=wildfire::summarizeTimings(samples); wildfire::writeSummary(cfg,"cuda",timing,finalGrid,1,cfg.blockSize);
        std::cout << "cuda result\nTime (ms): " << timing.median << "\nBurned cells: " << wildfire::countBurnedCells(finalGrid) << "\nChecksum: " << wildfire::checksumGrid(finalGrid) << "\nBlock size: " << cfg.blockSize << "\n"; return 0;
    } catch (const std::exception& ex) { std::cerr << "Error: " << ex.what() << "\n"; wildfire::printUsage(argv[0]); return 2; }
}
