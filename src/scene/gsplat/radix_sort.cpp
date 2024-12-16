#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#define RADIX_BITS 8
#define RADIX (1 << RADIX_BITS)
#define PASSES 4

static float* centers = NULL;
static uint32_t* keys = NULL;
static uint32_t* tempIndices = NULL;
static uint32_t* countBuffers = NULL;
static uint32_t* order = NULL;

extern "C" void* wasm_malloc(size_t size) {
    return malloc(size);
}

extern "C" void wasm_free(void* ptr) {
    free(ptr);
}

extern "C" void* allocateBuffers(uint32_t numVertices) {
    if (centers) free(centers);
    if (keys) free(keys);
    if (tempIndices) free(tempIndices);
    if (countBuffers) free(countBuffers);
    if (order) free(order);

    centers = (float*)malloc(numVertices * 3 * sizeof(float));
    keys = (uint32_t*)malloc(numVertices * sizeof(uint32_t));
    tempIndices = (uint32_t*)malloc(numVertices * sizeof(uint32_t));
    countBuffers = (uint32_t*)malloc(PASSES * RADIX * sizeof(uint32_t));
    order = (uint32_t*)malloc(numVertices * sizeof(uint32_t));
    return centers;
}

extern "C" void* radixSort(
    float px, float py, float pz,
    float dx, float dy, float dz,
    uint32_t numVertices
) {
    for (uint32_t i = 0; i < numVertices; i++) {
        float x = centers[i*3]   - px;
        float y = centers[i*3+1] - py;
        float z = centers[i*3+2] - pz;
        float val = x * dx + y * dy + z * dz;
        keys[i] = ~(*(uint32_t*)&val);
        order[i] = i;
    }

    for (uint32_t pass = 0; pass < PASSES; pass++) {
        uint32_t* count = &countBuffers[pass * RADIX];
        memset(count, 0, RADIX * sizeof(uint32_t));
        uint32_t shift = pass * RADIX_BITS;

        for (uint32_t i = 0; i < numVertices; i++) {
            count[(keys[order[i]] >> shift) & 0xFF]++;
        }

        for (uint32_t r = 1; r < RADIX; r++) {
            count[r] += count[r-1];
        }

        for (int32_t i = (int32_t)numVertices - 1; i >= 0; i--) {
            uint32_t idx = order[i];
            uint32_t k = (keys[idx] >> shift) & 0xFF;
            tempIndices[--count[k]] = idx;
        }

        uint32_t* tmp = order;
        order = tempIndices;
        tempIndices = tmp;
    }

    return order;
}
