#include "pqoi/encoder.hpp"
#include "pqoi/validation.hpp"

#include <cassert>
#include <cstdio>
#include <fstream>

int main() {
    pqoi::Image image;
    image.width = 17U;
    image.height = 9U;
    image.channels = 4U;
    image.pixels.reserve(image.width * image.height);
    for (std::size_t index = 0U; index < image.width * image.height; ++index) {
        image.pixels.push_back(pqoi::Pixel{
            static_cast<std::uint8_t>(index * 3U),
            static_cast<std::uint8_t>(index * 5U),
            static_cast<std::uint8_t>(index * 7U),
            static_cast<std::uint8_t>(index % 3U == 0U ? 255U : 200U)});
    }
    const pqoi::EncodeOptions options{"serial", 7U, 1U, 128U};
    const auto bytes = pqoi::encode_qoi(image, options);
    const std::string path = "pqoi_core_test.qoi";
    {
        std::ofstream output(path, std::ios::binary);
        output.write(reinterpret_cast<const char*>(bytes.data()), static_cast<std::streamsize>(bytes.size()));
    }
    assert(pqoi::validate_qoi(path, image));
    std::remove(path.c_str());

    pqoi::Image run_image;
    run_image.width = 128U;
    run_image.height = 1U;
    run_image.channels = 4U;
    run_image.pixels.assign(128U, pqoi::Pixel{12U, 34U, 56U, 255U});
    const auto run_bytes = pqoi::encode_qoi(run_image, pqoi::EncodeOptions{"serial", 5U, 1U, 64U});
    {
        std::ofstream output("pqoi_run_test.qoi", std::ios::binary);
        output.write(reinterpret_cast<const char*>(run_bytes.data()), static_cast<std::streamsize>(run_bytes.size()));
    }
    assert(pqoi::validate_qoi("pqoi_run_test.qoi", run_image));
    std::remove("pqoi_run_test.qoi");

    return 0;
}
