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

void flush_run(std::vector<std::uint8_t>& output, unsigned int& run) {
    while (run > 0U) {
        const unsigned int chunk = std::min(run, 62U);
        output.push_back(static_cast<std::uint8_t>(pqoi::qoi_op_run | (chunk - 1U)));
        run -= chunk;
    }
}

}  // namespace

namespace pqoi {

void encode_qoi_block(const std::vector<Pixel>& pixels,
                      const Block block,
                      QoiState state,
                      std::vector<std::uint8_t>& output) {
    unsigned int run = 0U;
    for (std::size_t position = block.begin; position < block.end; ++position) {
        const Pixel pixel = pixels.at(position);
        if (pixel == state.previous) {
            ++run;
            state.index[qoi_hash(pixel)] = pixel;
            if (run == 62U || position + 1U == block.end) flush_run(output, run);
            continue;
        }

        flush_run(output, run);
        const std::size_t slot = qoi_hash(pixel);
        if (state.index[slot] == pixel) {
            output.push_back(static_cast<std::uint8_t>(qoi_op_index | slot));
        } else {
            state.index[slot] = pixel;
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
