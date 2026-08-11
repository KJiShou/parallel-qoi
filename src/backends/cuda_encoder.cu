#include "pqoi/encoder.hpp"

#include "pqoi/core/qoi_chunks.hpp"
#include "pqoi/core/qoi_encode.hpp"

#include <cuda_runtime.h>

#include <algorithm>
#include <chrono>
#include <cstdint>
#include <cstring>
#include <stdexcept>
#include <string>
#include <vector>

namespace {

struct DevicePixel {
    unsigned char r;
    unsigned char g;
    unsigned char b;
    unsigned char a;
};

struct DeviceState {
    DevicePixel previous;
    DevicePixel index[64];
};

struct DeviceBlock {
    std::uint64_t begin;
    std::uint64_t end;
};

__device__ std::size_t pixel_hash(const DevicePixel pixel) {
    return (static_cast<std::size_t>(pixel.r) * 3U +
            static_cast<std::size_t>(pixel.g) * 5U +
            static_cast<std::size_t>(pixel.b) * 7U +
            static_cast<std::size_t>(pixel.a) * 11U) & 63U;
}

__device__ bool same_pixel(const DevicePixel left, const DevicePixel right) {
    return left.r == right.r && left.g == right.g && left.b == right.b && left.a == right.a;
}

__device__ void flush_run(unsigned char* output, unsigned int& cursor, unsigned int& run) {
    while (run > 0U) {
        const unsigned int chunk = run < 62U ? run : 62U;
        output[cursor++] = static_cast<unsigned char>(0xc0U | (chunk - 1U));
        run -= chunk;
    }
}

__global__ void encode_blocks_kernel(const DevicePixel* pixels,
                                     const DeviceBlock* blocks,
                                     const DeviceState* initial_states,
                                     unsigned char* output,
                                     const std::size_t stride,
                                     unsigned int* lengths,
                                     const unsigned int block_count) {
    const unsigned int block_index = blockIdx.x * blockDim.x + threadIdx.x;
    if (block_index >= block_count) return;

    DeviceState state = initial_states[block_index];
    unsigned char* destination = output + static_cast<std::size_t>(block_index) * stride;
    unsigned int cursor = 0U;
    unsigned int run = 0U;
    const DeviceBlock block = blocks[block_index];
    for (std::uint64_t position = block.begin; position < block.end; ++position) {
        const DevicePixel pixel = pixels[position];
        if (same_pixel(pixel, state.previous)) {
            ++run;
            state.index[pixel_hash(pixel)] = pixel;
            if (run == 62U || position + 1U == block.end) flush_run(destination, cursor, run);
            continue;
        }

        flush_run(destination, cursor, run);
        const std::size_t slot = pixel_hash(pixel);
        if (same_pixel(state.index[slot], pixel)) {
            destination[cursor++] = static_cast<unsigned char>(slot);
        } else {
            state.index[slot] = pixel;
            const int dr = static_cast<int>(pixel.r) - static_cast<int>(state.previous.r);
            const int dg = static_cast<int>(pixel.g) - static_cast<int>(state.previous.g);
            const int db = static_cast<int>(pixel.b) - static_cast<int>(state.previous.b);
            const int da = static_cast<int>(pixel.a) - static_cast<int>(state.previous.a);
            if (da == 0 && dr > -3 && dr < 2 && dg > -3 && dg < 2 && db > -3 && db < 2) {
                destination[cursor++] = static_cast<unsigned char>(0x40U |
                    ((dr + 2) << 4) | ((dg + 2) << 2) | (db + 2));
            } else if (da == 0) {
                const int dr_dg = dr - dg;
                const int db_dg = db - dg;
                if (dg > -33 && dg < 32 && dr_dg > -9 && dr_dg < 8 && db_dg > -9 && db_dg < 8) {
                    destination[cursor++] = static_cast<unsigned char>(0x80U | (dg + 32));
                    destination[cursor++] = static_cast<unsigned char>(((dr_dg + 8) << 4) | (db_dg + 8));
                } else {
                    destination[cursor++] = 0xfeU;
                    destination[cursor++] = pixel.r; destination[cursor++] = pixel.g; destination[cursor++] = pixel.b;
                }
            } else {
                destination[cursor++] = 0xffU;
                destination[cursor++] = pixel.r; destination[cursor++] = pixel.g;
                destination[cursor++] = pixel.b; destination[cursor++] = pixel.a;
            }
        }
        state.previous = pixel;
    }
    flush_run(destination, cursor, run);
    lengths[block_index] = cursor;
}

using clock_type = std::chrono::steady_clock;

double elapsed_ms(const clock_type::time_point start, const clock_type::time_point end) {
    return std::chrono::duration<double, std::milli>(end - start).count();
}

void check_cuda(const cudaError_t error, const char* operation) {
    if (error != cudaSuccess) throw std::runtime_error(std::string(operation) + ": " + cudaGetErrorString(error));
}

DevicePixel to_device(const pqoi::Pixel pixel) { return DevicePixel{pixel.r, pixel.g, pixel.b, pixel.a}; }

DeviceState to_device(const pqoi::QoiState& state) {
    DeviceState result{};
    result.previous = to_device(state.previous);
    for (std::size_t index = 0U; index < 64U; ++index) result.index[index] = to_device(state.index[index]);
    return result;
}

}  // namespace

