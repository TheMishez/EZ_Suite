cmake_minimum_required(VERSION 3.20)
project(EZSuiteNative LANGUAGES CXX)

if(NOT WIN32)
  message(FATAL_ERROR "The EZ Soundboard mic plugin is Windows-only. Build with Visual Studio 2022 (x64).")
endif()

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
# Static CRT: the plugin runs inside audiodg.exe and must not depend on a VC++ redistributable.
set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")
add_compile_definitions(UNICODE _UNICODE NOMINMAX)
add_compile_options(/W3 /EHsc /permissive-)

set(OUT_DIR ${CMAKE_CURRENT_SOURCE_DIR}/bin)
foreach(cfg "" _DEBUG _RELEASE _RELWITHDEBINFO _MINSIZEREL)
  set(CMAKE_RUNTIME_OUTPUT_DIRECTORY${cfg} ${OUT_DIR})
  set(CMAKE_LIBRARY_OUTPUT_DIRECTORY${cfg} ${OUT_DIR})
endforeach()

# The plugin Windows loads into the microphone pipeline (reads the mix the app writes to shared memory)
add_library(EZSoundboardApo SHARED apo/EZSoundboardApo.cpp apo/EZSoundboardApo.def)
target_link_libraries(EZSoundboardApo PRIVATE ole32 advapi32 uuid)

# Enables / disables the plugin on microphones (runs elevated)
add_executable(ezsb-mic-setup setup/setup.cpp)
target_link_libraries(ezsb-mic-setup PRIVATE ole32 advapi32 uuid)

# The old ezsb-bridge.exe and ezsb-hotkeys.exe helpers are gone: EZ Suite's Rust backend writes
# the mix into shared memory itself and handles hotkeys with Raw Input.
