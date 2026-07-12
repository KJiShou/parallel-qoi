#pragma once

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <numeric>
#include <random>
#include <cstdlib>
#include <sstream>
#include <stdexcept>
#include <string>
#include <vector>

#ifdef _OPENMP
#include <omp.h>
#endif

namespace wildfire {

enum CellState : int { EMPTY = 0, TREE = 1, BURNING = 2, BURNED = 3 };

struct SimulationConfig {
    int rows = 512;
    int cols = 512;
    int steps = 200;
    double treeDensity = 0.70;
    unsigned int seed = 42;
    int ignitionRow = -1;
    int ignitionCol = -1;
    int threads = 0;
    int blockSize = 256;
    int repetitions = 1;
    int warmup = 0;
    std::string output;
    std::string frames;
    int frameInterval = 0;
};

struct TimingStats {
    std::vector<double> samples;
    double mean = 0.0;
    double median = 0.0;
    double stddev = 0.0;
};

inline int index2D(int row, int col, int cols) { return row * cols + col; }

inline void printUsage(const char* program, bool mpi = false) {
    std::cout << "Usage: " << program << " [options]\n"
              << "  --rows N --cols N --steps N --density P --seed N\n"
              << "  --ignition-row N --ignition-col N\n"
              << "  --output FILE.json --frames FILE.json --frame-interval N\n"
              << "  --repetitions N --warmup N\n"
              << "  --threads N (OpenMP) --block-size N (CUDA)\n"
              << "  --help\n";
    if (mpi) std::cout << "  MPI process count is supplied by mpiexec -n N\n";
}

inline int parseInt(const std::string& value, const char* name) {
    try {
        std::size_t pos = 0;
        int result = std::stoi(value, &pos);
        if (pos != value.size()) throw std::invalid_argument("trailing characters");
        return result;
    } catch (...) { throw std::invalid_argument(std::string("invalid integer for ") + name); }
}

inline double parseDouble(const std::string& value, const char* name) {
    try {
        std::size_t pos = 0;
        double result = std::stod(value, &pos);
        if (pos != value.size()) throw std::invalid_argument("trailing characters");
        return result;
    } catch (...) { throw std::invalid_argument(std::string("invalid number for ") + name); }
}

inline SimulationConfig parseArgs(int argc, char** argv, bool mpi = false) {
    SimulationConfig cfg;
    for (int i = 1; i < argc; ++i) {
        const std::string arg = argv[i];
        if (arg == "--help" || arg == "-h") { printUsage(argv[0], mpi); std::exit(0); }
        auto requireValue = [&](const char* name) -> std::string {
            if (i + 1 >= argc) throw std::invalid_argument(std::string("missing value for ") + name);
            return argv[++i];
        };
        if (arg == "--rows") cfg.rows = parseInt(requireValue("--rows"), "--rows");
        else if (arg == "--cols") cfg.cols = parseInt(requireValue("--cols"), "--cols");
        else if (arg == "--steps") cfg.steps = parseInt(requireValue("--steps"), "--steps");
        else if (arg == "--density") cfg.treeDensity = parseDouble(requireValue("--density"), "--density");
        else if (arg == "--seed") cfg.seed = static_cast<unsigned int>(parseInt(requireValue("--seed"), "--seed"));
        else if (arg == "--ignition-row") cfg.ignitionRow = parseInt(requireValue("--ignition-row"), "--ignition-row");
        else if (arg == "--ignition-col") cfg.ignitionCol = parseInt(requireValue("--ignition-col"), "--ignition-col");
        else if (arg == "--threads") cfg.threads = parseInt(requireValue("--threads"), "--threads");
        else if (arg == "--block-size") cfg.blockSize = parseInt(requireValue("--block-size"), "--block-size");
        else if (arg == "--repetitions") cfg.repetitions = parseInt(requireValue("--repetitions"), "--repetitions");
        else if (arg == "--warmup") cfg.warmup = parseInt(requireValue("--warmup"), "--warmup");
        else if (arg == "--output") cfg.output = requireValue("--output");
        else if (arg == "--frames") cfg.frames = requireValue("--frames");
        else if (arg == "--frame-interval") cfg.frameInterval = parseInt(requireValue("--frame-interval"), "--frame-interval");
        else throw std::invalid_argument("unknown argument: " + arg);
    }
    if (cfg.rows <= 0 || cfg.cols <= 0 || cfg.steps < 0) throw std::invalid_argument("rows/cols must be positive and steps cannot be negative");
    if (cfg.treeDensity < 0.0 || cfg.treeDensity > 1.0) throw std::invalid_argument("density must be between 0 and 1");
    if (cfg.ignitionRow < 0) cfg.ignitionRow = cfg.rows / 2;
    if (cfg.ignitionCol < 0) cfg.ignitionCol = cfg.cols / 2;
    if (cfg.ignitionRow >= cfg.rows || cfg.ignitionCol >= cfg.cols) throw std::invalid_argument("ignition coordinate is outside the grid");
    if (cfg.threads < 0 || cfg.blockSize <= 0 || cfg.repetitions <= 0 || cfg.warmup < 0 || cfg.frameInterval < 0) throw std::invalid_argument("invalid worker, timing, or frame parameter");
    if (cfg.blockSize != 128 && cfg.blockSize != 256 && cfg.blockSize != 512) throw std::invalid_argument("block-size must be 128, 256, or 512");
    return cfg;
}

inline std::vector<int> generateInitialGrid(const SimulationConfig& cfg) {
    std::vector<int> grid(static_cast<std::size_t>(cfg.rows) * cfg.cols, EMPTY);
    std::mt19937 rng(cfg.seed);
    std::uniform_real_distribution<float> dist(0.0f, 1.0f);
    for (int r = 0; r < cfg.rows; ++r)
        for (int c = 0; c < cfg.cols; ++c)
            grid[index2D(r, c, cfg.cols)] = dist(rng) < cfg.treeDensity ? TREE : EMPTY;
    grid[index2D(cfg.ignitionRow, cfg.ignitionCol, cfg.cols)] = BURNING;
    return grid;
}

inline int updateCellCPU(const std::vector<int>& current, int row, int col, int rows, int cols) {
    const int state = current[index2D(row, col, cols)];
    if (state == EMPTY) return EMPTY;
    if (state == BURNED) return BURNED;
    if (state == BURNING) return BURNED;
    for (int dr = -1; dr <= 1; ++dr) for (int dc = -1; dc <= 1; ++dc) {
        if (dr == 0 && dc == 0) continue;
        const int nr = row + dr, nc = col + dc;
        if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && current[index2D(nr, nc, cols)] == BURNING) return BURNING;
    }
    return TREE;
}

