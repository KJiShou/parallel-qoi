#pragma once

#include "pqoi/core/encode_result.hpp"

#include <string>

namespace pqoi {

std::string result_json(const EncodeResult& result);
void write_result_json(const std::string& path, const EncodeResult& result);

}  // namespace pqoi

