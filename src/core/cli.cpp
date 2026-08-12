#include "pqoi/cli.hpp"

#include "pqoi/encoder.hpp"
#include "pqoi/metrics.hpp"

#include <cstdlib>
#include <algorithm>
#include <iostream>
#include <string>
#include <stdexcept>


namespace {

struct CliArgs {
    std::string input;
    std::string output;
    std::string result;
    std::string preview;
    pqoi::EncodeOptions options;
    bool validate{false};
    bool preview_disabled{false};
};

void print_help(const char* executable) {
    std::cout << "Usage: " << executable << " --input <path> --output <path> [options]\n"
              << "  --result <path>          JSON result path\n"
              << "  --preview <path>         decoded BMP preview path\n"
              << "  --no-preview             validate without writing a decoded preview\n"
              << "  --blocks <count>         OpenMP/MPI image partition count\n"
              << "  --threads <count>        OpenMP worker count\n"
              << "  --segment-length <n>     CUDA pixels per image partition\n"
              << "  --validate               decode and compare output pixels\n";
}

std::string next_value(int& index, const int argc, char** argv, const char* name) {
    if (index + 1 >= argc) throw std::runtime_error(std::string("missing value for ") + name);
    return argv[++index];
}

CliArgs parse_args(const int argc, char** argv, const char* backend) {
    CliArgs args;
    args.options.backend = backend;
    args.options.blocks = backend == std::string("serial") ? 1U : 0U;
    for (int index = 1; index < argc; ++index) {
        const std::string flag = argv[index];
        if (flag == "--help" || flag == "-h") { print_help(argv[0]); std::exit(0); }
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
    if (args.options.blocks == 0U && args.options.backend != "cuda") {
        args.options.blocks = std::max<std::size_t>(1U, args.options.threads * 2U);
    }
    return args;
}

}  // namespace

namespace pqoi {

int run_cli(const int argc, char** argv, const char* default_backend) {
    try {
        const CliArgs args = parse_args(argc, argv, default_backend);
        const EncodeResult result = run_conversion(args.input, args.output, args.result, args.preview,
                                                   args.options, args.validate);
        std::cout << result_json(result);
        return result.status == "success" ? 0 : 1;
    } catch (const std::exception& error) {
        std::cerr << "pqoi: " << error.what() << '\n';
        return 2;
    }
}

}  // namespace pqoi
