// How to use in the Editor:
// - create entity with Camera component - position of the entity defines where the cubemap is rendered from
//   and properties of the Camera are used to render cubemap (adjust near / far distance, clearing, layers and other properties)
//   Note: the layers should contain all layers visible by cubemap camera.
// - to use generated cube map, you can access it like this using script:
//   material.cubeMap = entity.script.cubemapRenderer.cubeMap;

var CubemapRenderer = pc.createScript('cubemapRenderer');

CubemapRenderer.attributes.add('resolution', {
    title: 'Resolution',
    description: 'Resolution of one side of a cubemap. Use power of 2 resolution if you wish to use Mipmaps.',
    type: 'number',
    default: 64
});

CubemapRenderer.attributes.add('mipmaps', {
    title: 'Mipmaps',
    description: 'If set to true, mipmaps will be allocated and autogenerated.',
    type: 'boolean',
    default: true
});

CubemapRenderer.attributes.add('depth', {
    title: 'Depth',
    description: 'If set to true, depth buffer will be created.',
    type: 'boolean',
    default: true
});

// initialize code called once per entity
CubemapRenderer.prototype.initialize = function () {

    // this entity needs to have camera component as well
    var camera = this.entity.camera;
    if (!camera) {
        console.error("CubemapRenderer component requires Camera component to be created on the Entity.");
        return;
    }

    // disable camera component, as it's used only as a source of properties
    camera.enabled = false;

    // limit maximum texture size
    var resolution = Math.min(this.resolution, this.app.graphicsDevice.maxCubeMapSize);

    // Create cubemap render target with specified resolution and mipmap generation
    this.cubeMap = new pc.Texture(this.app.graphicsDevice, {
        name: this.entity.name + ':CubemapRenderer-' + resolution,
        width: resolution,
        height: resolution,
        format: pc.PIXELFORMAT_RGBA8,
        cubemap: true,
        mipmaps: this.mipmaps,
        minFilter: pc.FILTER_LINEAR_MIPMAP_LINEAR,
        magFilter: pc.FILTER_LINEAR
    });

    // angles to render camera for all 6 faces
    var cameraRotations = [
        new pc.Quat().setFromEulerAngles(0, 90, 0),
        new pc.Quat().setFromEulerAngles(0, -90, 0),
        new pc.Quat().setFromEulerAngles(-90, 0, 180),
        new pc.Quat().setFromEulerAngles(90, 0, 180),
        new pc.Quat().setFromEulerAngles(0, 180, 0),
        new pc.Quat().setFromEulerAngles(0, 0, 0)
    ];

    // set up rendering for all 6 faces
    for (var i = 0; i < 6; i++) {

        // render target, connected to cubemap texture face
        var renderTarget = new pc.RenderTarget({
            name: 'CubemapRenderer-Face' + i,
            colorBuffer: this.cubeMap,
            depth: this.depth,
            face: i,
            flipY: !this.app.graphicsDevice.isWebGPU
        });

        // create a child entity with the camera for this face
        var e = new pc.Entity("CubeMapCamera_" + i);
        e.addComponent('camera', {
            aspectRatio: 1,
            fov: 90,

            // cubemap will render all layers as setup on Entity's camera
            layers: camera.layers,

            // priority
            priority: camera.priority,

            // copy other camera properties
            clearColor: camera.clearColor,
            clearColorBuffer: camera.clearColorBuffer,
            clearDepthBuffer: camera.clearDepthBuffer,
            clearStencilBuffer: camera.clearStencilBuffer,
            farClip: camera.farClip,
            nearClip: camera.nearClip,
            frustumCulling: camera.frustumCulling,

            // this camera renders into texture target
            renderTarget: renderTarget
        });

        // add the camera as a child entity
        this.entity.addChild(e);

        // set up its rotation
        e.setRotation(cameraRotations[i]);

        // Before the first camera renders, trigger onCubemapPreRender event on the entity.
        if (i === 0) {
            e.camera.onPreRender = () => {
                this.entity.fire('onCubemapPreRender');
            };
        }

        // When last camera is finished rendering, trigger onCubemapPostRender event on the entity.
        // This can be listened to by the user, and the resulting cubemap can be further processed (e.g prefiltered)
        if (i === 5) {
            e.camera.onPostRender = () => {
                this.entity.fire('onCubemapPostRender');
            };
        }
    }
};
