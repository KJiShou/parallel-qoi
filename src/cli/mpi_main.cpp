#include "pqoi/encoder.hpp"
#include "pqoi/metrics.hpp"

#include <mpi.h>

#include <cstdlib>
#include <iostream>
#include <stdexcept>
#include <string>

namespace {

struct MpiCliArgs {
    std::string input;
    std::string output;
    std::string result;
    std::string preview;
    pqoi::EncodeOptions options{"mpi", 0U, 1U, 1024U};
    bool validate{false};
    bool preview_disabled{false};
};

struct HelpRequested {};

std::string next_value(int& index, const int argc, char** argv, const char* name) {
    if (index + 1 >= argc) throw std::runtime_error(std::string("missing value for ") + name);
    return argv[++index];
}

MpiCliArgs parse_args(const int argc, char** argv, const int world_size, const int rank) {
    MpiCliArgs args;
    args.options.threads = static_cast<std::size_t>(world_size);
    for (int index = 1; index < argc; ++index) {
        const std::string flag = argv[index];
        if (flag == "--help" || flag == "-h") {
            if (rank == 0) std::cout << "Usage: pqoi_mpi --input <path> --output <path> [--result <path>] [--preview <path> | --no-preview] [--blocks <image-partitions>] [--validate]\n";
            throw HelpRequested{};
        }
        if (flag == "--input") args.input = next_value(index, argc, argv, "--input");
        else if (flag == "--output") args.output = next_value(index, argc, argv, "--output");
        else if (flag == "--result") args.result = next_value(index, argc, argv, "--result");
        else if (flag == "--preview") args.preview = next_value(index, argc, argv, "--preview");
        else if (flag == "--no-preview") args.preview_disabled = true;
        else if (flag == "--blocks") args.options.blocks = std::stoull(next_value(index, argc, argv, "--blocks"));
        else if (flag == "--threads") args.options.threads = std::stoull(next_value(index, argc, argv, "--threads"));
        else if (flag == "--segment-length") args.options.segment_length = std::stoull(next_value(index, argc, argv, "--segment-length"));
        else if (flag == "--validate") args.validate = true;
        else throw std::runtime_error("unknown option: " + flag);
    }
    if (args.input.empty() || args.output.empty()) throw std::runtime_error("--input and --output are required");
    if (args.result.empty()) args.result = args.output + ".json";
    if (args.preview.empty() && !args.preview_disabled) args.preview = args.output + ".bmp";
    return args;
}

}  // namespace

int main(int argc, char** argv) {
    MPI_Init(&argc, &argv);
    int rank = 0;
    int world_size = 1;
    MPI_Comm_rank(MPI_COMM_WORLD, &rank);
    MPI_Comm_size(MPI_COMM_WORLD, &world_size);
    try {
        if (argc == 2 && std::string(argv[1]) == "--server") {
            const int exit_code = pqoi::run_mpi_server();
            MPI_Finalize();
            return exit_code;
        }
        const MpiCliArgs args = parse_args(argc, argv, world_size, rank);
        const pqoi::EncodeResult result = pqoi::run_mpi_conversion(
            args.input, args.output, args.result, args.preview, args.options, args.validate);
        if (rank == 0) std::cout << pqoi::result_json(result);
        const int exit_code = result.status == "success" ? 0 : 1;
        MPI_Finalize();
        return exit_code;
    } catch (const HelpRequested&) {
        MPI_Finalize();
        return 0;
    } catch (const std::exception& error) {
        if (rank == 0) std::cerr << "pqoi_mpi: " << error.what() << '\n';
        MPI_Finalize();
        return 2;
    }
}
