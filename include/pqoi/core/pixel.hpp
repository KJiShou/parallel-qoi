#pragma once

#include <array>
#include <cstdint>

namespace pqoi {

struct Pixel {
    std::uint8_t r{0};
    std::uint8_t g{0};
    std::uint8_t b{0};
    // QOI index slots are zero-initialized, including alpha. Callers that need
    // the format's initial previous pixel explicitly use {0, 0, 0, 255}.
    std::uint8_t a{0};

    friend bool operator==(const Pixel& left, const Pixel& right) noexcept {
        return left.r == right.r && left.g == right.g && left.b == right.b && left.a == right.a;
    }
};

constexpr std::size_t qoi_hash(const Pixel& pixel) noexcept {
    return (static_cast<std::size_t>(pixel.r) * 3U +
            static_cast<std::size_t>(pixel.g) * 5U +
            static_cast<std::size_t>(pixel.b) * 7U +
            static_cast<std::size_t>(pixel.a) * 11U) & 63U;
}

using ColorIndex = std::array<Pixel, 64>;

struct QoiState {
    Pixel previous{0, 0, 0, 255};
    ColorIndex index{};
};

}  // namespace pqoi
