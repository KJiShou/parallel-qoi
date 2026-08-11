#include "pqoi/core/image.hpp"
#include "pqoi/validation.hpp"

#include <iostream>

int main(int argc, char** argv) {
    if (argc != 3 && argc != 4) {
        std::cerr << "Usage: decode_preview <input.qoi> <output.bmp> [expected-image]\n";
        return 2;
    }
    try {
        const pqoi::Image decoded = pqoi::decode_qoi(argv[1]);
        pqoi::write_bmp(argv[2], decoded);
        if (argc == 4) {
            const pqoi::Image expected = pqoi::load_image(argv[3]);
            std::size_t mismatches = 0U;
            for (std::size_t index = 0U; index < expected.pixels.size() && index < decoded.pixels.size(); ++index) {
                if (!(expected.pixels[index] == decoded.pixels[index])) {
                    if (mismatches < 8U) {
                        const auto left = expected.pixels[index];
                        const auto right = decoded.pixels[index];
                        std::cerr << "mismatch " << index << ": expected ("
                                  << static_cast<int>(left.r) << ',' << static_cast<int>(left.g) << ','
                                  << static_cast<int>(left.b) << ',' << static_cast<int>(left.a) << ") actual ("
                                  << static_cast<int>(right.r) << ',' << static_cast<int>(right.g) << ','
                                  << static_cast<int>(right.b) << ',' << static_cast<int>(right.a) << ")\n";
                    }
                    ++mismatches;
                }
            }
            std::cerr << "dimensions " << decoded.width << 'x' << decoded.height
                      << ", channels " << static_cast<int>(decoded.channels)
                      << ", mismatched pixels " << mismatches << '\n';
            if (mismatches != 0U) return 1;
        }
        return 0;
    } catch (const std::exception& error) {
        std::cerr << error.what() << '\n';
        return 1;
    }
}
