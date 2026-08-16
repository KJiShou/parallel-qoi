#pragma once

#include "pqoi/core/encode_result.hpp"
#include "pqoi/core/image.hpp"

#include <cstdint>
#include <vector>

#include <string>

namespace pqoi {

void populate_chunk_distribution(const std::vector<std::uint8_t>& encoded, EncodeResult& result);
void analyze_cross_block_benefit(const Image& image, std::size_t block_count, EncodeResult& result);

std::string result_json(const EncodeResult& result);
void write_result_json(const std::string& path, const EncodeResult& result);

}  // namespace pqoi
