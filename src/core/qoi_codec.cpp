#include "pqoi/encoder.hpp"

#include "pqoi/core/qoi_chunks.hpp"
#include "pqoi/core/qoi_encode.hpp"

#include <algorithm>
#include <cstdint>
#include <stdexcept>
#include <vector>

#ifdef PQOI_HAS_CUDA
namespace pqoi {
std::vector<std::uint8_t> encode_cuda_qoi(const Image& image,
                                          const EncodeOptions& options,
                                          EncodeResult* metrics);
}
#endif

namespace {

void write_u32_be(std::vector<std::uint8_t>& output, const std::uint32_t value) {
    output.push_back(static_cast<std::uint8_t>((value >> 24U) & 0xffU));
    output.push_back(static_cast<std::uint8_t>((value >> 16U) & 0xffU));
    output.push_back(static_cast<std::uint8_t>((value >> 8U) & 0xffU));
    output.push_back(static_cast<std::uint8_t>(value & 0xffU));
}

void flush_run(std::vector<std::uint8_t>& output,
               unsigned int& run,
               pqoi::BlockEncodingStats* stats = nullptr) {
    while (run > 0U) {
        const unsigned int chunk = std::min(run, 62U);
        output.push_back(static_cast<std::uint8_t>(pqoi::qoi_op_run | (chunk - 1U)));
        if (stats != nullptr) ++stats->run_chunks;
        run -= chunk;
    }
}

}  // namespace

