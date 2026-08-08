#include "pqoi/core/image.hpp"
#include "pqoi/validation.hpp"

#include <iostream>

int main(int argc, char** argv) {
    if (argc != 3) {
        std::cerr << "Usage: decode_preview <input.qoi> <output.bmp>\n";
        return 2;
    }
    try {
        pqoi::write_bmp(argv[2], pqoi::decode_qoi(argv[1]));
        return 0;
    } catch (const std::exception& error) {
        std::cerr << error.what() << '\n';
        return 1;
    }
}

