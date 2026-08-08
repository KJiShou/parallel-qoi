#include "pqoi/validation.hpp"

#include "qoi/qoi.h"

#include <cstring>
#include <cstdlib>
#include <array>
#include <fstream>
#include <iterator>
#include <limits>
#include <stdexcept>
#include <vector>

#ifdef _WIN32
#include <windows.h>
#include <bcrypt.h>
#endif

namespace {

std::vector<std::uint8_t> pixel_bytes(const pqoi::Image& image) {
    std::vector<std::uint8_t> bytes;
    bytes.reserve(image.pixels.size() * 4U);
    for (const pqoi::Pixel pixel : image.pixels) {
        bytes.push_back(pixel.r); bytes.push_back(pixel.g); bytes.push_back(pixel.b); bytes.push_back(pixel.a);
    }
    return bytes;
}

#ifdef _WIN32
bool same_sha256(const std::vector<std::uint8_t>& left, const std::vector<std::uint8_t>& right) {
    BCRYPT_ALG_HANDLE algorithm = nullptr;
    if (BCryptOpenAlgorithmProvider(&algorithm, BCRYPT_SHA256_ALGORITHM, nullptr, 0U) != 0) return false;
    DWORD object_length = 0U;
    DWORD property_length = 0U;
    if (BCryptGetProperty(algorithm, BCRYPT_OBJECT_LENGTH, reinterpret_cast<PUCHAR>(&object_length), sizeof(object_length), &property_length, 0U) != 0) {
        BCryptCloseAlgorithmProvider(algorithm, 0U); return false;
    }
    auto digest = [&algorithm, object_length](const std::vector<std::uint8_t>& input) {
        std::vector<UCHAR> object(object_length);
        std::array<UCHAR, 32> result{};
        BCRYPT_HASH_HANDLE hash = nullptr;
        if (BCryptCreateHash(algorithm, &hash, object.data(), object_length, nullptr, 0U, 0U) != 0) return result;
        const ULONG input_length = input.size() > static_cast<std::size_t>((std::numeric_limits<ULONG>::max)())
            ? (std::numeric_limits<ULONG>::max)()
            : static_cast<ULONG>(input.size());
        BCryptHashData(hash, const_cast<PUCHAR>(input.data()), input_length, 0U);
        BCryptFinishHash(hash, result.data(), static_cast<ULONG>(result.size()), 0U);
        BCryptDestroyHash(hash);
        return result;
    };
    const auto left_digest = digest(left);
    const auto right_digest = digest(right);
    BCryptCloseAlgorithmProvider(algorithm, 0U);
    return left_digest == right_digest;
}
#endif

}  // namespace

namespace pqoi {

Image decode_qoi(const std::string& qoi_path) {
    std::ifstream input(qoi_path, std::ios::binary);
    if (!input) throw std::runtime_error("cannot open QOI: " + qoi_path);
    const std::vector<std::uint8_t> bytes((std::istreambuf_iterator<char>(input)), {});
    qoi_desc description{};
    auto* decoded = static_cast<std::uint8_t*>(qoi_decode(bytes.data(), static_cast<int>(bytes.size()), &description, 4));
    if (decoded == nullptr) throw std::runtime_error("official QOI decoder rejected output");
    Image image;
    image.width = description.width;
    image.height = description.height;
    image.channels = 4U;
    image.pixels.resize(static_cast<std::size_t>(image.width) * image.height);
    for (std::size_t index = 0U; index < image.pixels.size(); ++index) {
        image.pixels[index] = Pixel{decoded[index * 4U], decoded[index * 4U + 1U],
                                    decoded[index * 4U + 2U], decoded[index * 4U + 3U]};
    }
    std::free(decoded);
    return image;
}

bool validate_qoi(const std::string& qoi_path, const Image& expected) {
    try {
        const Image actual = decode_qoi(qoi_path);
        return actual.width == expected.width && actual.height == expected.height &&
               actual.pixels == expected.pixels;
    } catch (...) {
        return false;
    }
}

bool sha256_match_qoi(const std::string& qoi_path, const Image& expected) {
    try {
        const Image actual = decode_qoi(qoi_path);
        if (actual.width != expected.width || actual.height != expected.height) return false;
        const auto actual_bytes = pixel_bytes(actual);
        const auto expected_bytes = pixel_bytes(expected);
#ifdef _WIN32
        return same_sha256(actual_bytes, expected_bytes);
#else
        return actual_bytes == expected_bytes;
#endif
    } catch (...) {
        return false;
    }
}

}  // namespace pqoi