inline std::uint64_t checksumGrid(const std::vector<int>& grid) {
    std::uint64_t hash = 1469598103934665603ull;
    for (int value : grid) { hash ^= static_cast<std::uint64_t>(value + 1); hash *= 1099511628211ull; }
    return hash;
}
inline int countState(const std::vector<int>& grid, int state) { return static_cast<int>(std::count(grid.begin(), grid.end(), state)); }
inline int countBurnedCells(const std::vector<int>& grid) { return countState(grid, BURNED); }
inline int countBurningCells(const std::vector<int>& grid) { return countState(grid, BURNING); }

inline TimingStats summarizeTimings(std::vector<double> samples) {
    TimingStats stats; stats.samples = std::move(samples); if (stats.samples.empty()) return stats;
    stats.mean = std::accumulate(stats.samples.begin(), stats.samples.end(), 0.0) / stats.samples.size();
    auto ordered = stats.samples; std::sort(ordered.begin(), ordered.end());
    stats.median = ordered.size() % 2 ? ordered[ordered.size()/2] : (ordered[ordered.size()/2-1] + ordered[ordered.size()/2]) / 2.0;
    double sum = 0.0; for (double value : stats.samples) sum += (value - stats.mean) * (value - stats.mean);
    stats.stddev = std::sqrt(sum / stats.samples.size()); return stats;
}

inline void ensureParent(const std::string& path) {
    if (!path.empty()) { std::filesystem::path p(path); if (!p.parent_path().empty()) std::filesystem::create_directories(p.parent_path()); }
}
inline void writeJsonString(std::ostream& out, const std::string& value) { out << '"'; for (char ch : value) { if (ch == '"' || ch == '\\') out << '\\'; out << ch; } out << '"'; }

