#include "pqoi/encoder.hpp"

#include "pqoi/metrics.hpp"
#include "pqoi/validation.hpp"
#include "pqoi/core/qoi_encode.hpp"

#include <mpi.h>

#include <array>
#include <algorithm>
#include <cstdint>
#include <fstream>
#include <limits>
#include <stdexcept>
#include <string>
#include <type_traits>
#include <vector>

namespace {

constexpr int colour_index_entries = 64;
constexpr int packed_pixel_bytes = 4;
constexpr int state_bytes = packed_pixel_bytes + colour_index_entries * packed_pixel_bytes;
constexpr int summary_bytes = state_bytes + colour_index_entries;

void write_bytes(const std::string& path, const std::vector<std::uint8_t>& bytes) {
    std::ofstream output(path, std::ios::binary);
    if (!output) throw std::runtime_error("cannot open output: " + path);
    output.write(reinterpret_cast<const char*>(bytes.data()), static_cast<std::streamsize>(bytes.size()));
    if (!output) throw std::runtime_error("cannot write output: " + path);
}

void pack_pixel(const pqoi::Pixel pixel, unsigned char* destination) {
    destination[0] = pixel.r;
    destination[1] = pixel.g;
    destination[2] = pixel.b;
    destination[3] = pixel.a;
}

pqoi::Pixel unpack_pixel(const unsigned char* source) {
    return pqoi::Pixel{source[0], source[1], source[2], source[3]};
}

void pack_state(const pqoi::QoiState& state, unsigned char* destination) {
    pack_pixel(state.previous, destination);
    for (std::size_t index = 0U; index < state.index.size(); ++index) {
        pack_pixel(state.index[index], destination + packed_pixel_bytes + index * packed_pixel_bytes);
    }
}

pqoi::QoiState unpack_state(const unsigned char* source) {
    pqoi::QoiState state;
    state.previous = unpack_pixel(source);
    for (std::size_t index = 0U; index < state.index.size(); ++index) {
        state.index[index] = unpack_pixel(source + packed_pixel_bytes + index * packed_pixel_bytes);
    }
    return state;
}

void pack_summary(const pqoi::BlockSummary& summary, unsigned char* destination) {
    pack_pixel(summary.last_pixel, destination);
    for (std::size_t index = 0U; index < summary.last_pixel_for_slot.size(); ++index) {
        pack_pixel(summary.last_pixel_for_slot[index],
                   destination + packed_pixel_bytes + index * packed_pixel_bytes);
        destination[state_bytes + index] = summary.touched[index] ? 1U : 0U;
    }
}

pqoi::BlockSummary unpack_summary(const unsigned char* source) {
    pqoi::BlockSummary summary;
    summary.last_pixel = unpack_pixel(source);
    for (std::size_t index = 0U; index < summary.last_pixel_for_slot.size(); ++index) {
        summary.last_pixel_for_slot[index] = unpack_pixel(
            source + packed_pixel_bytes + index * packed_pixel_bytes);
        summary.touched[index] = source[state_bytes + index] != 0U;
    }
    return summary;
}

int checked_count(const std::size_t value, const char* what) {
    if (value > static_cast<std::size_t>(std::numeric_limits<int>::max())) {
        throw std::runtime_error(std::string(what) + " is too large for MPI");
    }
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
    const std::size_t requested_blocks = std::max<std::size_t>(
        static_cast<std::size_t>(world), options.blocks == 0U ? static_cast<std::size_t>(world) : options.blocks);
    result.blocks = requested_blocks;
    result.threads = static_cast<std::size_t>(world);
    result.segment_length = options.segment_length;
    result.cuda_threads_per_block = options.cuda_threads_per_block;
    const double total_start = MPI_Wtime();

    Image image;
    int load_ok = 1;
    std::string load_error;
    if (rank == 0) {
        try {
            image = load_image(input_path);
        } catch (const std::exception& error) {
            load_ok = 0;
            load_error = error.what();
        }
    }
    MPI_Bcast(&load_ok, 1, MPI_INT, 0, MPI_COMM_WORLD);
    if (!load_ok) {
        result.status = "error";
        result.error = rank == 0 ? load_error : "rank 0 could not load input image";
        if (rank == 0 && !result_path.empty()) write_result_json(result_path, result);
        return result;
    }

    // Excludes file loading and includes metadata, communication, encoding,
    // the final gather, and contiguous QOI assembly.
    const double pipeline_start = MPI_Wtime();
    unsigned long long pixel_count = rank == 0 ? static_cast<unsigned long long>(image.pixels.size()) : 0ULL;
    unsigned int dimensions[3] = {
        rank == 0 ? image.width : 0U,
        rank == 0 ? image.height : 0U,
        rank == 0 ? image.channels : 0U};
    MPI_Bcast(&pixel_count, 1, MPI_UNSIGNED_LONG_LONG, 0, MPI_COMM_WORLD);
    MPI_Bcast(dimensions, 3, MPI_UNSIGNED, 0, MPI_COMM_WORLD);
    if (rank != 0) {
        image.width = dimensions[0];
        image.height = dimensions[1];
        image.channels = static_cast<std::uint8_t>(dimensions[2]);
    }

    const double preparation_start = MPI_Wtime();
    const std::vector<Block> blocks = partition_blocks(static_cast<std::size_t>(pixel_count), requested_blocks);
    const std::size_t actual_blocks = blocks.size();
    result.blocks = actual_blocks;

    std::vector<std::size_t> rank_block_begin(static_cast<std::size_t>(world));
    std::vector<std::size_t> rank_block_end(static_cast<std::size_t>(world));
    for (int index = 0; index < world; ++index) {
        rank_block_begin[static_cast<std::size_t>(index)] =
            actual_blocks * static_cast<std::size_t>(index) / static_cast<std::size_t>(world);
        rank_block_end[static_cast<std::size_t>(index)] =
            actual_blocks * static_cast<std::size_t>(index + 1) / static_cast<std::size_t>(world);
    }

    std::vector<int> pixel_counts(world);
    std::vector<int> pixel_displacements(world);
    for (int index = 0; index < world; ++index) {
        const std::size_t first_block = rank_block_begin[static_cast<std::size_t>(index)];
        const std::size_t final_block = rank_block_end[static_cast<std::size_t>(index)];
        const std::size_t pixel_begin = first_block < actual_blocks
            ? blocks[first_block].begin
            : static_cast<std::size_t>(pixel_count);
        const std::size_t pixel_end = final_block > first_block
            ? blocks[final_block - 1U].end
            : pixel_begin;
        pixel_counts[index] = checked_count(pixel_end - pixel_begin, "MPI pixel block group");
        pixel_displacements[index] = checked_count(pixel_begin, "MPI pixel displacement");
    }

    static_assert(sizeof(Pixel) == packed_pixel_bytes);
    static_assert(std::is_trivially_copyable_v<Pixel>);
    const std::size_t local_pixel_count = static_cast<std::size_t>(pixel_counts[rank]);
    std::vector<Pixel> local_pixels(local_pixel_count);
    MPI_Datatype mpi_pixel = MPI_DATATYPE_NULL;
    MPI_Type_contiguous(packed_pixel_bytes, MPI_UNSIGNED_CHAR, &mpi_pixel);
    MPI_Type_commit(&mpi_pixel);
    const double pixel_scatter_start = MPI_Wtime();
    MPI_Scatterv(rank == 0 ? image.pixels.data() : nullptr,
                 pixel_counts.data(), pixel_displacements.data(), mpi_pixel,
                 local_pixels.data(), pixel_counts[rank], mpi_pixel,
                 0, MPI_COMM_WORLD);
    const double pixel_scatter_elapsed = (MPI_Wtime() - pixel_scatter_start) * 1000.0;
    MPI_Type_free(&mpi_pixel);

    const std::size_t local_block_begin = rank_block_begin[static_cast<std::size_t>(rank)];
    const std::size_t local_block_end = rank_block_end[static_cast<std::size_t>(rank)];
    const std::size_t global_pixel_begin = local_block_begin < actual_blocks
        ? blocks[local_block_begin].begin
        : static_cast<std::size_t>(pixel_count);

    const double local_summary_start = MPI_Wtime();
    std::vector<BlockSummary> local_summaries;
    local_summaries.reserve(local_block_end - local_block_begin);
    for (std::size_t block_index = local_block_begin; block_index < local_block_end; ++block_index) {
        const Block global_block = blocks[block_index];
        const Block local_block{global_block.begin - global_pixel_begin, global_block.end - global_pixel_begin};
        local_summaries.push_back(summarize_block(local_pixels, local_block));
    }
    const BlockSummary rank_summary = combine_block_summaries(local_summaries);
    const double local_summary_elapsed = (MPI_Wtime() - local_summary_start) * 1000.0;

    std::vector<unsigned char> local_summary_bytes(summary_bytes);
    pack_summary(rank_summary, local_summary_bytes.data());
    std::vector<unsigned char> gathered_summaries(
        rank == 0 ? static_cast<std::size_t>(world) * summary_bytes : 0U);
    const double summary_gather_start = MPI_Wtime();
    MPI_Gather(local_summary_bytes.data(), summary_bytes, MPI_UNSIGNED_CHAR,
               rank == 0 ? gathered_summaries.data() : nullptr, summary_bytes, MPI_UNSIGNED_CHAR,
               0, MPI_COMM_WORLD);
    const double summary_gather_elapsed = (MPI_Wtime() - summary_gather_start) * 1000.0;

    std::vector<unsigned char> packed_states(
        rank == 0 ? static_cast<std::size_t>(world) * state_bytes : 0U);
    if (rank == 0) {
        std::vector<BlockSummary> rank_summaries(static_cast<std::size_t>(world));
        for (int index = 0; index < world; ++index) {
            rank_summaries[static_cast<std::size_t>(index)] = unpack_summary(
                gathered_summaries.data() + static_cast<std::size_t>(index) * summary_bytes);
        }

        const double rank_propagation_start = MPI_Wtime();
        QoiState state;
        for (int index = 0; index < world; ++index) {
            const std::size_t rank_index = static_cast<std::size_t>(index);
            if (rank_block_begin[rank_index] < rank_block_end[rank_index]) {
                pack_state(state, packed_states.data() + rank_index * state_bytes);
                state = apply_block_summary(state, rank_summaries[rank_index]);
            } else {
                // An empty rank is an identity in the global sequence.
                pack_state(QoiState{}, packed_states.data() + rank_index * state_bytes);
            }
        }
        result.propagation_ms = (MPI_Wtime() - rank_propagation_start) * 1000.0;
        result.width = image.width;
        result.height = image.height;
        result.channels = image.channels;
        result.load_ms = (preparation_start - total_start) * 1000.0;
    }

    std::vector<unsigned char> local_state_bytes(state_bytes);
    const double state_scatter_start = MPI_Wtime();
    MPI_Scatter(rank == 0 ? packed_states.data() : nullptr, state_bytes, MPI_UNSIGNED_CHAR,
                local_state_bytes.data(), state_bytes, MPI_UNSIGNED_CHAR, 0, MPI_COMM_WORLD);
    const double state_scatter_elapsed = (MPI_Wtime() - state_scatter_start) * 1000.0;

    const double local_propagation_start = MPI_Wtime();
    const std::vector<QoiState> local_entries = propagate_states_from(
        unpack_state(local_state_bytes.data()), local_summaries);
    const double local_propagation_elapsed = (MPI_Wtime() - local_propagation_start) * 1000.0;

    const double local_encode_start = MPI_Wtime();
    std::vector<std::uint8_t> local_bytes;
    for (std::size_t block_index = local_block_begin; block_index < local_block_end; ++block_index) {
        const Block global_block = blocks[block_index];
        const Block local_block{global_block.begin - global_pixel_begin, global_block.end - global_pixel_begin};
        encode_qoi_block(local_pixels, local_block,
                         local_entries[block_index - local_block_begin], local_bytes);
    }
    const double local_encode_elapsed = (MPI_Wtime() - local_encode_start) * 1000.0;

    const int local_size = checked_count(local_bytes.size(), "MPI encoded block");
    std::vector<int> encoded_counts(world);
    std::vector<int> encoded_displacements(world, 0);
    MPI_Gather(&local_size, 1, MPI_INT, encoded_counts.data(), 1, MPI_INT, 0, MPI_COMM_WORLD);
    int encoded_total = 0;
    if (rank == 0) {
        for (int index = 0; index < world; ++index) {
            encoded_displacements[index] = encoded_total;
            encoded_total = checked_count(
                static_cast<std::size_t>(encoded_total) + static_cast<std::size_t>(encoded_counts[index]),
                "MPI encoded output");
        }
    }
    std::vector<unsigned char> gathered(
        rank == 0 ? static_cast<std::size_t>(encoded_total) : 0U);
    const double gather_start = MPI_Wtime();
    MPI_Gatherv(local_bytes.data(), local_size, MPI_UNSIGNED_CHAR,
                rank == 0 ? gathered.data() : nullptr,
                encoded_counts.data(), encoded_displacements.data(), MPI_UNSIGNED_CHAR,
                0, MPI_COMM_WORLD);
    const double gather_elapsed = (MPI_Wtime() - gather_start) * 1000.0;

    // One batched reduction replaces a Reduce after every collective. The
    // rank-0 propagation value occupies its own slot because it happens
    // before the local propagation stage.
    std::array<double, 8> local_timings{
        local_summary_elapsed,
        summary_gather_elapsed,
        rank == 0 ? result.propagation_ms : 0.0,
        local_propagation_elapsed,
        pixel_scatter_elapsed,
        state_scatter_elapsed,
        local_encode_elapsed,
        gather_elapsed};
    std::array<double, 8> max_timings{};
    MPI_Reduce(local_timings.data(), max_timings.data(), static_cast<int>(local_timings.size()),
               MPI_DOUBLE, MPI_MAX, 0, MPI_COMM_WORLD);

    if (rank == 0) {
        result.summary_ms = max_timings[0] + max_timings[1];
        result.propagation_ms = max_timings[2] + max_timings[3];
        result.transfer_in_ms = max_timings[4] + max_timings[5];
        result.encode_ms = max_timings[6];
        result.transfer_out_ms = max_timings[7];

        const double merge_start = MPI_Wtime();
        const std::vector<std::uint8_t> encoded = assemble_qoi(image, gathered);
        result.merge_ms = (MPI_Wtime() - merge_start) * 1000.0;
        result.core_pipeline_ms = (MPI_Wtime() - pipeline_start) * 1000.0;
        result.output_bytes = encoded.size();
        result.compression_ratio = encoded.empty() ? 0.0 : static_cast<double>(image.pixels.size() * image.channels) / encoded.size();
        result.throughput_mpixels = result.encode_ms <= 0.0
            ? 0.0
            : static_cast<double>(image.pixels.size()) / (result.encode_ms * 1000.0);
        result.core_pipeline_throughput_mpixels = result.core_pipeline_ms <= 0.0
            ? 0.0
            : static_cast<double>(image.pixels.size()) / (result.core_pipeline_ms * 1000.0);
        const double write_start = MPI_Wtime();
        write_bytes(output_path, encoded);
        result.write_ms = (MPI_Wtime() - write_start) * 1000.0;
        if (validate) {
            const double validation_start = MPI_Wtime();
            const ValidationDetails details = validate_qoi_detailed(output_path, image);
            result.decoder_accepted = details.decoder_accepted;
            result.dimensions_match = details.dimensions_match;
            result.channels_match = details.channels_match;
            result.pixel_match = details.pixel_match;
            result.sha256_match = details.sha256_match;
            result.validation_passed = details.passed();
            if (result.validation_passed && !preview_path.empty()) write_bmp(preview_path, decode_qoi(output_path));
            result.validation_ms = (MPI_Wtime() - validation_start) * 1000.0;
        }
        result.status = result.validation_passed || !validate ? "success" : "validation_failed";
        result.total_ms = (MPI_Wtime() - total_start) * 1000.0;
        const double analysis_start = MPI_Wtime();
        populate_chunk_distribution(encoded, result);
        analyze_cross_block_benefit(image, result.blocks, result);
        result.metrics_analysis_ms = (MPI_Wtime() - analysis_start) * 1000.0;
        if (!result_path.empty()) write_result_json(result_path, result);
    }

    int status_code = rank == 0 && result.status == "success" ? 0 : (rank == 0 ? 1 : 0);
    MPI_Bcast(&status_code, 1, MPI_INT, 0, MPI_COMM_WORLD);
    if (rank != 0) result.status = status_code == 0 ? "success" : "validation_failed";
    return result;
}

}  // namespace pqoi
