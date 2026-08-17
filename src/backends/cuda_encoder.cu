#include "pqoi/encoder.hpp"

#include "pqoi/core/qoi_encode.hpp"

#include <cub/device/device_scan.cuh>
#include <cuda_runtime.h>

#include <algorithm>
#include <chrono>
#include <cstdint>
#include <limits>
#include <stdexcept>
#include <string>
#include <vector>

namespace {

using PackedPixel = std::uint32_t;

struct DeviceBlock {
    std::uint32_t begin;
    std::uint32_t end;
};

struct DeviceBlockSummary {
    PackedPixel last_pixel;
    PackedPixel last_pixel_for_slot[64];
    std::uint64_t touched_mask;
    std::uint32_t has_pixels;
};

constexpr PackedPixel initial_previous = 0xff000000U;

__host__ __device__ __forceinline__ constexpr unsigned char red(const PackedPixel pixel) {
    return static_cast<unsigned char>(pixel & 0xffU);
}

__host__ __device__ __forceinline__ constexpr unsigned char green(const PackedPixel pixel) {
    return static_cast<unsigned char>((pixel >> 8U) & 0xffU);
}

__host__ __device__ __forceinline__ constexpr unsigned char blue(const PackedPixel pixel) {
    return static_cast<unsigned char>((pixel >> 16U) & 0xffU);
}

__host__ __device__ __forceinline__ constexpr unsigned char alpha(const PackedPixel pixel) {
    return static_cast<unsigned char>((pixel >> 24U) & 0xffU);
}

constexpr PackedPixel pack_pixel(const pqoi::Pixel pixel) {
    return static_cast<PackedPixel>(pixel.r) |
           (static_cast<PackedPixel>(pixel.g) << 8U) |
           (static_cast<PackedPixel>(pixel.b) << 16U) |
           (static_cast<PackedPixel>(pixel.a) << 24U);
}

__device__ __forceinline__ unsigned int pixel_hash(const PackedPixel pixel) {
    return (static_cast<unsigned int>(red(pixel)) * 3U +
            static_cast<unsigned int>(green(pixel)) * 5U +
            static_cast<unsigned int>(blue(pixel)) * 7U +
            static_cast<unsigned int>(alpha(pixel)) * 11U) & 63U;
}

__device__ __forceinline__ void flush_run(unsigned char* output,
                                          unsigned int& cursor,
                                          unsigned int& run) {
    if (run == 0U) return;
    output[cursor++] = static_cast<unsigned char>(0xc0U | (run - 1U));
    run = 0U;
}

struct SummaryCompose {
    __host__ __device__ DeviceBlockSummary operator()(const DeviceBlockSummary& left,
                                                       const DeviceBlockSummary& right) const {
        if (left.has_pixels == 0U) return right;
        if (right.has_pixels == 0U) return left;
        DeviceBlockSummary result = left;
        result.last_pixel = right.last_pixel;
        result.has_pixels = 1U;
        result.touched_mask = left.touched_mask | right.touched_mask;
        for (unsigned int slot = 0U; slot < 64U; ++slot) {
            if ((right.touched_mask & (std::uint64_t{1} << slot)) != 0U) {
                result.last_pixel_for_slot[slot] = right.last_pixel_for_slot[slot];
            }
        }
        return result;
    }
};

__global__ void summarize_blocks_kernel(const PackedPixel* __restrict__ pixels,
                                        const DeviceBlock* __restrict__ blocks,
                                        DeviceBlockSummary* __restrict__ summaries,
                                        const unsigned int segment_count) {
    const unsigned int segment_index = blockIdx.x * blockDim.x + threadIdx.x;
    if (segment_index >= segment_count) return;

    DeviceBlockSummary summary{};
    const DeviceBlock segment = blocks[segment_index];
    for (std::uint32_t position = segment.begin; position < segment.end; ++position) {
        const PackedPixel pixel = pixels[position];
        const unsigned int slot = pixel_hash(pixel);
        summary.last_pixel_for_slot[slot] = pixel;
        summary.touched_mask |= std::uint64_t{1} << slot;
        summary.last_pixel = pixel;
        summary.has_pixels = 1U;
    }
    summaries[segment_index] = summary;
}

__global__ void build_entry_states_kernel(const DeviceBlockSummary* __restrict__ prefixes,
                                          PackedPixel* __restrict__ state_previous,
                                          PackedPixel* __restrict__ state_index,
                                          const unsigned int segment_count) {
    const unsigned int segment_index = blockIdx.x * blockDim.x + threadIdx.x;
    if (segment_index >= segment_count) return;

    const DeviceBlockSummary prefix = prefixes[segment_index];
    state_previous[segment_index] = prefix.has_pixels != 0U ? prefix.last_pixel : initial_previous;
    for (unsigned int slot = 0U; slot < 64U; ++slot) {
        state_index[static_cast<std::size_t>(slot) * segment_count + segment_index] =
            (prefix.touched_mask & (std::uint64_t{1} << slot)) != 0U
            ? prefix.last_pixel_for_slot[slot]
            : 0U;
    }
}

template <bool UseSharedState>
__global__ void encode_blocks_kernel(const PackedPixel* __restrict__ pixels,
                                     const DeviceBlock* __restrict__ blocks,
                                     const PackedPixel* __restrict__ state_previous,
                                     PackedPixel* __restrict__ state_index,
                                     unsigned char* __restrict__ output,
                                     const std::size_t stride,
                                     std::uint64_t* __restrict__ lengths,
                                     const unsigned int segment_count) {
    const unsigned int segment_index = blockIdx.x * blockDim.x + threadIdx.x;
    extern __shared__ PackedPixel shared_index[];
    const bool active = segment_index < segment_count;

    if constexpr (UseSharedState) {
        for (unsigned int slot = 0U; slot < 64U; ++slot) {
            shared_index[static_cast<std::size_t>(slot) * blockDim.x + threadIdx.x] = active
                ? state_index[static_cast<std::size_t>(slot) * segment_count + segment_index]
                : 0U;
        }
        __syncthreads();
    }

    if (!active) return;

    PackedPixel previous = state_previous[segment_index];
    unsigned char* destination = output + static_cast<std::size_t>(segment_index) * stride;
    unsigned int cursor = 0U;
    unsigned int run = 0U;
    const DeviceBlock segment = blocks[segment_index];
    for (std::uint32_t position = segment.begin; position < segment.end; ++position) {
        const PackedPixel pixel = pixels[position];
        if (pixel == previous) {
            ++run;
            if (run == 62U || position + 1U == segment.end) flush_run(destination, cursor, run);
            continue;
        }

        flush_run(destination, cursor, run);
        const unsigned int slot = pixel_hash(pixel);
        PackedPixel& indexed_pixel = UseSharedState
            ? shared_index[static_cast<std::size_t>(slot) * blockDim.x + threadIdx.x]
            : state_index[static_cast<std::size_t>(slot) * segment_count + segment_index];
        if (indexed_pixel == pixel) {
            destination[cursor++] = static_cast<unsigned char>(slot);
        } else {
            indexed_pixel = pixel;
            const int dr = static_cast<int>(red(pixel)) - static_cast<int>(red(previous));
            const int dg = static_cast<int>(green(pixel)) - static_cast<int>(green(previous));
            const int db = static_cast<int>(blue(pixel)) - static_cast<int>(blue(previous));
            const int da = static_cast<int>(alpha(pixel)) - static_cast<int>(alpha(previous));
            if (da == 0 && dr > -3 && dr < 2 && dg > -3 && dg < 2 && db > -3 && db < 2) {
                destination[cursor++] = static_cast<unsigned char>(
                    0x40U | ((dr + 2) << 4) | ((dg + 2) << 2) | (db + 2));
            } else if (da == 0) {
                const int dr_dg = dr - dg;
                const int db_dg = db - dg;
                if (dg > -33 && dg < 32 && dr_dg > -9 && dr_dg < 8 && db_dg > -9 && db_dg < 8) {
                    destination[cursor++] = static_cast<unsigned char>(0x80U | (dg + 32));
                    destination[cursor++] = static_cast<unsigned char>(((dr_dg + 8) << 4) | (db_dg + 8));
                } else {
                    destination[cursor++] = 0xfeU;
                    destination[cursor++] = red(pixel);
                    destination[cursor++] = green(pixel);
                    destination[cursor++] = blue(pixel);
                }
            } else {
                destination[cursor++] = 0xffU;
                destination[cursor++] = red(pixel);
                destination[cursor++] = green(pixel);
                destination[cursor++] = blue(pixel);
                destination[cursor++] = alpha(pixel);
            }
        }
        previous = pixel;
    }
    flush_run(destination, cursor, run);
    lengths[segment_index] = static_cast<std::uint64_t>(cursor);
}

__global__ void compact_blocks_kernel(const unsigned char* __restrict__ scratch,
                                      const std::size_t stride,
                                      const std::uint64_t* __restrict__ lengths,
                                      const std::uint64_t* __restrict__ offsets,
                                      unsigned char* __restrict__ compact_output,
                                      const unsigned int segment_count) {
    const unsigned int segment_index = blockIdx.x;
    if (segment_index >= segment_count) return;

    const std::uint64_t length = lengths[segment_index];
    const std::uint64_t offset = offsets[segment_index];
    const unsigned char* source = scratch + static_cast<std::size_t>(segment_index) * stride;
    for (std::uint64_t index = threadIdx.x; index < length; index += blockDim.x) {
        compact_output[offset + index] = source[index];
    }
}

using clock_type = std::chrono::steady_clock;

double elapsed_ms(const clock_type::time_point start, const clock_type::time_point end) {
    return std::chrono::duration<double, std::milli>(end - start).count();
}

void check_cuda(const cudaError_t error, const char* operation) {
    if (error != cudaSuccess) {
        throw std::runtime_error(std::string(operation) + ": " + cudaGetErrorString(error));
    }
}

template <typename T>
bool ensure_device_capacity(T*& pointer,
                            std::size_t& capacity,
                            const std::size_t required,
                            const char* operation) {
    if (required <= capacity) return false;
    T* replacement = nullptr;
    check_cuda(cudaMalloc(reinterpret_cast<void**>(&replacement), required * sizeof(T)), operation);
    cudaFree(pointer);
    pointer = replacement;
    capacity = required;
    return true;
}

bool ensure_byte_capacity(void*& pointer,
                          std::size_t& capacity,
                          const std::size_t required,
                          const char* operation) {
    if (required <= capacity) return false;
    void* replacement = nullptr;
    check_cuda(cudaMalloc(&replacement, required), operation);
    cudaFree(pointer);
    pointer = replacement;
    capacity = required;
    return true;
}

template <typename T>
bool ensure_host_capacity(T*& pointer,
                          std::size_t& capacity,
                          const std::size_t required,
                          const char* operation) {
    if (required <= capacity) return false;
    T* replacement = nullptr;
    check_cuda(cudaHostAlloc(reinterpret_cast<void**>(&replacement), required * sizeof(T), cudaHostAllocDefault),
               operation);
    cudaFreeHost(pointer);
    pointer = replacement;
    capacity = required;
    return true;
}

struct CudaContext {
    cudaStream_t stream{};
    PackedPixel* pixels{};
    DeviceBlock* blocks{};
    DeviceBlockSummary* summaries{};
    DeviceBlockSummary* prefixes{};
    PackedPixel* state_previous{};
    PackedPixel* state_index{};
    unsigned char* scratch{};
    unsigned char* compact_output{};
    std::uint64_t* lengths{};
    std::uint64_t* offsets{};
    void* scan_temporary{};
    PackedPixel* host_pixels{};
    DeviceBlock* host_blocks{};
    unsigned char* host_output{};
    std::size_t pixel_capacity{};
    std::size_t block_capacity{};
    std::size_t summary_capacity{};
    std::size_t prefix_capacity{};
    std::size_t state_previous_capacity{};
    std::size_t state_index_capacity{};
    std::size_t scratch_capacity{};
    std::size_t compact_capacity{};
    std::size_t length_capacity{};
    std::size_t offset_capacity{};
    std::size_t scan_capacity{};
    std::size_t host_pixel_capacity{};
    std::size_t host_block_capacity{};
    std::size_t host_output_capacity{};
    bool used{};

