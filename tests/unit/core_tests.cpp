#include "pqoi/encoder.hpp"
#include "pqoi/metrics.hpp"
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

    pqoi::EncodeResult control_metrics;
    const auto control_bytes = pqoi::encode_qoi(
        image, pqoi::EncodeOptions{"one-pass", 7U, 1U, 128U}, &control_metrics);
    pqoi::populate_chunk_distribution(control_bytes, control_metrics);
    {
        std::ofstream output("pqoi_control_test.qoi", std::ios::binary);
        output.write(reinterpret_cast<const char*>(control_bytes.data()), static_cast<std::streamsize>(control_bytes.size()));
    }
    assert(pqoi::validate_qoi("pqoi_control_test.qoi", image));
    assert(control_metrics.rgba_chunks >= 7U);
    std::remove("pqoi_control_test.qoi");

    pqoi::Image rgb_image = image;
    rgb_image.channels = 3U;
    for (pqoi::Pixel& pixel : rgb_image.pixels) pixel.a = 255U;
    const auto rgb_bytes = pqoi::encode_qoi(rgb_image, pqoi::EncodeOptions{"serial", 4U, 1U, 64U});
    {
        std::ofstream output("pqoi_rgb_test.qoi", std::ios::binary);
        output.write(reinterpret_cast<const char*>(rgb_bytes.data()), static_cast<std::streamsize>(rgb_bytes.size()));
    }
    assert(pqoi::validate_qoi("pqoi_rgb_test.qoi", rgb_image));
    std::remove("pqoi_rgb_test.qoi");

    pqoi::Image black_image;
    black_image.width = 3U;
    black_image.height = 1U;
    black_image.channels = 4U;
    black_image.pixels = {
        pqoi::Pixel{0U, 0U, 0U, 255U},
        pqoi::Pixel{0U, 0U, 0U, 0U},
        pqoi::Pixel{0U, 0U, 0U, 255U},
    };
    const auto black_bytes = pqoi::encode_qoi(black_image, pqoi::EncodeOptions{"serial", 1U, 1U, 64U});
    {
        std::ofstream output("pqoi_black_alpha_test.qoi", std::ios::binary);
        output.write(reinterpret_cast<const char*>(black_bytes.data()), static_cast<std::streamsize>(black_bytes.size()));
    }
    assert(pqoi::validate_qoi("pqoi_black_alpha_test.qoi", black_image));
    std::remove("pqoi_black_alpha_test.qoi");

    return 0;
}
