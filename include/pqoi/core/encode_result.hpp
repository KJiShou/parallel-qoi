#pragma once

#include <cstddef>
#include <cstdint>
#include <string>

namespace pqoi {

struct EncodeResult {
    std::string status{"error"};
    std::string backend;
    std::string error;
    std::uint32_t width{0};
    std::uint32_t height{0};
    std::uint8_t channels{0};
    std::size_t output_bytes{0};
    double load_ms{0.0};
    double summary_ms{0.0};
    double propagation_ms{0.0};
    double transfer_in_ms{0.0};
    double encode_ms{0.0};
    double transfer_out_ms{0.0};
    double merge_ms{0.0};
    double validation_ms{0.0};
    double total_ms{0.0};
    double compression_ratio{0.0};
    double throughput_mpixels{0.0};
    std::size_t blocks{1};
    std::size_t threads{1};
    std::size_t segment_length{1024};
    bool validation_passed{false};
    bool pixel_match{false};
    bool sha256_match{false};
    std::string input_path;
    std::string output_path;
    std::string preview_path;
    std::string result_path;
};

}  // namespace pqoi
