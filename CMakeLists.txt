cmake_minimum_required(VERSION 3.24)

# RTX 4060 Laptop GPU uses compute capability 8.9. Setting this avoids CMake/NVCC
# falling back to an older architecture that may require unsupported PTX JIT at runtime.
if(NOT DEFINED CMAKE_CUDA_ARCHITECTURES)
    set(CMAKE_CUDA_ARCHITECTURES 89)
endif()

project(PDCWildfireMethods LANGUAGES CXX CUDA)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CUDA_STANDARD 17)
set(CMAKE_CUDA_STANDARD_REQUIRED ON)

add_executable(wildfire_serial serial_wildfire.cpp)
target_include_directories(wildfire_serial PRIVATE ${CMAKE_CURRENT_SOURCE_DIR})

find_package(OpenMP COMPONENTS CXX)
if(OpenMP_CXX_FOUND)
    add_executable(wildfire_openmp openmp_wildfire.cpp)
    target_include_directories(wildfire_openmp PRIVATE ${CMAKE_CURRENT_SOURCE_DIR})
    target_link_libraries(wildfire_openmp PRIVATE OpenMP::OpenMP_CXX)
endif()

add_executable(wildfire_cuda cuda_wildfire.cu)
target_include_directories(wildfire_cuda PRIVATE ${CMAKE_CURRENT_SOURCE_DIR})
set_target_properties(wildfire_cuda PROPERTIES CUDA_SEPARABLE_COMPILATION ON)

find_package(MPI COMPONENTS CXX)
if(MPI_CXX_FOUND)
    add_executable(wildfire_mpi mpi_wildfire.cpp)
    target_include_directories(wildfire_mpi PRIVATE ${CMAKE_CURRENT_SOURCE_DIR})
    target_link_libraries(wildfire_mpi PRIVATE MPI::MPI_CXX)
elseif(WIN32 AND EXISTS "C:/Program Files (x86)/Microsoft SDKs/MPI/Include/mpi.h")
    # MS-MPI installed by winget may not be discovered automatically by CMake in
    # the current shell environment. This fallback links against the standard
    # MS-MPI SDK installation paths.
    add_executable(wildfire_mpi mpi_wildfire.cpp)
    target_include_directories(wildfire_mpi PRIVATE
        ${CMAKE_CURRENT_SOURCE_DIR}
        "C:/Program Files (x86)/Microsoft SDKs/MPI/Include"
    )
    target_link_libraries(wildfire_mpi PRIVATE
        "C:/Program Files (x86)/Microsoft SDKs/MPI/Lib/x64/msmpi.lib"
    )
endif()
