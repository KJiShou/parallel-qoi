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

BlockSummary combine_block_summaries(const std::vector<BlockSummary>& summaries) {
    BlockSummary combined;
    for (const BlockSummary& summary : summaries) {
        bool has_pixels = false;
        for (std::size_t slot = 0U; slot < summary.touched.size(); ++slot) {
            if (!summary.touched[slot]) continue;
            has_pixels = true;
            combined.last_pixel_for_slot[slot] = summary.last_pixel_for_slot[slot];
            combined.touched[slot] = true;
        }
        if (has_pixels) combined.last_pixel = summary.last_pixel;
    }
    return combined;
}

QoiState apply_block_summary(QoiState state, const BlockSummary& summary) {
    state.previous = summary.last_pixel;
    for (std::size_t slot = 0U; slot < summary.touched.size(); ++slot) {
        if (summary.touched[slot]) state.index[slot] = summary.last_pixel_for_slot[slot];
    }
    return state;
}

std::vector<QoiState> propagate_states_from(const QoiState& initial_state,
                                            const std::vector<BlockSummary>& summaries) {
    std::vector<QoiState> entries;
    entries.reserve(summaries.size());
    QoiState state = initial_state;
    for (const BlockSummary& summary : summaries) {
        entries.push_back(state);
        state = apply_block_summary(state, summary);
    }
    return entries;
}

std::vector<QoiState> propagate_states(const std::vector<BlockSummary>& summaries) {
    return propagate_states_from(QoiState{}, summaries);
}

}  // namespace pqoi

