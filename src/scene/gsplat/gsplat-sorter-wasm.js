import { EventHandler } from '../../core/event-handler.js';
import { TEXTURELOCK_READ } from '../../platform/graphics/constants.js';
    
// sort blind set of data
function SortWorker() {
    let order;
    let centers;
    let mapping;
    let wasmExports;
    let wasmExportsInitializing = false;

    let cameraPosition;
    let cameraDirection;

    let forceUpdate = false;

    const lastCameraPosition = { x: 0, y: 0, z: 0 };
    const lastCameraDirection = { x: 0, y: 0, z: 0 };

    const boundMin = { x: 0, y: 0, z: 0 };
    const boundMax = { x: 0, y: 0, z: 0 };

    let centerPtr = null;

    // dirty hack to load wasm module
    const loadWasmModule = (mem_bytes) => {
        try {
            fetch('http://localhost:3000/radix_sort.wasm').then( response => {
                response.arrayBuffer().then( buffer => {
                //const wasmModule = await WebAssembly.instantiate(buffer);

                    const pages = mem_bytes / 65536;

                    WebAssembly.instantiate(buffer, {
                        env: { 
                            memory: new WebAssembly.Memory({ initial: pages, maximum: pages }),
                            emscripten_resize_heap: (requestedSize) => {
                                console.warn(`emscripten_resize_heap called with size: ${requestedSize}`);
                                return false; // Return false to indicate resizing is not supported
                            }
                        
                        }
                    }).then(wasmModule => {
                        wasmExports = wasmModule.instance.exports;
                        console.log('WebAssembly module loaded', wasmExports, mem_bytes / (1024*1024)+" mbytes");
                    });
            });
        });

        } catch (error) {
            console.error('Failed to load WebAssembly module:', error);
        }

    };

    const update = () => {
        if (!order || !centers || centers.length === 0 || !cameraPosition || !cameraDirection) return;

        if (!wasmExports && !wasmExportsInitializing) {
            wasmExportsInitializing = true;
            loadWasmModule(centers.length * 7 * 4); // 2x centers size for temporary buffers
            return;
        }

        if(!wasmExports) 
            return;

        const px = cameraPosition.x;
        const py = cameraPosition.y;
        const pz = cameraPosition.z;
        const dx = cameraDirection.x;
        const dy = cameraDirection.y;
        const dz = cameraDirection.z;

        const epsilon = 0.001;

        if (!forceUpdate &&
            Math.abs(px - lastCameraPosition.x) < epsilon &&
            Math.abs(py - lastCameraPosition.y) < epsilon &&
            Math.abs(pz - lastCameraPosition.z) < epsilon &&
            Math.abs(dx - lastCameraDirection.x) < epsilon &&
            Math.abs(dy - lastCameraDirection.y) < epsilon &&
            Math.abs(dz - lastCameraDirection.z) < epsilon) {
            return;
        }

        forceUpdate = false;

        lastCameraPosition.x = px;
        lastCameraPosition.y = py;
        lastCameraPosition.z = pz;
        lastCameraDirection.x = dx;
        lastCameraDirection.y = dy;
        lastCameraDirection.z = dz;

        const numVertices = centers.length / 3;

        // Allocate arrays once if needed
        if (!centerPtr)
        {
            centerPtr = wasmExports.allocateBuffers(numVertices);

            /// copy centers to wasm memory
            const centersArray = new Float32Array(wasmExports.memory.buffer, centerPtr, numVertices * 3);
            centersArray.set(centers);
            
            console.log('buffers allocated', centerPtr);
        }

        console.time('sort');
        
        const orderPtr = wasmExports.radixSort(px, py, pz, dx, dy, dz, numVertices);
        console.timeEnd('sort');

        console.time('copy');
        /// copy data from orderPts to order
        const orderArray = new Uint32Array(wasmExports.memory.buffer, orderPtr, numVertices);
        order.set(orderArray);

        console.timeEnd('copy');

        

        const count = numVertices; // all vertices included

        // send results
        self.postMessage({
            order: order.buffer,
            count
        }, [order.buffer]);

        order = null;
    };

    self.onmessage = (message) => {
        if (message.data.order) {
            order = new Uint32Array(message.data.order);
        }
        if (message.data.centers) {
            centers = new Float32Array(message.data.centers);

            // calculate bounds
            boundMin.x = boundMax.x = centers[0];
            boundMin.y = boundMax.y = centers[1];
            boundMin.z = boundMax.z = centers[2];

            const numVertices = centers.length / 3;
            for (let i = 1; i < numVertices; ++i) {
                const x = centers[i * 3 + 0];
                const y = centers[i * 3 + 1];
                const z = centers[i * 3 + 2];

                boundMin.x = Math.min(boundMin.x, x);
                boundMin.y = Math.min(boundMin.y, y);
                boundMin.z = Math.min(boundMin.z, z);

                boundMax.x = Math.max(boundMax.x, x);
                boundMax.y = Math.max(boundMax.y, y);
                boundMax.z = Math.max(boundMax.z, z);
            }
            forceUpdate = true;
        }
        if (message.data.hasOwnProperty('mapping')) {
            mapping = message.data.mapping ? new Uint32Array(message.data.mapping) : null;
            forceUpdate = true;
        }
        if (message.data.cameraPosition) cameraPosition = message.data.cameraPosition;
        if (message.data.cameraDirection) cameraDirection = message.data.cameraDirection;

        update();
    };
}