namespace pqoi {

std::vector<std::uint8_t> encode_cuda_qoi(const Image& image,
                                          const EncodeOptions& options,
                                          EncodeResult* metrics) {
    const auto cuda_init_start = clock_type::now();
    int device_count = 0;
    check_cuda(cudaGetDeviceCount(&device_count), "cudaGetDeviceCount");
    if (device_count <= 0) throw std::runtime_error("CUDA-compatible NVIDIA GPU not detected");
    check_cuda(cudaSetDevice(0), "select CUDA device");
    // cudaFree(nullptr) forces lazy CUDA runtime/context initialization. Keeping
    // it in its own phase prevents first-use driver cost from looking like encode.
    check_cuda(cudaFree(nullptr), "initialize CUDA context");
    if (metrics) metrics->cuda_init_ms = elapsed_ms(cuda_init_start, clock_type::now());

    const std::size_t segment_blocks = options.segment_length == 0U
        ? 1U
        : (image.pixels.size() + options.segment_length - 1U) / options.segment_length;
    const std::size_t requested_blocks = std::max<std::size_t>(
        options.blocks == 0U ? std::max<std::size_t>(1U, options.threads * 2U) : options.blocks,
        segment_blocks);
    const auto summary_start = clock_type::now();
    const std::vector<Block> blocks = partition_blocks(image.pixels.size(), requested_blocks);
    if (metrics) metrics->blocks = blocks.size();
    std::vector<BlockSummary> summaries;
    summaries.reserve(blocks.size());
    for (const Block block : blocks) summaries.push_back(summarize_block(image.pixels, block));
    if (metrics) metrics->summary_ms = elapsed_ms(summary_start, clock_type::now());
    const auto propagation_start = clock_type::now();
    const std::vector<QoiState> states = propagate_states(summaries);
    if (metrics) metrics->propagation_ms = elapsed_ms(propagation_start, clock_type::now());

    std::vector<DevicePixel> host_pixels(image.pixels.size());
    for (std::size_t index = 0U; index < image.pixels.size(); ++index) host_pixels[index] = to_device(image.pixels[index]);
    std::vector<DeviceBlock> host_blocks(blocks.size());
    std::vector<DeviceState> host_states(states.size());
    std::size_t max_block_pixels = 0U;
    for (std::size_t index = 0U; index < blocks.size(); ++index) {
        host_blocks[index] = DeviceBlock{blocks[index].begin, blocks[index].end};
        host_states[index] = to_device(states[index]);
        max_block_pixels = std::max(max_block_pixels, blocks[index].end - blocks[index].begin);
    }
    const std::size_t stride = std::max<std::size_t>(5U * max_block_pixels + 64U, options.segment_length);
    const std::size_t output_size = stride * blocks.size();

    DevicePixel* device_pixels = nullptr;
    DeviceBlock* device_blocks = nullptr;
    DeviceState* device_states = nullptr;
    unsigned char* device_output = nullptr;
    unsigned int* device_lengths = nullptr;
    try {
        const auto allocation_start = clock_type::now();
        check_cuda(cudaMalloc(reinterpret_cast<void**>(&device_pixels), host_pixels.size() * sizeof(DevicePixel)), "cudaMalloc pixels");
        check_cuda(cudaMalloc(reinterpret_cast<void**>(&device_blocks), host_blocks.size() * sizeof(DeviceBlock)), "cudaMalloc blocks");
        check_cuda(cudaMalloc(reinterpret_cast<void**>(&device_states), host_states.size() * sizeof(DeviceState)), "cudaMalloc states");
        check_cuda(cudaMalloc(reinterpret_cast<void**>(&device_output), output_size), "cudaMalloc output");
        check_cuda(cudaMalloc(reinterpret_cast<void**>(&device_lengths), blocks.size() * sizeof(unsigned int)), "cudaMalloc lengths");
        if (metrics) metrics->allocation_ms = elapsed_ms(allocation_start, clock_type::now());
        const auto copy_start = clock_type::now();
        check_cuda(cudaMemcpy(device_pixels, host_pixels.data(), host_pixels.size() * sizeof(DevicePixel), cudaMemcpyHostToDevice), "copy pixels");
        check_cuda(cudaMemcpy(device_blocks, host_blocks.data(), host_blocks.size() * sizeof(DeviceBlock), cudaMemcpyHostToDevice), "copy blocks");
        check_cuda(cudaMemcpy(device_states, host_states.data(), host_states.size() * sizeof(DeviceState), cudaMemcpyHostToDevice), "copy states");
        if (metrics) metrics->transfer_in_ms = elapsed_ms(copy_start, clock_type::now());

        const auto encode_start = clock_type::now();
        constexpr unsigned int threads_per_block = 128U;
        const unsigned int grid = static_cast<unsigned int>((blocks.size() + threads_per_block - 1U) / threads_per_block);
        encode_blocks_kernel<<<grid, threads_per_block>>>(device_pixels, device_blocks, device_states,
                                                            device_output, stride, device_lengths,
                                                            static_cast<unsigned int>(blocks.size()));
        check_cuda(cudaGetLastError(), "launch CUDA QOI kernel");
        check_cuda(cudaDeviceSynchronize(), "synchronize CUDA QOI kernel");
        if (metrics) metrics->encode_ms = elapsed_ms(encode_start, clock_type::now());

        std::vector<unsigned char> host_output(output_size);
        std::vector<unsigned int> host_lengths(blocks.size());
        const auto copy_out_start = clock_type::now();
        check_cuda(cudaMemcpy(host_output.data(), device_output, output_size, cudaMemcpyDeviceToHost), "copy encoded chunks");
        check_cuda(cudaMemcpy(host_lengths.data(), device_lengths, blocks.size() * sizeof(unsigned int), cudaMemcpyDeviceToHost), "copy chunk lengths");
        if (metrics) metrics->transfer_out_ms = elapsed_ms(copy_out_start, clock_type::now());

        const auto merge_start = clock_type::now();
        std::vector<std::vector<std::uint8_t>> block_bytes(blocks.size());
        for (std::size_t index = 0U; index < blocks.size(); ++index) {
            block_bytes[index].assign(host_output.begin() + static_cast<std::ptrdiff_t>(index * stride),
                                      host_output.begin() + static_cast<std::ptrdiff_t>(index * stride + host_lengths[index]));
        }
        const std::vector<std::uint8_t> result = assemble_qoi(image, block_bytes);
        if (metrics) metrics->merge_ms = elapsed_ms(merge_start, clock_type::now());
        cudaFree(device_pixels); cudaFree(device_blocks); cudaFree(device_states);
        cudaFree(device_output); cudaFree(device_lengths);
        return result;
    } catch (...) {
        cudaFree(device_pixels); cudaFree(device_blocks); cudaFree(device_states);
        cudaFree(device_output); cudaFree(device_lengths);
        throw;
    }
}

}  // namespace pqoi
