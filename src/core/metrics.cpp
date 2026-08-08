#include "pqoi/metrics.hpp"

#include <fstream>
#include <iomanip>
#include <sstream>
#include <stdexcept>

namespace {

std::string escape_json(const std::string& value) {
    std::string escaped;
    escaped.reserve(value.size());
    for (const char character : value) {
        switch (character) {
            case '\\': escaped += "\\\\"; break;
            case '"': escaped += "\\\""; break;
            case '\n': escaped += "\\n"; break;
            case '\r': escaped += "\\r"; break;
            case '\t': escaped += "\\t"; break;
            default: escaped += character; break;
        }
    }
    return escaped;
}

}  // namespace

namespace pqoi {

std::string result_json(const EncodeResult& result) {
    std::ostringstream json;
    json << std::fixed << std::setprecision(4);
    json << "{\n"
         << "  \"status\": \"" << escape_json(result.status) << "\",\n"
         << "  \"backend\": \"" << escape_json(result.backend) << "\",\n"
         << "  \"error\": \"" << escape_json(result.error) << "\",\n"
         << "  \"input\": {\"path\": \"" << escape_json(result.input_path) << "\", \"width\": "
         << result.width << ", \"height\": " << result.height << ", \"channels\": "
         << static_cast<int>(result.channels) << "},\n"
         << "  \"configuration\": {\"blocks\": " << result.blocks << ", \"threads\": "
         << result.threads << ", \"segment_length\": " << result.segment_length << "},\n"
         << "  \"timing\": {\"load_ms\": " << result.load_ms
         << ", \"summary_ms\": " << result.summary_ms
         << ", \"propagation_ms\": " << result.propagation_ms
         << ", \"transfer_in_ms\": " << result.transfer_in_ms
         << ", \"encode_ms\": " << result.encode_ms
         << ", \"transfer_out_ms\": " << result.transfer_out_ms
         << ", \"merge_ms\": " << result.merge_ms
         << ", \"validation_ms\": " << result.validation_ms
         << ", \"total_ms\": " << result.total_ms << "},\n"
         << "  \"output\": {\"path\": \"" << escape_json(result.output_path) << "\", \"bytes\": "
         << result.output_bytes << ", \"compression_ratio\": " << result.compression_ratio
         << ", \"throughput_mpixels\": " << result.throughput_mpixels << "},\n"
         << "  \"preview_path\": \"" << escape_json(result.preview_path) << "\",\n"
         << "  \"validation\": {\"passed\": " << (result.validation_passed ? "true" : "false")
         << ", \"pixel_match\": " << (result.pixel_match ? "true" : "false")
         << ", \"sha256_match\": " << (result.sha256_match ? "true" : "false") << "}\n"
         << "}\n";
    return json.str();
}

void write_result_json(const std::string& path, const EncodeResult& result) {
    std::ofstream output(path, std::ios::binary);
    if (!output) throw std::runtime_error("cannot open result JSON: " + path);
    output << result_json(result);
}

}  // namespace pqoi
