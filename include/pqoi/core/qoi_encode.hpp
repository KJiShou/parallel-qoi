#pragma once

#include "pqoi/core/block_summary.hpp"
#include "pqoi/core/image.hpp"
#include "pqoi/core/qoi_state.hpp"

#include <cstdint>
#include <vector>

namespace pqoi {

struct BlockEncodingStats {
    // Chunk counters are collected while the encoder is already walking the
    // pixels.  MPI can gather these fixed-size counters with the payload
    // lengths and avoid a second root-side scan of the assembled QOI stream.
    std::size_t run_chunks{0};
    std::size_t index_chunks{0};
    std::size_t diff_chunks{0};
    std::size_t luma_chunks{0};
    std::size_t rgb_chunks{0};
    std::size_t rgba_chunks{0};
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
std::vector<std::uint8_t> assemble_qoi(const Image& image,
                                       const std::vector<std::uint8_t>& payload);

// Allocates a complete QOI buffer and writes its header/end marker, leaving
// the payload region ready for a direct MPI_Gatherv receive.  The payload
// offset is stable for the QOI format and is intentionally exposed so callers
// do not need a temporary gathered-payload vector.
constexpr std::size_t qoi_header_bytes = 14U;
constexpr std::size_t qoi_end_marker_bytes = 8U;
std::vector<std::uint8_t> prepare_qoi_buffer(const Image& image,
                                             std::size_t payload_bytes);

// Backend-owned block scheduling. These functions keep the algorithm-specific
// work in src/backends while qoi_codec.cpp owns shared QOI chunk primitives.
std::vector<std::uint8_t> encode_serial_qoi(const Image& image,
                                            const EncodeOptions& options,
                                            EncodeResult* metrics);
std::vector<std::uint8_t> encode_openmp_qoi(const Image& image,
                                            const EncodeOptions& options,
                                            EncodeResult* metrics);

}  // namespace pqoi
