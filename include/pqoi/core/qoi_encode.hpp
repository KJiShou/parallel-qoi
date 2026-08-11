#pragma once

#include "pqoi/core/block_summary.hpp"
#include "pqoi/core/image.hpp"
#include "pqoi/core/qoi_state.hpp"

#include <cstdint>
#include <vector>

namespace pqoi {

struct BlockEncodingStats {
    std::size_t inherited_index_hits{0};
    std::size_t fallback_bytes_avoided{0};
};

struct EncodeOptions;
struct EncodeResult;

// Encodes one contiguous range beginning with the supplied QOI state. The
// returned bytes contain QOI chunks only (no file header or end marker).
void encode_qoi_block(const std::vector<Pixel>& pixels,
                      Block block,
                      QoiState state,
                      std::vector<std::uint8_t>& output,
                      BlockEncodingStats* stats = nullptr);
void encode_qoi_block_local(const std::vector<Pixel>& pixels,
                            Block block,
                            std::vector<std::uint8_t>& output);

// Concatenates ordered block chunks into a standards-compliant QOI file.
std::vector<std::uint8_t> assemble_qoi(const Image& image,
                                       const std::vector<std::vector<std::uint8_t>>& block_bytes);

// Backend-owned block scheduling. These functions keep the algorithm-specific
// work in src/backends while qoi_codec.cpp owns shared QOI chunk primitives.
std::vector<std::uint8_t> encode_serial_qoi(const Image& image,
                                            const EncodeOptions& options,
                                            EncodeResult* metrics);
std::vector<std::uint8_t> encode_openmp_qoi(const Image& image,
                                            const EncodeOptions& options,
                                            EncodeResult* metrics);

}  // namespace pqoi
