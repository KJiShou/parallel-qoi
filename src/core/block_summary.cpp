#include "pqoi/core/block_summary.hpp"

namespace pqoi {

BlockSummary summarize_block(const std::vector<Pixel>& pixels, const Block block) {
    BlockSummary summary;
    for (std::size_t position = block.begin; position < block.end; ++position) {
        const Pixel pixel = pixels.at(position);
        const std::size_t slot = qoi_hash(pixel);
        summary.last_pixel_for_slot[slot] = pixel;
        summary.touched[slot] = true;
        summary.last_pixel = pixel;
    }
    return summary;
}

std::vector<QoiState> propagate_states(const std::vector<BlockSummary>& summaries) {
    std::vector<QoiState> entries;
    entries.reserve(summaries.size());
    QoiState state;
    for (const BlockSummary& summary : summaries) {
        entries.push_back(state);
        state.previous = summary.last_pixel;
        for (std::size_t slot = 0U; slot < summary.touched.size(); ++slot) {
            if (summary.touched[slot]) {
                state.index[slot] = summary.last_pixel_for_slot[slot];
            }
        }
    }
    return entries;
}

}  // namespace pqoi

