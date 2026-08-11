#include "pqoi/encoder.hpp"

#include "pqoi/core/qoi_encode.hpp"

#include <chrono>
#include <vector>

namespace {

using clock_type = std::chrono::steady_clock;

double elapsed_ms(const clock_type::time_point start, const clock_type::time_point end) {
    return std::chrono::duration<double, std::milli>(end - start).count();
}

}  // namespace

namespace pqoi {

std::vector<std::uint8_t> encode_serial_qoi(const Image& image,
                                            const EncodeOptions& options,
                                            EncodeResult* metrics) {
    const std::size_t requested_blocks = options.blocks == 0U ? 1U : options.blocks;

    const auto summary_start = clock_type::now();
    const std::vector<Block> blocks = partition_blocks(image.pixels.size(), requested_blocks);
    std::vector<BlockSummary> summaries;
    summaries.reserve(blocks.size());
    for (const Block block : blocks) summaries.push_back(summarize_block(image.pixels, block));
    if (metrics) {
        metrics->blocks = blocks.size();
        metrics->summary_ms = elapsed_ms(summary_start, clock_type::now());
    }

    const auto propagation_start = clock_type::now();
    const std::vector<QoiState> entries = propagate_states(summaries);
    if (metrics) metrics->propagation_ms = elapsed_ms(propagation_start, clock_type::now());

    const auto encode_start = clock_type::now();
    std::vector<std::vector<std::uint8_t>> block_bytes(blocks.size());
    for (std::size_t index = 0U; index < blocks.size(); ++index) {
        if (options.backend == "one-pass") {
            encode_qoi_block_local(image.pixels, blocks[index], block_bytes[index]);
        } else {
            encode_qoi_block(image.pixels, blocks[index], entries[index], block_bytes[index]);
        }
    }
    if (metrics) metrics->encode_ms = elapsed_ms(encode_start, clock_type::now());
    const auto merge_start = clock_type::now();
    std::vector<std::uint8_t> encoded = assemble_qoi(image, block_bytes);
    if (metrics) metrics->merge_ms = elapsed_ms(merge_start, clock_type::now());
    return encoded;
}

}  // namespace pqoi
