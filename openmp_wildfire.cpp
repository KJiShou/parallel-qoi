#include "wildfire_common.hpp"

int main(int argc, char** argv) {
    try {
        wildfire::SimulationConfig cfg = wildfire::parseArgs(argc, argv);
#ifdef _OPENMP
        if (cfg.threads > 0) omp_set_num_threads(cfg.threads);
#endif
        const auto initial = wildfire::generateInitialGrid(cfg);
        std::vector<double> samples;
        std::vector<int> finalGrid;
        std::vector<std::vector<int>> frames;
        for (int rep = 0; rep < cfg.warmup; ++rep) {
            auto current = initial, next = initial;
            for (int step = 0; step < cfg.steps; ++step) {
#pragma omp parallel for schedule(static)
                for (int r = 0; r < cfg.rows; ++r) for (int c = 0; c < cfg.cols; ++c)
                    next[wildfire::index2D(r,c,cfg.cols)] = wildfire::updateCellCPU(current,r,c,cfg.rows,cfg.cols);
                current.swap(next);
            }
        }
        for (int rep = 0; rep < cfg.repetitions; ++rep) {
            auto current = initial, next = initial;
            const auto start = std::chrono::steady_clock::now();
            if (rep == 0 && !cfg.frames.empty()) frames.push_back(current);
            for (int step = 0; step < cfg.steps; ++step) {
#pragma omp parallel for schedule(static)
                for (int r = 0; r < cfg.rows; ++r) for (int c = 0; c < cfg.cols; ++c)
                    next[wildfire::index2D(r,c,cfg.cols)] = wildfire::updateCellCPU(current,r,c,cfg.rows,cfg.cols);
                current.swap(next);
                if (rep == 0 && !cfg.frames.empty() && cfg.frameInterval > 0 && ((step+1)%cfg.frameInterval == 0 || step+1==cfg.steps)) frames.push_back(current);
            }
            const auto end = std::chrono::steady_clock::now(); samples.push_back(std::chrono::duration<double,std::milli>(end-start).count()); finalGrid = std::move(current);
        }
        const auto timing = wildfire::summarizeTimings(samples);
        int workers = 1;
#ifdef _OPENMP
        workers = cfg.threads > 0 ? cfg.threads : omp_get_max_threads();
#endif
        wildfire::writeSummary(cfg, "openmp", timing, finalGrid, workers, 0); wildfire::writeFrames(cfg, "openmp", frames);
        std::cout << "openmp result\nTime (ms): " << timing.median << "\nBurned cells: " << wildfire::countBurnedCells(finalGrid) << "\nChecksum: " << wildfire::checksumGrid(finalGrid) << "\nThreads: " << workers << "\n";
        return 0;
    } catch (const std::exception& ex) { std::cerr << "Error: " << ex.what() << "\n"; wildfire::printUsage(argv[0]); return 2; }
}