    CudaContext() { check_cuda(cudaStreamCreateWithFlags(&stream, cudaStreamNonBlocking), "create CUDA stream"); }

    ~CudaContext() {
        cudaFree(pixels);
        cudaFree(blocks);
        cudaFree(summaries);
        cudaFree(prefixes);
        cudaFree(state_previous);
        cudaFree(state_index);
        cudaFree(scratch);
        cudaFree(compact_output);
        cudaFree(lengths);
        cudaFree(offsets);
        cudaFree(scan_temporary);
        cudaFreeHost(host_pixels);
        cudaFreeHost(host_blocks);
        cudaFreeHost(host_output);
        if (stream != nullptr) cudaStreamDestroy(stream);
    }
};

CudaContext& cuda_context() {
    static thread_local CudaContext context;
    return context;
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
    check_cuda(cudaFree(nullptr), "initialize CUDA context");
    cudaDeviceProp device_properties{};
    check_cuda(cudaGetDeviceProperties(&device_properties, 0), "query CUDA device properties");
    CudaContext& context = cuda_context();
    if (metrics) {
        metrics->cuda_init_ms = elapsed_ms(cuda_init_start, clock_type::now());
        metrics->cuda_device_architecture = std::to_string(device_properties.major) + "." +
                                            std::to_string(device_properties.minor);
        metrics->persistent_context_reused = context.used;
        metrics->cuda_threads_per_block = options.cuda_threads_per_block;
    }

    if (image.pixels.empty()) throw std::runtime_error("CUDA QOI encoding requires at least one pixel");
    if (image.pixels.size() > static_cast<std::size_t>((std::numeric_limits<std::uint32_t>::max)())) {
        throw std::runtime_error("CUDA QOI encoding supports at most UINT32_MAX pixels");
    }
    if (options.segment_length == 0U) throw std::runtime_error("CUDA segment length must be greater than zero");
    if (options.cuda_threads_per_block < 32U || options.cuda_threads_per_block % 32U != 0U ||
        options.cuda_threads_per_block > static_cast<std::size_t>(device_properties.maxThreadsPerBlock)) {
        throw std::runtime_error("CUDA threads per block must be a multiple of 32 within the device limit");
    }

    const std::size_t requested_segments =
        1U + (image.pixels.size() - 1U) / options.segment_length;
    const std::vector<Block> segments = partition_blocks(image.pixels.size(), requested_segments);
    if (metrics) metrics->blocks = segments.size();
    if (segments.empty()) throw std::runtime_error("CUDA QOI encoding requires at least one segment");
    if (segments.size() > static_cast<std::size_t>((std::numeric_limits<unsigned int>::max)())) {
        throw std::runtime_error("CUDA QOI segment count exceeds the kernel index range");
    }

    std::size_t max_segment_pixels = 0U;

    constexpr std::size_t maximum_bytes_per_pixel = 5U;
    constexpr std::size_t segment_capacity_margin = 64U;
    for (const Block segment : segments) {
        max_segment_pixels = std::max(max_segment_pixels, segment.end - segment.begin);
    }
    if (max_segment_pixels > ((std::numeric_limits<std::size_t>::max)() - segment_capacity_margin) /
                                 maximum_bytes_per_pixel) {
        throw std::runtime_error("CUDA QOI segment capacity overflows size_t");
    }
    const std::size_t stride = maximum_bytes_per_pixel * max_segment_pixels + segment_capacity_margin;
    if (segments.size() > (std::numeric_limits<std::size_t>::max)() / stride) {
        throw std::runtime_error("CUDA QOI scratch allocation overflows size_t");
    }
    const std::size_t scratch_size = stride * segments.size();
    const unsigned int segment_count = static_cast<unsigned int>(segments.size());
    const unsigned int threads_per_block = static_cast<unsigned int>(options.cuda_threads_per_block);
    const unsigned int grid = (segment_count + threads_per_block - 1U) / threads_per_block;
    constexpr std::size_t qoi_index_slots = 64U;
    if (segments.size() > (std::numeric_limits<std::size_t>::max)() / qoi_index_slots) {
        throw std::runtime_error("CUDA QOI state-index allocation overflows size_t");
    }
    const std::size_t state_index_count = qoi_index_slots * segments.size();
    const bool use_shared_state = options.segment_length >= 256U &&
                                  (threads_per_block == 64U || threads_per_block == 128U);
    const std::size_t shared_state_bytes = use_shared_state
        ? qoi_index_slots * threads_per_block * sizeof(PackedPixel)
        : 0U;
    if (shared_state_bytes > static_cast<std::size_t>(device_properties.sharedMemPerBlock)) {
        throw std::runtime_error("CUDA shared QOI state exceeds the device per-block shared-memory limit");
    }

    const auto allocation_start = clock_type::now();
    ensure_host_capacity(context.host_pixels, context.host_pixel_capacity, image.pixels.size(),
                         "allocate pinned host pixels");
    ensure_host_capacity(context.host_blocks, context.host_block_capacity, segments.size(),
                         "allocate pinned host segments");
    ensure_host_capacity(context.host_output, context.host_output_capacity, scratch_size,
                         "allocate pinned host output");
    ensure_device_capacity(context.pixels, context.pixel_capacity, image.pixels.size(), "allocate CUDA pixels");
    ensure_device_capacity(context.blocks, context.block_capacity, segments.size(), "allocate CUDA segments");
    ensure_device_capacity(context.summaries, context.summary_capacity, segments.size(), "allocate CUDA summaries");
    ensure_device_capacity(context.prefixes, context.prefix_capacity, segments.size(), "allocate CUDA prefixes");
    ensure_device_capacity(context.state_previous, context.state_previous_capacity, segments.size(),
                           "allocate CUDA previous-pixel states");
    ensure_device_capacity(context.state_index, context.state_index_capacity, state_index_count,
                           "allocate CUDA QOI index states");
    ensure_device_capacity(context.lengths, context.length_capacity, segments.size(), "allocate CUDA lengths");
    ensure_device_capacity(context.offsets, context.offset_capacity, segments.size(), "allocate CUDA offsets");
    ensure_device_capacity(context.scratch, context.scratch_capacity, scratch_size, "allocate CUDA scratch output");
    ensure_device_capacity(context.compact_output, context.compact_capacity, scratch_size,
                           "allocate CUDA compact output");

    std::size_t summary_scan_bytes = 0U;
    const DeviceBlockSummary identity{};
    check_cuda(cub::DeviceScan::ExclusiveScan(
                   nullptr, summary_scan_bytes, context.summaries, context.prefixes,
                   SummaryCompose{}, identity, segment_count, context.stream),
               "query CUB summary scan storage");
    std::size_t length_scan_bytes = 0U;
    check_cuda(cub::DeviceScan::ExclusiveSum(
                   nullptr, length_scan_bytes, context.lengths, context.offsets,
                   segment_count, context.stream),
               "query CUB length scan storage");
    ensure_byte_capacity(context.scan_temporary, context.scan_capacity,
                         std::max(summary_scan_bytes, length_scan_bytes),
                         "allocate CUB scan storage");
    if (metrics) metrics->allocation_ms = elapsed_ms(allocation_start, clock_type::now());

    for (std::size_t index = 0U; index < image.pixels.size(); ++index) {
        context.host_pixels[index] = pack_pixel(image.pixels[index]);
    }
    for (std::size_t index = 0U; index < segments.size(); ++index) {
        context.host_blocks[index] = DeviceBlock{
            static_cast<std::uint32_t>(segments[index].begin),
            static_cast<std::uint32_t>(segments[index].end)};
    }

    const auto pipeline_start = clock_type::now();
    const auto transfer_start = clock_type::now();
    check_cuda(cudaMemcpyAsync(context.pixels, context.host_pixels,
                               image.pixels.size() * sizeof(PackedPixel), cudaMemcpyHostToDevice,
                               context.stream), "copy packed pixels");
    check_cuda(cudaMemcpyAsync(context.blocks, context.host_blocks,
                               segments.size() * sizeof(DeviceBlock), cudaMemcpyHostToDevice,
                               context.stream), "copy segment ranges");
    check_cuda(cudaStreamSynchronize(context.stream), "synchronize CUDA input transfers");
    if (metrics) metrics->transfer_in_ms = elapsed_ms(transfer_start, clock_type::now());

    const auto summary_start = clock_type::now();
    summarize_blocks_kernel<<<grid, threads_per_block, 0U, context.stream>>>(
        context.pixels, context.blocks, context.summaries, segment_count);
    check_cuda(cudaGetLastError(), "launch CUDA summary kernel");
    check_cuda(cudaStreamSynchronize(context.stream), "synchronize CUDA summary kernel");
    if (metrics) metrics->summary_ms = elapsed_ms(summary_start, clock_type::now());

    const auto propagation_start = clock_type::now();
    check_cuda(cub::DeviceScan::ExclusiveScan(
                   context.scan_temporary, summary_scan_bytes,
                   context.summaries, context.prefixes, SummaryCompose{}, identity,
                   segment_count, context.stream),
               "run CUB summary scan");
    build_entry_states_kernel<<<grid, threads_per_block, 0U, context.stream>>>(
        context.prefixes, context.state_previous, context.state_index, segment_count);
    check_cuda(cudaGetLastError(), "launch CUDA entry-state kernel");
    check_cuda(cudaStreamSynchronize(context.stream), "synchronize CUDA state propagation");
    if (metrics) metrics->propagation_ms = elapsed_ms(propagation_start, clock_type::now());

    const auto encode_start = clock_type::now();
    if (use_shared_state) {
        encode_blocks_kernel<true><<<grid, threads_per_block, shared_state_bytes, context.stream>>>(
            context.pixels, context.blocks, context.state_previous, context.state_index,
            context.scratch, stride, context.lengths, segment_count);
    } else {
        encode_blocks_kernel<false><<<grid, threads_per_block, 0U, context.stream>>>(
            context.pixels, context.blocks, context.state_previous, context.state_index,
            context.scratch, stride, context.lengths, segment_count);
    }
    check_cuda(cudaGetLastError(), "launch CUDA QOI kernel");
    check_cuda(cudaStreamSynchronize(context.stream), "synchronize CUDA QOI kernel");
    if (metrics) metrics->encode_ms = elapsed_ms(encode_start, clock_type::now());

    const auto prefix_scan_start = clock_type::now();
    check_cuda(cub::DeviceScan::ExclusiveSum(
                   context.scan_temporary, length_scan_bytes,
                   context.lengths, context.offsets, segment_count, context.stream),
               "run CUB encoded-length scan");
    std::uint64_t final_offset = 0U;
    std::uint64_t final_length = 0U;
    check_cuda(cudaMemcpyAsync(&final_offset, context.offsets + segments.size() - 1U,
                               sizeof(final_offset), cudaMemcpyDeviceToHost, context.stream),
               "copy final compact offset");
    check_cuda(cudaMemcpyAsync(&final_length, context.lengths + segments.size() - 1U,
                               sizeof(final_length), cudaMemcpyDeviceToHost, context.stream),
               "copy final compact length");
    check_cuda(cudaStreamSynchronize(context.stream), "synchronize CUB encoded-length scan");
    if (metrics) metrics->prefix_scan_ms = elapsed_ms(prefix_scan_start, clock_type::now());

    if (final_offset > (std::numeric_limits<std::uint64_t>::max)() - final_length) {
        throw std::runtime_error("CUDA compact output length overflows uint64_t");
    }
    const std::uint64_t compact_size_u64 = final_offset + final_length;
    if (compact_size_u64 > static_cast<std::uint64_t>((std::numeric_limits<std::size_t>::max)())) {
        throw std::runtime_error("CUDA compact output length exceeds host size_t");
    }
    const std::size_t compact_size = static_cast<std::size_t>(compact_size_u64);

    const auto compaction_start = clock_type::now();
    compact_blocks_kernel<<<segment_count, threads_per_block, 0U, context.stream>>>(
        context.scratch, stride, context.lengths, context.offsets,
        context.compact_output, segment_count);
    check_cuda(cudaGetLastError(), "launch CUDA compaction kernel");
    check_cuda(cudaStreamSynchronize(context.stream), "synchronize CUDA compaction kernel");
    if (metrics) metrics->compaction_ms = elapsed_ms(compaction_start, clock_type::now());

    const auto transfer_out_start = clock_type::now();
    check_cuda(cudaMemcpyAsync(context.host_output, context.compact_output, compact_size,
                               cudaMemcpyDeviceToHost, context.stream),
               "copy compact encoded payload");
    check_cuda(cudaStreamSynchronize(context.stream), "synchronize compact payload transfer");
    if (metrics) {
        metrics->transfer_out_ms = elapsed_ms(transfer_out_start, clock_type::now());
        metrics->core_pipeline_ms = elapsed_ms(pipeline_start, clock_type::now());
    }

    const auto merge_start = clock_type::now();
    std::vector<std::vector<std::uint8_t>> segment_bytes(1U);
    segment_bytes.front().assign(context.host_output, context.host_output + compact_size);
    std::vector<std::uint8_t> result = assemble_qoi(image, segment_bytes);
    if (metrics) metrics->merge_ms = elapsed_ms(merge_start, clock_type::now());
    context.used = true;
    return result;
}

}  // namespace pqoi
