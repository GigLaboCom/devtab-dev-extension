cmake_minimum_required(VERSION 3.20)
project(review VERSION 1.2.0 LANGUAGES C CXX)

# Options the build takes.
option(REVIEW_TESTS "Build the tests" ON)
set(CMAKE_CXX_STANDARD 20)

add_library(review STATIC src/diff.cpp src/lines.cpp)
target_include_directories(review PUBLIC include)

if(REVIEW_TESTS)
  enable_testing()
  add_executable(review_tests tests/main.cpp)
  target_link_libraries(review_tests PRIVATE review)
  add_test(NAME all COMMAND review_tests --verbose)
endif()
message(STATUS "review ${PROJECT_VERSION} configured")
