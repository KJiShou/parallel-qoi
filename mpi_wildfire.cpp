#include "wildfire_common.hpp"
#include <mpi.h>
#include <cstdlib>

int localIndex(int localRow, int col, int cols) {
    return localRow * cols + col;
}

void clearGhostRows(std::vector<int>& localGrid, int localRows, int cols) {
    std::fill(localGrid.begin(), localGrid.begin() + cols, EMPTY);
    std::fill(localGrid.begin() + (localRows + 1) * cols,
              localGrid.begin() + (localRows + 2) * cols,
              EMPTY);
}

int updateLocalCell(const std::vector<int>& current, int localRow, int col, int localRows, int cols) {
    const int state = current[localIndex(localRow, col, cols)];

    if (state == EMPTY) return EMPTY;
    if (state == BURNED) return BURNED;
    if (state == BURNING) return BURNED;

    for (int dr = -1; dr <= 1; ++dr) {
        for (int dc = -1; dc <= 1; ++dc) {
            if (dr == 0 && dc == 0) continue;

            const int nr = localRow + dr;
            const int nc = col + dc;

            if (nr < 0 || nr >= localRows + 2 || nc < 0 || nc >= cols) continue;

            if (current[localIndex(nr, nc, cols)] == BURNING) {
                return BURNING;
            }
        }
    }

    return TREE;
}

void exchangeHaloRows(std::vector<int>& current, int localRows, int cols, int rank, int worldSize) {
    const int up = (rank == 0) ? MPI_PROC_NULL : rank - 1;
    const int down = (rank == worldSize - 1) ? MPI_PROC_NULL : rank + 1;

    MPI_Sendrecv(&current[localIndex(1, 0, cols)], cols, MPI_INT, up, 0,
                 &current[localIndex(localRows + 1, 0, cols)], cols, MPI_INT, down, 0,
                 MPI_COMM_WORLD, MPI_STATUS_IGNORE);

    MPI_Sendrecv(&current[localIndex(localRows, 0, cols)], cols, MPI_INT, down, 1,
                 &current[localIndex(0, 0, cols)], cols, MPI_INT, up, 1,
                 MPI_COMM_WORLD, MPI_STATUS_IGNORE);
}

int main(int argc, char** argv) {
    MPI_Init(&argc, &argv);

    int rank = 0;
    int worldSize = 1;
    MPI_Comm_rank(MPI_COMM_WORLD, &rank);
    MPI_Comm_size(MPI_COMM_WORLD, &worldSize);

    SimulationConfig cfg;
    cfg.rows = 512;
    cfg.cols = 512;
    cfg.steps = 200;
    cfg.treeDensity = 0.70f;
    cfg.seed = 42;
    cfg.ignitionRow = cfg.rows / 2;
    cfg.ignitionCol = cfg.cols / 2;

    if (cfg.rows % worldSize != 0) {
        if (rank == 0) {
            std::cerr << "Error: rows must be divisible by number of MPI processes.\n";
        }
        MPI_Abort(MPI_COMM_WORLD, EXIT_FAILURE);
    }

    const int localRows = cfg.rows / worldSize;
    std::vector<int> fullGrid;

    if (rank == 0) {
        fullGrid = generateInitialGrid(cfg);
    }

    std::vector<int> localCurrent((localRows + 2) * cfg.cols, EMPTY);
    std::vector<int> localNext((localRows + 2) * cfg.cols, EMPTY);

    MPI_Scatter(rank == 0 ? fullGrid.data() : nullptr,
                localRows * cfg.cols,
                MPI_INT,
                &localCurrent[localIndex(1, 0, cfg.cols)],
                localRows * cfg.cols,
                MPI_INT,
                0,
                MPI_COMM_WORLD);

    MPI_Barrier(MPI_COMM_WORLD);
    const double start = MPI_Wtime();

    for (int step = 0; step < cfg.steps; ++step) {
        clearGhostRows(localCurrent, localRows, cfg.cols);
        exchangeHaloRows(localCurrent, localRows, cfg.cols, rank, worldSize);

        for (int r = 1; r <= localRows; ++r) {
            for (int c = 0; c < cfg.cols; ++c) {
                localNext[localIndex(r, c, cfg.cols)] = updateLocalCell(localCurrent, r, c, localRows, cfg.cols);
            }
        }

        localCurrent.swap(localNext);
    }

    MPI_Barrier(MPI_COMM_WORLD);
    const double end = MPI_Wtime();

    std::vector<int> finalGrid;
    if (rank == 0) {
        finalGrid.resize(cfg.rows * cfg.cols);
    }

    MPI_Gather(&localCurrent[localIndex(1, 0, cfg.cols)],
               localRows * cfg.cols,
               MPI_INT,
               rank == 0 ? finalGrid.data() : nullptr,
               localRows * cfg.cols,
               MPI_INT,
               0,
               MPI_COMM_WORLD);

    if (rank == 0) {
        printResult("MPI", (end - start) * 1000.0, finalGrid);
        std::cout << "MPI processes: " << worldSize << "\n";
    }

    MPI_Finalize();
    return 0;
}
