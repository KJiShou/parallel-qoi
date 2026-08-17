#pragma once

#include "pqoi/core/pixel.hpp"

#include <cstddef>
#include <vector>

namespace pqoi {

struct Block {
    std::size_t begin{0};
    std::size_t end{0};
};

struct BlockSummary {
    Pixel last_pixel{0, 0, 0, 255};
    ColorIndex last_pixel_for_slot{};
    std::array<bool, 64> touched{};
};

std::vector<Block> partition_blocks(std::size_t pixel_count, std::size_t block_count);
BlockSummary summarize_block(const std::vector<Pixel>& pixels, Block block);
BlockSummary combine_block_summaries(const std::vector<BlockSummary>& summaries);
QoiState apply_block_summary(QoiState state, const BlockSummary& summary);
std::vector<QoiState> propagate_states(const std::vector<BlockSummary>& summaries);
std::vector<QoiState> propagate_states_from(const QoiState& initial_state,
                                            const std::vector<BlockSummary>& summaries);

}  // namespace pqoi

