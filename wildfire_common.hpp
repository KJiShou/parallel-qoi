#pragma once

#include <algorithm>
#include <chrono>
#include <cstdint>
#include <iostream>
#include <random>
#include <string>
#include <vector>

enum CellState {
    EMPTY = 0,
    TREE = 1,
    BURNING = 2,
    BURNED = 3
};

struct SimulationConfig {
    int rows = 512;
    int cols = 512;
    int steps = 200;
    float treeDensity = 0.70f;
    unsigned int seed = 42;
    int ignitionRow = 256;
    int ignitionCol = 256;
};

inline int index2D(int row, int col, int cols) {
    return row * cols + col;
}

inline std::vector<int> generateInitialGrid(const SimulationConfig& cfg) {
    std::vector<int> grid(cfg.rows * cfg.cols, EMPTY);
    std::mt19937 rng(cfg.seed);
    std::uniform_real_distribution<float> dist(0.0f, 1.0f);

    for (int r = 0; r < cfg.rows; ++r) {
        for (int c = 0; c < cfg.cols; ++c) {
            grid[index2D(r, c, cfg.cols)] = (dist(rng) < cfg.treeDensity) ? TREE : EMPTY;
        }
    }

    const int ir = std::clamp(cfg.ignitionRow, 0, cfg.rows - 1);
    const int ic = std::clamp(cfg.ignitionCol, 0, cfg.cols - 1);
    grid[index2D(ir, ic, cfg.cols)] = BURNING;

    return grid;
}

inline int updateCellCPU(const std::vector<int>& current, int row, int col, int rows, int cols) {
    const int state = current[index2D(row, col, cols)];

    if (state == EMPTY) return EMPTY;
    if (state == BURNED) return BURNED;
    if (state == BURNING) return BURNED;

    for (int dr = -1; dr <= 1; ++dr) {
        for (int dc = -1; dc <= 1; ++dc) {
            if (dr == 0 && dc == 0) continue;

            const int nr = row + dr;
            const int nc = col + dc;

            if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;

            if (current[index2D(nr, nc, cols)] == BURNING) {
                return BURNING;
            }
        }
    }

    return TREE;
}

inline std::uint64_t checksumGrid(const std::vector<int>& grid) {
    std::uint64_t hash = 1469598103934665603ull;
    for (int value : grid) {
        hash ^= static_cast<std::uint64_t>(value + 1);
        hash *= 1099511628211ull;
    }
    return hash;
}

inline int countBurnedCells(const std::vector<int>& grid) {
    return static_cast<int>(std::count(grid.begin(), grid.end(), BURNED));
}

inline void printResult(const std::string& methodName,
                        double milliseconds,
                        const std::vector<int>& finalGrid) {
    std::cout << methodName << " result\n";
    std::cout << "Time (ms): " << milliseconds << "\n";
    std::cout << "Burned cells: " << countBurnedCells(finalGrid) << "\n";
    std::cout << "Checksum: " << checksumGrid(finalGrid) << "\n";
}