namespace pqoi {

void encode_qoi_block(const std::vector<Pixel>& pixels,
                      const Block block,
                      QoiState state,
                      std::vector<std::uint8_t>& output,
                      BlockEncodingStats* stats) {
    unsigned int run = 0U;
    std::array<bool, 64> locally_touched{};
    for (std::size_t position = block.begin; position < block.end; ++position) {
        // The block partition is validated before encoding; unchecked access
        // keeps the hot loop branch-free while retaining the same bounds
        // invariant as the summary pass.
        const Pixel pixel = pixels[position];
        const std::size_t slot = qoi_hash(pixel);
        if (pixel == state.previous) {
            ++run;
            state.index[slot] = pixel;
            locally_touched[slot] = true;
            if (run == 62U || position + 1U == block.end) flush_run(output, run, stats);
            continue;
        }

        flush_run(output, run, stats);
        if (state.index[slot] == pixel) {
            if (stats && !locally_touched[slot]) {
                ++stats->inherited_index_hits;
                const int dr = static_cast<int>(pixel.r) - static_cast<int>(state.previous.r);
                const int dg = static_cast<int>(pixel.g) - static_cast<int>(state.previous.g);
                const int db = static_cast<int>(pixel.b) - static_cast<int>(state.previous.b);
                const int da = static_cast<int>(pixel.a) - static_cast<int>(state.previous.a);
                std::size_t fallback_bytes = da != 0 ? 5U : 4U;
                if (da == 0 && dr > -3 && dr < 2 && dg > -3 && dg < 2 && db > -3 && db < 2) {
                    fallback_bytes = 1U;
                } else if (da == 0) {
                    const int dr_dg = dr - dg;
                    const int db_dg = db - dg;
                    if (dg > -33 && dg < 32 && dr_dg > -9 && dr_dg < 8 && db_dg > -9 && db_dg < 8) fallback_bytes = 2U;
                }
                stats->fallback_bytes_avoided += fallback_bytes - 1U;
            }
            output.push_back(static_cast<std::uint8_t>(qoi_op_index | slot));
            if (stats != nullptr) ++stats->index_chunks;
        } else {
            state.index[slot] = pixel;
            const int dr = static_cast<int>(pixel.r) - static_cast<int>(state.previous.r);
            const int dg = static_cast<int>(pixel.g) - static_cast<int>(state.previous.g);
            const int db = static_cast<int>(pixel.b) - static_cast<int>(state.previous.b);
            const int da = static_cast<int>(pixel.a) - static_cast<int>(state.previous.a);
            if (da == 0 && dr > -3 && dr < 2 && dg > -3 && dg < 2 && db > -3 && db < 2) {
                output.push_back(static_cast<std::uint8_t>(qoi_op_diff |
                    ((dr + 2) << 4) | ((dg + 2) << 2) | (db + 2)));
                if (stats != nullptr) ++stats->diff_chunks;
            } else if (da == 0) {
                const int dr_dg = dr - dg;
                const int db_dg = db - dg;
                if (dg > -33 && dg < 32 && dr_dg > -9 && dr_dg < 8 && db_dg > -9 && db_dg < 8) {
                    output.push_back(static_cast<std::uint8_t>(qoi_op_luma | (dg + 32)));
                    output.push_back(static_cast<std::uint8_t>(((dr_dg + 8) << 4) | (db_dg + 8)));
                    if (stats != nullptr) ++stats->luma_chunks;
                } else {
                    output.push_back(qoi_op_rgb);
                    output.push_back(pixel.r); output.push_back(pixel.g); output.push_back(pixel.b);
                    if (stats != nullptr) ++stats->rgb_chunks;
                }
            } else {
                output.push_back(qoi_op_rgba);
                output.push_back(pixel.r); output.push_back(pixel.g);
                output.push_back(pixel.b); output.push_back(pixel.a);
                if (stats != nullptr) ++stats->rgba_chunks;
            }
        }
        locally_touched[slot] = true;
        state.previous = pixel;
    }
    flush_run(output, run, stats);
}

void encode_qoi_block_local(const std::vector<Pixel>& pixels,
                            const Block block,
                            std::vector<std::uint8_t>& output) {
    if (block.begin >= block.end) return;
    QoiState state;
    std::array<bool, 64> local_slots{};

    // A block-local encoder does not inherit the previous pixel or index. An
    // explicit RGBA chunk makes the boundary independently decodable without
    // resetting the state held by a conforming QOI decoder.
    const Pixel first = pixels[block.begin];
    output.push_back(qoi_op_rgba);
    output.push_back(first.r); output.push_back(first.g);
    output.push_back(first.b); output.push_back(first.a);
    state.previous = first;
    state.index[qoi_hash(first)] = first;
    local_slots[qoi_hash(first)] = true;

    unsigned int run = 0U;
    for (std::size_t position = block.begin + 1U; position < block.end; ++position) {
        const Pixel pixel = pixels[position];
        const std::size_t slot = qoi_hash(pixel);
        if (pixel == state.previous) {
            ++run;
            state.index[slot] = pixel;
            local_slots[slot] = true;
            if (run == 62U || position + 1U == block.end) flush_run(output, run);
            continue;
        }

        flush_run(output, run);
        if (local_slots[slot] && state.index[slot] == pixel) {
            output.push_back(static_cast<std::uint8_t>(qoi_op_index | slot));
        } else {
            state.index[slot] = pixel;
            local_slots[slot] = true;
            const int dr = static_cast<int>(pixel.r) - static_cast<int>(state.previous.r);
            const int dg = static_cast<int>(pixel.g) - static_cast<int>(state.previous.g);
            const int db = static_cast<int>(pixel.b) - static_cast<int>(state.previous.b);
            const int da = static_cast<int>(pixel.a) - static_cast<int>(state.previous.a);
            if (da == 0 && dr > -3 && dr < 2 && dg > -3 && dg < 2 && db > -3 && db < 2) {
                output.push_back(static_cast<std::uint8_t>(qoi_op_diff |
                    ((dr + 2) << 4) | ((dg + 2) << 2) | (db + 2)));
            } else if (da == 0) {
                const int dr_dg = dr - dg;
                const int db_dg = db - dg;
                if (dg > -33 && dg < 32 && dr_dg > -9 && dr_dg < 8 && db_dg > -9 && db_dg < 8) {
                    output.push_back(static_cast<std::uint8_t>(qoi_op_luma | (dg + 32)));
                    output.push_back(static_cast<std::uint8_t>(((dr_dg + 8) << 4) | (db_dg + 8)));
                } else {
                    output.push_back(qoi_op_rgb);
                    output.push_back(pixel.r); output.push_back(pixel.g); output.push_back(pixel.b);
                }
            } else {
                output.push_back(qoi_op_rgba);
                output.push_back(pixel.r); output.push_back(pixel.g);
                output.push_back(pixel.b); output.push_back(pixel.a);
            }
        }
        state.previous = pixel;
    }
    flush_run(output, run);
}

std::vector<std::uint8_t> assemble_qoi(const Image& image,
                                       const std::vector<std::vector<std::uint8_t>>& block_bytes) {
    std::vector<std::uint8_t> output;
    output.reserve(image.pixels.size() * 2U + 22U);
    output.insert(output.end(), {'q', 'o', 'i', 'f'});
    const auto append_u32 = [&output](const std::uint32_t value) {
        write_u32_be(output, value);
    };
    append_u32(image.width);
    append_u32(image.height);
    output.push_back(image.channels);
    output.push_back(0U);
    for (const auto& bytes : block_bytes) output.insert(output.end(), bytes.begin(), bytes.end());
    output.insert(output.end(), {0U, 0U, 0U, 0U, 0U, 0U, 0U, 1U});
    return output;
}

std::vector<std::uint8_t> assemble_qoi(const Image& image,
                                       const std::vector<std::uint8_t>& payload) {
    std::vector<std::uint8_t> output = prepare_qoi_buffer(image, payload.size());
    std::copy(payload.begin(), payload.end(), output.begin() + qoi_header_bytes);
    return output;
}

std::vector<std::uint8_t> prepare_qoi_buffer(const Image& image,
                                             const std::size_t payload_bytes) {
    std::vector<std::uint8_t> output(qoi_header_bytes + payload_bytes + qoi_end_marker_bytes, 0U);
    output[0] = 'q'; output[1] = 'o'; output[2] = 'i'; output[3] = 'f';
    output[4] = static_cast<std::uint8_t>((image.width >> 24U) & 0xffU);
    output[5] = static_cast<std::uint8_t>((image.width >> 16U) & 0xffU);
    output[6] = static_cast<std::uint8_t>((image.width >> 8U) & 0xffU);
    output[7] = static_cast<std::uint8_t>(image.width & 0xffU);
    output[8] = static_cast<std::uint8_t>((image.height >> 24U) & 0xffU);
    output[9] = static_cast<std::uint8_t>((image.height >> 16U) & 0xffU);
    output[10] = static_cast<std::uint8_t>((image.height >> 8U) & 0xffU);
    output[11] = static_cast<std::uint8_t>(image.height & 0xffU);
    output[12] = image.channels;
    output[13] = 0U;
    output[qoi_header_bytes + payload_bytes + 7U] = 1U;
    return output;
}

std::vector<std::uint8_t> encode_qoi(const Image& image,
                                     const EncodeOptions& options,
                                     EncodeResult* metrics) {
    if (options.backend == "serial") return encode_serial_qoi(image, options, metrics);
    if (options.backend == "openmp") return encode_openmp_qoi(image, options, metrics);
    if (options.backend == "one-pass") return encode_serial_qoi(image, options, metrics);
    if (options.backend == "cuda") {
#ifdef PQOI_HAS_CUDA
        return encode_cuda_qoi(image, options, metrics);
#else
        throw std::runtime_error("CUDA backend is not built with CUDA support");
#endif
    }
    throw std::runtime_error("unknown QOI backend: " + options.backend);
}

std::vector<std::uint8_t> encode_qoi(const Image& image, const EncodeOptions& options) {
    return encode_qoi(image, options, nullptr);
}

}  // namespace pqoi
