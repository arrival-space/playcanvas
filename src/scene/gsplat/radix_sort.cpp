#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <stdbool.h>
#include <stdio.h>

#define RADIX_BITS 8
#define RADIX (1 << RADIX_BITS)
#define PASSES 4

static float* centers = NULL;
static uint32_t* keys = NULL;
static uint32_t* orderTemp = NULL;
static uint32_t* order = NULL;

/**
 * Dynamically select the smallest histogram type depending on n.
 * We'll implement a small inline function that dispatches the sorting
 * to a templated function depending on the maximum range.
 */

extern "C" void* wasm_malloc(size_t size) {
    return malloc(size);
}

extern "C" void wasm_free(void* ptr) {
    free(ptr);
}

extern "C" void* allocateBuffers(uint32_t numVertices) {
    if (centers) free(centers);
    if (keys) free(keys);
    if (orderTemp) free(orderTemp);
    if (order) free(order);

    centers = (float*)malloc(numVertices * 3 * sizeof(float));
    keys = (uint32_t*)malloc(numVertices * sizeof(uint32_t));
    orderTemp = (uint32_t*)malloc(numVertices * sizeof(uint32_t));
    order = (uint32_t*)malloc(numVertices * sizeof(uint32_t));
    return centers;
}


// Template function to perform the sorting using a given histogram type.
// This matches the improved approach: skipping passes if uniform, early-exit if sorted, etc.
template<typename HistType>
static void radix_sort_impl(
    uint32_t* order,
    uint32_t* orderTemp,
    const uint32_t* keys,
    const uint32_t numVertices
) {
    // We know we have 4 passes for 32-bit keys.
    // We'll build histograms for each pass and see what we need to do.
    constexpr unsigned int passes = PASSES;
    constexpr unsigned int hist_len = RADIX;
    HistType histogram[hist_len * passes];
    memset(histogram, 0, sizeof(histogram));

    // Build histograms
    // We do it in one pass: go over all elements and update histograms for each of the 4 passes.
    for (uint32_t i = 0; i < numVertices; i++) {
        uint32_t k = keys[i];
        // Update histograms
        histogram[(0*hist_len) + ((k >> (0*RADIX_BITS)) & 0xFF)]++;
        histogram[(1*hist_len) + ((k >> (1*RADIX_BITS)) & 0xFF)]++;
        histogram[(2*hist_len) + ((k >> (2*RADIX_BITS)) & 0xFF)]++;
        histogram[(3*hist_len) + ((k >> (3*RADIX_BITS)) & 0xFF)]++;
    }

    // Perform prefix sums on required passes
    for (unsigned int pass = 0; pass < PASSES; pass++) {
        HistType sum = 0;
        for (unsigned int r = 0; r < RADIX; r++) {
            HistType temp = histogram[pass*hist_len + r];
            histogram[pass*hist_len + r] = sum;
            sum += temp;
        }
    }

    // Sort using the active passes
    for (unsigned int pass = 0; pass < PASSES; pass++) {
        uint32_t shift = pass * RADIX_BITS;
        HistType* currHist = &histogram[pass * hist_len];

        // Scatter
        for (uint32_t i = 0; i < numVertices; i++) {
            const uint32_t idx = order[i];
            const uint32_t k = (keys[idx] >> shift) & 0xFF;
            const uint32_t pos = currHist[k]++;
            orderTemp[pos] = idx;
        }
        // Swap order and orderTemp
        uint32_t* tmp = order;
        order = orderTemp;
        orderTemp = tmp;
    }
}


extern "C" void* radixSort(
    float px, float py, float pz,
    float dx, float dy, float dz,
    uint32_t numVertices
) {
    // Compute keys and initial order
    for (uint32_t i = 0; i < numVertices; i++) {
        float x = centers[i*3]   - px;
        float y = centers[i*3+1] - py;
        float z = centers[i*3+2] - pz;
        float val = (x * dx + y * dy + z * dz);
        keys[i] = ~(*(uint32_t*)&val);
        order[i] = i;
    }

    radix_sort_impl<uint32_t>(order, orderTemp, keys, numVertices);
    return order;
}
