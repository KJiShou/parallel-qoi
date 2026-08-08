#include "pqoi/encoder.hpp"

#include "pqoi/metrics.hpp"
#include "pqoi/validation.hpp"
#include "pqoi/core/qoi_encode.hpp"

#include <mpi.h>

#include <algorithm>
#include <chrono>
#include <cstdint>
#include <fstream>
#include <limits>
#include <stdexcept>
#include <string>
#include <vector>

namespace {

constexpr int state_bytes = 4 + 64 * 4;

void write_bytes(const std::string& path, const std::vector<std::uint8_t>& bytes) {
    std::ofstream output(path, std::ios::binary);
    if (!output) throw std::runtime_error("cannot open output: " + path);
    output.write(reinterpret_cast<const char*>(bytes.data()), static_cast<std::streamsize>(bytes.size()));
    if (!output) throw std::runtime_error("cannot write output: " + path);
}

void pack_pixel(const pqoi::Pixel pixel, unsigned char* destination) {
    destination[0] = pixel.r; destination[1] = pixel.g; destination[2] = pixel.b; destination[3] = pixel.a;
}

pqoi::Pixel unpack_pixel(const unsigned char* source) {
    return pqoi::Pixel{source[0], source[1], source[2], source[3]};
}

void pack_state(const pqoi::QoiState& state, unsigned char* destination) {
    pack_pixel(state.previous, destination);
    for (std::size_t index = 0U; index < 64U; ++index) pack_pixel(state.index[index], destination + 4U + index * 4U);
}

pqoi::QoiState unpack_state(const unsigned char* source) {
    pqoi::QoiState state;
    state.previous = unpack_pixel(source);
    for (std::size_t index = 0U; index < 64U; ++index) state.index[index] = unpack_pixel(source + 4U + index * 4U);
    return state;
}

int checked_count(const std::size_t value, const char* what) {
    if (value > static_cast<std::size_t>(std::numeric_limits<int>::max())) throw std::runtime_error(std::string(what) + " is too large for MPI");
    return static_cast<int>(value);
}

}  // namespace

