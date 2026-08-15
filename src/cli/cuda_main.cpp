#include "pqoi/cli.hpp"
#include "pqoi/encoder.hpp"

#include <cctype>
#include <cstddef>
#include <iostream>
#include <stdexcept>
#include <string>

namespace {

std::size_t value_position(const std::string& json, const std::string& key) {
    const std::string marker = "\"" + key + "\"";
    const std::size_t key_position = json.find(marker);
    if (key_position == std::string::npos) throw std::runtime_error("missing JSON field: " + key);
    const std::size_t colon = json.find(':', key_position + marker.size());
    if (colon == std::string::npos) throw std::runtime_error("invalid JSON field: " + key);
    std::size_t position = colon + 1U;
    while (position < json.size() && std::isspace(static_cast<unsigned char>(json[position])) != 0) ++position;
    return position;
}

std::string json_string(const std::string& json, const std::string& key) {
    std::size_t position = value_position(json, key);
    if (position >= json.size() || json[position] != '"') throw std::runtime_error("JSON field is not a string: " + key);
    ++position;
    std::string value;
    while (position < json.size()) {
        const char character = json[position++];
        if (character == '"') return value;
        if (character != '\\') {
            value += character;
            continue;
        }
        if (position >= json.size()) break;
        const char escaped = json[position++];
        switch (escaped) {
            case '"': value += '"'; break;
            case '\\': value += '\\'; break;
            case '/': value += '/'; break;
            case 'b': value += '\b'; break;
            case 'f': value += '\f'; break;
            case 'n': value += '\n'; break;
            case 'r': value += '\r'; break;
            case 't': value += '\t'; break;
            default: throw std::runtime_error("unsupported JSON escape in field: " + key);
        }
    }
    throw std::runtime_error("unterminated JSON string: " + key);
}

std::size_t json_size(const std::string& json, const std::string& key) {
    std::size_t position = value_position(json, key);
    std::size_t end = position;
    while (end < json.size() && std::isdigit(static_cast<unsigned char>(json[end])) != 0) ++end;
    if (end == position) throw std::runtime_error("JSON field is not an unsigned integer: " + key);
    return std::stoull(json.substr(position, end - position));
}

bool json_bool(const std::string& json, const std::string& key) {
    const std::size_t position = value_position(json, key);
    if (json.compare(position, 4U, "true") == 0) return true;
    if (json.compare(position, 5U, "false") == 0) return false;
    throw std::runtime_error("JSON field is not a boolean: " + key);
}

std::string escape_json(const std::string& value) {
    std::string escaped;
    for (const char character : value) {
        if (character == '\\' || character == '"') escaped += '\\';
        if (character == '\n') escaped += "\\n";
        else if (character == '\r') escaped += "\\r";
        else escaped += character;
    }
    return escaped;
}

int run_server() {
    std::string request;
    while (std::getline(std::cin, request)) {
        if (request.empty()) continue;
        std::string request_id;
        try {
            request_id = json_string(request, "request_id");
            pqoi::EncodeOptions options;
            options.backend = "cuda";
            options.segment_length = json_size(request, "segment_length");
            options.cuda_threads_per_block = json_size(request, "cuda_threads_per_block");
            const pqoi::EncodeResult result = pqoi::run_conversion(
                json_string(request, "input"), json_string(request, "output"),
                json_string(request, "result"), json_string(request, "preview"),
                options, json_bool(request, "validate"));
            std::cout << "{\"request_id\":\"" << escape_json(request_id)
                      << "\",\"status\":\"" << escape_json(result.status)
                      << "\",\"error\":\"" << escape_json(result.error) << "\"}" << std::endl;
        } catch (const std::exception& error) {
            std::cout << "{\"request_id\":\"" << escape_json(request_id)
                      << "\",\"status\":\"error\",\"error\":\""
                      << escape_json(error.what()) << "\"}" << std::endl;
        }
    }
    return 0;
}

}  // namespace

int main(int argc, char** argv) {
    if (argc == 2 && std::string(argv[1]) == "--server") return run_server();
    return pqoi::run_cli(argc, argv, "cuda");
}

