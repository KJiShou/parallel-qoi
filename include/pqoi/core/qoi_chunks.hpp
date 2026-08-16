#pragma once

#include <cstdint>

namespace pqoi {

constexpr std::uint8_t qoi_op_index{0x00U};
constexpr std::uint8_t qoi_op_diff{0x40U};
constexpr std::uint8_t qoi_op_luma{0x80U};
constexpr std::uint8_t qoi_op_run{0xc0U};
constexpr std::uint8_t qoi_op_rgb{0xfeU};
constexpr std::uint8_t qoi_op_rgba{0xffU};

}  // namespace pqoi