namespace pqoi {

EncodeResult run_mpi_conversion(const std::string& input_path,
                                const std::string& output_path,
                                const std::string& result_path,
                                const std::string& preview_path,
                                const EncodeOptions& options,
                                const bool validate) {
    int rank = 0;
    int world = 1;
    MPI_Comm_rank(MPI_COMM_WORLD, &rank);
    MPI_Comm_size(MPI_COMM_WORLD, &world);

    EncodeResult result;
    result.backend = "mpi";
    result.input_path = input_path;
    result.output_path = output_path;
    result.preview_path = preview_path;
    result.result_path = result_path;
    result.blocks = static_cast<std::size_t>(world);
    result.threads = static_cast<std::size_t>(world);
    result.segment_length = options.segment_length;
    const double total_start = MPI_Wtime();

    Image image;
    int load_ok = 1;
    std::string load_error;
    if (rank == 0) {
        try { image = load_image(input_path); }
        catch (const std::exception& error) { load_ok = 0; load_error = error.what(); }
    }
    MPI_Bcast(&load_ok, 1, MPI_INT, 0, MPI_COMM_WORLD);
    if (!load_ok) {
        result.status = "error";
        result.error = rank == 0 ? load_error : "rank 0 could not load input image";
        if (rank == 0 && !result_path.empty()) write_result_json(result_path, result);
        return result;
    }

    unsigned long long pixel_count = rank == 0 ? static_cast<unsigned long long>(image.pixels.size()) : 0ULL;
    unsigned int dimensions[3] = {rank == 0 ? image.width : 0U, rank == 0 ? image.height : 0U, rank == 0 ? image.channels : 0U};
    MPI_Bcast(&pixel_count, 1, MPI_UNSIGNED_LONG_LONG, 0, MPI_COMM_WORLD);
    MPI_Bcast(dimensions, 3, MPI_UNSIGNED, 0, MPI_COMM_WORLD);
    if (rank != 0) {
        image.width = dimensions[0]; image.height = dimensions[1]; image.channels = static_cast<std::uint8_t>(dimensions[2]);
        image.pixels.resize(static_cast<std::size_t>(pixel_count));
    }

    const double preparation_start = MPI_Wtime();
    const std::vector<Block> blocks = partition_blocks(static_cast<std::size_t>(pixel_count), static_cast<std::size_t>(world));
    std::vector<QoiState> entries;
    if (rank == 0) {
        const double summary_start = MPI_Wtime();
        std::vector<BlockSummary> summaries;
        summaries.reserve(blocks.size());
        for (const Block block : blocks) summaries.push_back(summarize_block(image.pixels, block));
        result.summary_ms = (MPI_Wtime() - summary_start) * 1000.0;
        const double propagation_start = MPI_Wtime();
        entries = propagate_states(summaries);
        result.propagation_ms = (MPI_Wtime() - propagation_start) * 1000.0;
        result.width = image.width; result.height = image.height; result.channels = image.channels;
        result.load_ms = (preparation_start - total_start) * 1000.0;
    }

    std::vector<int> pixel_counts(world);
    std::vector<int> pixel_displacements(world);
    for (int index = 0; index < world; ++index) {
        pixel_counts[index] = checked_count((blocks[static_cast<std::size_t>(index)].end - blocks[static_cast<std::size_t>(index)].begin) * 4U, "MPI pixel block");
        pixel_displacements[index] = index == 0 ? 0 : pixel_displacements[index - 1] + pixel_counts[index - 1];
    }
    std::vector<unsigned char> packed_pixels;
    if (rank == 0) {
        packed_pixels.resize(image.pixels.size() * 4U);
        for (std::size_t index = 0U; index < image.pixels.size(); ++index) pack_pixel(image.pixels[index], packed_pixels.data() + index * 4U);
    }
    std::vector<unsigned char> local_packed(static_cast<std::size_t>(pixel_counts[rank]));
    const double scatter_start = MPI_Wtime();
    MPI_Scatterv(rank == 0 ? packed_pixels.data() : nullptr, pixel_counts.data(), pixel_displacements.data(), MPI_UNSIGNED_CHAR,
                 local_packed.data(), pixel_counts[rank], MPI_UNSIGNED_CHAR, 0, MPI_COMM_WORLD);

    std::vector<unsigned char> packed_states;
    if (rank == 0) {
        packed_states.resize(static_cast<std::size_t>(world) * state_bytes);
        for (int index = 0; index < world; ++index) pack_state(entries[static_cast<std::size_t>(index)], packed_states.data() + static_cast<std::size_t>(index) * state_bytes);
    }
    std::vector<unsigned char> local_state(state_bytes);
    MPI_Scatter(rank == 0 ? packed_states.data() : nullptr, state_bytes, MPI_UNSIGNED_CHAR,
                local_state.data(), state_bytes, MPI_UNSIGNED_CHAR, 0, MPI_COMM_WORLD);
    MPI_Barrier(MPI_COMM_WORLD);
    double scatter_elapsed = (MPI_Wtime() - scatter_start) * 1000.0;
    MPI_Reduce(&scatter_elapsed, &result.transfer_in_ms, 1, MPI_DOUBLE, MPI_MAX, 0, MPI_COMM_WORLD);

    std::vector<Pixel> local_pixels(static_cast<std::size_t>(pixel_counts[rank] / 4));
    for (std::size_t index = 0U; index < local_pixels.size(); ++index) local_pixels[index] = unpack_pixel(local_packed.data() + index * 4U);
    const double local_encode_start = MPI_Wtime();
    std::vector<std::uint8_t> local_bytes;
    encode_qoi_block(local_pixels, Block{0U, local_pixels.size()}, unpack_state(local_state.data()), local_bytes);
    const double local_encode_ms = (MPI_Wtime() - local_encode_start) * 1000.0;
    MPI_Reduce(&local_encode_ms, &result.encode_ms, 1, MPI_DOUBLE, MPI_MAX, 0, MPI_COMM_WORLD);

    const int local_size = checked_count(local_bytes.size(), "MPI encoded block");
    std::vector<int> encoded_counts(world);
    std::vector<int> encoded_displacements(world);
    MPI_Gather(&local_size, 1, MPI_INT, encoded_counts.data(), 1, MPI_INT, 0, MPI_COMM_WORLD);
    int encoded_total = 0;
    if (rank == 0) {
        for (int index = 0; index < world; ++index) {
            encoded_displacements[index] = encoded_total;
            encoded_total += encoded_counts[index];
        }
    }
    std::vector<unsigned char> gathered(static_cast<std::size_t>(std::max(0, encoded_total)));
    const double gather_start = MPI_Wtime();
    MPI_Gatherv(local_bytes.data(), local_size, MPI_UNSIGNED_CHAR,
                rank == 0 ? gathered.data() : nullptr, encoded_counts.data(), encoded_displacements.data(), MPI_UNSIGNED_CHAR,
                0, MPI_COMM_WORLD);
    MPI_Barrier(MPI_COMM_WORLD);
    double gather_elapsed = (MPI_Wtime() - gather_start) * 1000.0;
    MPI_Reduce(&gather_elapsed, &result.transfer_out_ms, 1, MPI_DOUBLE, MPI_MAX, 0, MPI_COMM_WORLD);

    if (rank == 0) {
        const double merge_start = MPI_Wtime();
        std::vector<std::vector<std::uint8_t>> block_bytes(static_cast<std::size_t>(world));
        for (int index = 0; index < world; ++index) {
            block_bytes[static_cast<std::size_t>(index)].assign(
                gathered.begin() + encoded_displacements[index],
                gathered.begin() + encoded_displacements[index] + encoded_counts[index]);
        }
        const std::vector<std::uint8_t> encoded = assemble_qoi(image, block_bytes);
        result.merge_ms = (MPI_Wtime() - merge_start) * 1000.0;
        result.output_bytes = encoded.size();
        result.compression_ratio = encoded.empty() ? 0.0 : static_cast<double>(image.pixels.size() * image.channels) / encoded.size();
        result.throughput_mpixels = result.encode_ms <= 0.0 ? 0.0 : static_cast<double>(image.pixels.size()) / (result.encode_ms * 1000.0);
        write_bytes(output_path, encoded);
        if (validate) {
            const double validation_start = MPI_Wtime();
            result.validation_passed = validate_qoi(output_path, image);
            result.pixel_match = result.validation_passed;
            result.sha256_match = sha256_match_qoi(output_path, image);
            if (result.validation_passed && !preview_path.empty()) write_bmp(preview_path, decode_qoi(output_path));
            result.validation_ms = (MPI_Wtime() - validation_start) * 1000.0;
        }
        result.status = result.validation_passed || !validate ? "success" : "validation_failed";
        result.total_ms = (MPI_Wtime() - total_start) * 1000.0;
        if (!result_path.empty()) write_result_json(result_path, result);
    }
    int status_code = rank == 0 && result.status == "success" ? 0 : (rank == 0 ? 1 : 0);
    MPI_Bcast(&status_code, 1, MPI_INT, 0, MPI_COMM_WORLD);
    if (rank != 0) result.status = status_code == 0 ? "success" : "validation_failed";
    return result;
}

}  // namespace pqoi
