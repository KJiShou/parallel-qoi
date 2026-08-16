#include "pqoi/core/block_summary.hpp"

#include <algorithm>
#include <stdexcept>

namespace pqoi {

std::vector<Block> partition_blocks(const std::size_t pixel_count,
                                    const std::size_t block_count) {
    if (pixel_count == 0U) {
        return {};
    }
    const std::size_t count = std::max<std::size_t>(1U, std::min(block_count, pixel_count));
    std::vector<Block> blocks;
    blocks.reserve(count);
    const std::size_t base = pixel_count / count;
    const std::size_t remainder = pixel_count % count;
    std::size_t cursor = 0U;
    for (std::size_t index = 0U; index < count; ++index) {
        const std::size_t length = base + (index < remainder ? 1U : 0U);
        blocks.push_back(Block{cursor, cursor + length});
        cursor += length;
    }
    return blocks;
}

}  // namespace pqoi

