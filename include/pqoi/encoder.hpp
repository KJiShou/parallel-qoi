#pragma once

#include "pqoi/core/block_summary.hpp"
#include "pqoi/core/encode_result.hpp"
#include "pqoi/core/image.hpp"

#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

namespace pqoi {

struct EncodeOptions {
    std::string backend{"serial"};
    std::size_t blocks{0};
    std::size_t threads{1};
    std::size_t segment_length{1024};
};

std::vector<std::uint8_t> encode_qoi(const Image& image, const EncodeOptions& options);
std::vector<std::uint8_t> encode_qoi(const Image& image, const EncodeOptions& options, EncodeResult* metrics);
EncodeResult run_conversion(const std::string& input_path,
                            const std::string& output_path,
                            const std::string& result_path,
                            const std::string& preview_path,
                            const EncodeOptions& options,
                            bool validate);

EncodeResult run_mpi_conversion(const std::string& input_path,
                                const std::string& output_path,
                                const std::string& result_path,
                                const std::string& preview_path,
                                const EncodeOptions& options,
                                bool validate);

}  // namespace pqoi
