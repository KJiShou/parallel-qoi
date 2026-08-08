#pragma once

#include "pqoi/core/image.hpp"

#include <string>

namespace pqoi {

bool validate_qoi(const std::string& qoi_path, const Image& expected);
bool sha256_match_qoi(const std::string& qoi_path, const Image& expected);
Image decode_qoi(const std::string& qoi_path);

}  // namespace pqoi