class GSplatSorter extends EventHandler {
    worker;

    orderTexture;

    centers;

    constructor() {
        super();

        this.worker = new Worker(URL.createObjectURL(new Blob([`(${SortWorker.toString()})()`], {
            type: 'application/javascript'
        })));

        this.worker.onmessage = (message) => {
            const newOrder = message.data.order;
            const oldOrder = this.orderTexture._levels[0].buffer;

            // send vertex storage to worker to start the next frame
            this.worker.postMessage({
                order: oldOrder
            }, [oldOrder]);

            // write the new order data to gpu texture memory
            this.orderTexture._levels[0] = new Uint32Array(newOrder);
            this.orderTexture.upload();

            // set new data directly on texture
            this.fire('updated', message.data.count);
        };
    }

    destroy() {
        this.worker.terminate();
        this.worker = null;
    }

    init(orderTexture, centers) {
        this.orderTexture = orderTexture;
        this.centers = centers.slice();

        // get the texture's storage buffer and make a copy
        const orderBuffer = this.orderTexture.lock({
            mode: TEXTURELOCK_READ
        }).buffer.slice();
        this.orderTexture.unlock();

        // send the initial buffer to worker
        this.worker.postMessage({
            order: orderBuffer,
            centers: centers.buffer
        }, [orderBuffer, centers.buffer]);
    }

    setMapping(mapping) {
        if (mapping) {
            // create new centers array
            const centers = new Float32Array(mapping.length * 3);
            for (let i = 0; i < mapping.length; ++i) {
                const src = mapping[i] * 3;
                const dst = i * 3;
                centers[dst + 0] = this.centers[src + 0];
                centers[dst + 1] = this.centers[src + 1];
                centers[dst + 2] = this.centers[src + 2];
            }

            // update worker with new centers and mapping for the subset of splats
            this.worker.postMessage({
                centers: centers.buffer,
                mapping: mapping.buffer
            }, [centers.buffer, mapping.buffer]);
        } else {
            // restore original centers
            const centers = this.centers.slice();
            this.worker.postMessage({
                centers: centers.buffer,
                mapping: null
            }, [centers.buffer]);
        }
    }

    setCamera(pos, dir) {
        this.worker.postMessage({
            cameraPosition: { x: pos.x, y: pos.y, z: pos.z },
            cameraDirection: { x: dir.x, y: dir.y, z: dir.z }
        });
    }
}

export { GSplatSorter };
