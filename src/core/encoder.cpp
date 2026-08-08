#include "pqoi/encoder.hpp"

#include "pqoi/metrics.hpp"
#include "pqoi/validation.hpp"

#include <chrono>
#include <fstream>
#include <stdexcept>

namespace {

using clock_type = std::chrono::steady_clock;

double elapsed_ms(const clock_type::time_point start, const clock_type::time_point end) {
    return std::chrono::duration<double, std::milli>(end - start).count();
}

void write_bytes(const std::string& path, const std::vector<std::uint8_t>& bytes) {
    std::ofstream output(path, std::ios::binary);
    if (!output) throw std::runtime_error("cannot open output: " + path);
    output.write(reinterpret_cast<const char*>(bytes.data()), static_cast<std::streamsize>(bytes.size()));
    if (!output) throw std::runtime_error("cannot write output: " + path);
}

}  // namespace

namespace pqoi {

EncodeResult run_conversion(const std::string& input_path,
                            const std::string& output_path,
                            const std::string& result_path,
                            const std::string& preview_path,
                            const EncodeOptions& options,
                            const bool validate) {
    EncodeResult result;
    result.backend = options.backend;
    result.input_path = input_path;
    result.output_path = output_path;
    result.preview_path = preview_path;
    result.result_path = result_path;
    result.blocks = options.blocks;
    result.threads = options.threads;
    result.segment_length = options.segment_length;
    const auto total_start = clock_type::now();
    try {
        const auto load_start = clock_type::now();
        const Image image = load_image(input_path);
        result.load_ms = elapsed_ms(load_start, clock_type::now());
        result.width = image.width;
        result.height = image.height;
        result.channels = image.channels;
        const auto encode_start = clock_type::now();
        const std::vector<std::uint8_t> encoded = encode_qoi(image, options, &result);
        const auto encode_end = clock_type::now();
        if (result.encode_ms <= 0.0) result.encode_ms = elapsed_ms(encode_start, encode_end);
        result.output_bytes = encoded.size();
        const std::size_t raw_bytes = image.pixels.size() * static_cast<std::size_t>(image.channels);
        result.compression_ratio = encoded.empty() ? 0.0 : static_cast<double>(raw_bytes) / encoded.size();
        result.throughput_mpixels = result.encode_ms <= 0.0
            ? 0.0
            : static_cast<double>(image.pixels.size()) / (result.encode_ms * 1000.0);
        write_bytes(output_path, encoded);
        if (validate) {
            const auto validation_start = clock_type::now();
            result.validation_passed = validate_qoi(output_path, image);
            result.pixel_match = result.validation_passed;
            result.sha256_match = sha256_match_qoi(output_path, image);
            if (result.validation_passed && !preview_path.empty()) {
                write_bmp(preview_path, decode_qoi(output_path));
            }
            result.validation_ms = elapsed_ms(validation_start, clock_type::now());
        }
        result.status = result.validation_passed || !validate ? "success" : "validation_failed";
    } catch (const std::exception& error) {
        result.status = "error";
        result.error = error.what();
    }
    result.total_ms = elapsed_ms(total_start, clock_type::now());
    if (!result_path.empty()) write_result_json(result_path, result);
    return result;
}

}  // namespace pqoi
