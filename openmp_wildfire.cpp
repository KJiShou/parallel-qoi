#include "wildfire_common.hpp"
#ifdef _OPENMP
#include <omp.h>
#endif

std::vector<int> runOpenMPWildfire(const std::vector<int>& initialGrid, const SimulationConfig& cfg) {
    std::vector<int> current = initialGrid;
    std::vector<int> next(cfg.rows * cfg.cols, EMPTY);

    for (int step = 0; step < cfg.steps; ++step) {
        #pragma omp parallel for schedule(static)
        for (int r = 0; r < cfg.rows; ++r) {
            for (int c = 0; c < cfg.cols; ++c) {
                next[index2D(r, c, cfg.cols)] = updateCellCPU(current, r, c, cfg.rows, cfg.cols);
            }
        }

        // The implicit barrier at the end of omp parallel for ensures all writes are done.
        current.swap(next);
    }

    return current;
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

    const auto start = std::chrono::high_resolution_clock::now();
    const std::vector<int> finalGrid = runOpenMPWildfire(initialGrid, cfg);
    const auto end = std::chrono::high_resolution_clock::now();

    const double milliseconds = std::chrono::duration<double, std::milli>(end - start).count();
    printResult("OpenMP CPU", milliseconds, finalGrid);

#ifdef _OPENMP
    std::cout << "OpenMP max threads: " << omp_get_max_threads() << "\n";
#else
    std::cout << "OpenMP not enabled at compile time.\n";
#endif

    return 0;
}