inline void writeSummary(const SimulationConfig& cfg, const std::string& backend, const TimingStats& timing,
                         const std::vector<int>& finalGrid, int workers = 1, int blockSize = 0) {
    if (cfg.output.empty()) return;
    ensureParent(cfg.output); std::ofstream out(cfg.output); if (!out) throw std::runtime_error("cannot open output: " + cfg.output);
    out << std::setprecision(12) << "{\n  \"schemaVersion\": 1,\n  \"backend\": "; writeJsonString(out, backend);
    out << ",\n  \"rows\": " << cfg.rows << ",\n  \"cols\": " << cfg.cols << ",\n  \"steps\": " << cfg.steps
        << ",\n  \"treeDensity\": " << cfg.treeDensity << ",\n  \"seed\": " << cfg.seed
        << ",\n  \"ignition\": {\"row\": " << cfg.ignitionRow << ", \"col\": " << cfg.ignitionCol << "}"
        << ",\n  \"workers\": " << workers << ",\n  \"blockSize\": " << blockSize << ",\n  \"runtimeMs\": {\"samples\": [";
    for (std::size_t i = 0; i < timing.samples.size(); ++i) { if (i) out << ", "; out << timing.samples[i]; }
    out << "], \"mean\": " << timing.mean << ", \"median\": " << timing.median << ", \"stddev\": " << timing.stddev << "}"
        << ",\n  \"burnedCells\": " << countBurnedCells(finalGrid)
        << ",\n  \"burnedPercentage\": " << (100.0 * countBurnedCells(finalGrid) / finalGrid.size())
        << ",\n  \"checksum\": \"" << checksumGrid(finalGrid) << "\"\n}\n";
}

inline void writeFrames(const SimulationConfig& cfg, const std::string& backend, const std::vector<std::vector<int>>& frames) {
    if (cfg.frames.empty()) return;
    ensureParent(cfg.frames); std::ofstream out(cfg.frames); if (!out) throw std::runtime_error("cannot open frames: " + cfg.frames);
    out << "{\n  \"schemaVersion\": 1,\n  \"backend\": "; writeJsonString(out, backend);
    out << ",\n  \"rows\": " << cfg.rows << ",\n  \"cols\": " << cfg.cols << ",\n  \"steps\": " << cfg.steps << ",\n  \"frames\": [\n";
    for (std::size_t f = 0; f < frames.size(); ++f) {
        const auto& grid = frames[f]; if (f) out << ",\n"; out << "    {\"step\": " << (f == 0 ? 0 : (f + 1) * std::max(1, cfg.frameInterval)) << ", \"cells\": [";
        for (std::size_t i = 0; i < grid.size(); ++i) { if (i) out << ','; out << grid[i]; }
        out << "]}";
    }
    out << "\n  ]\n}\n";
}

inline std::vector<int> runSerial(const std::vector<int>& initial, const SimulationConfig& cfg, std::vector<std::vector<int>>* frames = nullptr) {
    std::vector<int> current = initial, next(current.size(), EMPTY);
    if (frames) frames->push_back(current);
    for (int step = 0; step < cfg.steps; ++step) {
        for (int r = 0; r < cfg.rows; ++r) for (int c = 0; c < cfg.cols; ++c) next[index2D(r,c,cfg.cols)] = updateCellCPU(current,r,c,cfg.rows,cfg.cols);
        current.swap(next);
        if (frames && cfg.frameInterval > 0 && ((step + 1) % cfg.frameInterval == 0 || step + 1 == cfg.steps)) frames->push_back(current);
    }
    return current;
}

inline int runMain(int argc, char** argv, const std::string& backend) {
    try {
        SimulationConfig cfg = parseArgs(argc, argv);
        const auto initial = generateInitialGrid(cfg);
        for (int i = 0; i < cfg.warmup; ++i) runSerial(initial, cfg);
        std::vector<double> samples; std::vector<int> finalGrid; std::vector<std::vector<int>> frames;
        for (int rep = 0; rep < cfg.repetitions; ++rep) {
            const auto start = std::chrono::steady_clock::now();
            finalGrid = runSerial(initial, cfg, (rep == 0 && !cfg.frames.empty()) ? &frames : nullptr);
            const auto end = std::chrono::steady_clock::now();
            samples.push_back(std::chrono::duration<double, std::milli>(end - start).count());
        }
        const auto timing = summarizeTimings(samples); writeSummary(cfg, backend, timing, finalGrid, 1, 0); writeFrames(cfg, backend, frames);
        std::cout << backend << " result\nTime (ms): " << timing.median << "\nBurned cells: " << countBurnedCells(finalGrid) << "\nChecksum: " << checksumGrid(finalGrid) << "\n";
        return 0;
    } catch (const std::exception& ex) { std::cerr << "Error: " << ex.what() << "\n"; printUsage(argv[0]); return 2; }
}

} // namespace wildfire
