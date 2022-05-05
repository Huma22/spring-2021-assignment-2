import layerVertShaderSrc from './layerVert.glsl.js';
import layerFragShaderSrc from './layerFrag.glsl.js';
import shadowFragShaderSrc from './shadowFrag.glsl.js';
import shadowVertShaderSrc from './shadowVert.glsl.js';
import depthFragShaderSrc from './depthFrag.glsl.js';
import depthVertShaderSrc from './depthVert.glsl.js';

var gl;

var layers = null
var renderToScreen = null;
var fbo = null;
var currRotate = 0;
var currLightRotate = 0;
var currLightDirection = null;
var currZoom = 0;
var currProj = 'perspective';
var currResolution = 2048;
var displayShadowmap = false;

var modelMatrix = null;
var viewMatrix = null;
var projectionMatrix = null;
var lightViewMatrix = null;
var lightProjectionMatrix = null;

/*
    FBO
*/
class FBO {
    constructor(size) {
        // TODO: Create FBO and texture with size
        this.size = size;
        this.texture = createTexture2D(gl, this.size, this.size, gl.DEPTH_COMPONENT32F, 0, gl.DEPTH_COMPONENT, gl.FLOAT, null, gl.NEAREST, gl.NEAREST, gl.CLAMP_TO_EDGE, gl.CLAMP_TO_EDGE);
        this.fbo = createFBO(gl, gl.DEPTH_ATTACHMENT, this.texture);
    }

    start() {
        // TODO: Bind FBO, set viewport to size, clear depth buffer 
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
        gl.viewport(0, 0, this.size, this.size);
        gl.clear(gl.DEPTH_BUFFER_BIT);
    }

    stop() {
        // TODO: unbind FBO 
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
}

/*
    Shadow map
*/
class ShadowMapProgram {
    constructor() {
        this.vertexShader = createShader(gl, gl.VERTEX_SHADER, shadowVertShaderSrc);
        this.fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, shadowFragShaderSrc);
        this.program = createProgram(gl, this.vertexShader, this.fragmentShader);

        this.posAttribLoc = gl.getAttribLocation(this.program, "position");
        this.colorAttribLoc = gl.getUniformLocation(this.program, "uColor");
        this.modelLoc = gl.getUniformLocation(this.program, "uModel");
        this.projectionLoc = gl.getUniformLocation(this.program, "uProjection");
        this.viewLoc = gl.getUniformLocation(this.program, "uView");
        this.lightViewLoc = gl.getUniformLocation(this.program, "uLightView");
        this.lightProjectionLoc = gl.getUniformLocation(this.program, "uLightProjection");
        this.samplerLoc = gl.getUniformLocation(this.program, "uSampler");
        this.hasNormalsAttribLoc = gl.getUniformLocation(this.program, "uHasNormals");
        this.lightDirAttribLoc = gl.getUniformLocation(this.program, "uLightDir");
    }

    use() {
        // TODO: use program 
        gl.useProgram(this.program);
    }
}

/*
    Render to screen program
*/
class RenderToScreenProgram {
    constructor() {
        this.vertexShader = createShader(gl, gl.VERTEX_SHADER, depthVertShaderSrc);
        this.fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, depthFragShaderSrc);

        this.program = createProgram(gl, this.vertexShader, this.fragmentShader);
        this.posAttribLoc = gl.getAttribLocation(this.program, "position");
        this.samplerLoc = gl.getUniformLocation(this.program, "uSampler");

        // TODO: Create quad VBO and VAO
        this.vert = [-1, -1, 0, 1, -1, 0, 1, 1, 0, 1, 1, 0, -1, 1, 0, -1, -1, 0];
        this.vertexBuffer = createBuffer(gl, gl.ARRAY_BUFFER, new Float32Array(this.vert));
        this.vao = createVAO(gl, this.posAttribLoc, this.vertexBuffer);
    }

    draw(texture) {
        // TODO: Render quad and display texture
        gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
        gl.useProgram(this.program);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.uniform1i(this.samplerLoc, 0);
        gl.bindVertexArray(this.vao);
        gl.drawElements(gl.TRIANGLES, this.vert.length, gl.UNSIGNED_SHORT, 0);
    }

}

/*
    Layer program
*/
class LayerProgram {
    constructor() {
        this.vertexShader = createShader(gl, gl.VERTEX_SHADER, layerVertShaderSrc);
        this.fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, layerFragShaderSrc);
        this.program = createProgram(gl, this.vertexShader, this.fragmentShader);

        this.posAttribLoc = gl.getAttribLocation(this.program, "position");
        this.colorAttribLoc = gl.getUniformLocation(this.program, "uColor");
        this.modelLoc = gl.getUniformLocation(this.program, "uModel");
        this.projectionLoc = gl.getUniformLocation(this.program, "uProjection");
        this.viewLoc = gl.getUniformLocation(this.program, "uView");
    }

    use() {
        gl.useProgram(this.program);
    }
}


/*
    Collection of layers
*/
class Layers {
    constructor() {
        this.layers = {};
        this.centroid = [0, 0, 0];
    }

    addLayer(name, vertices, indices, color, normals) {
        if (normals == undefined)
            normals = null;
        var layer = new Layer(vertices, indices, color, normals);
        layer.init();
        this.layers[name] = layer;
        this.centroid = this.getCentroid();
    }

    removeLayer(name) {
        delete this.layers[name];
    }

    draw(modelMatrix, viewMatrix, projectionMatrix, lightViewMatrix = null, lightProjectionMatrix = null, shadowPass = false, texture = null) {
        for (var layer in this.layers) {
            if (layer == 'surface') {
                gl.polygonOffset(1, 1);
            } else {
                gl.polygonOffset(0, 0);
            }
            this.layers[layer].draw(modelMatrix, viewMatrix, projectionMatrix, lightViewMatrix, lightProjectionMatrix, shadowPass, texture);
        }
    }


    getCentroid() {
        var sum = [0, 0, 0];
        var numpts = 0;
        for (var layer in this.layers) {
            numpts += this.layers[layer].vertices.length / 3;
            for (var i = 0; i < this.layers[layer].vertices.length; i += 3) {
                var x = this.layers[layer].vertices[i];
                var y = this.layers[layer].vertices[i + 1];
                var z = this.layers[layer].vertices[i + 2];

                sum[0] += x;
                sum[1] += y;
                sum[2] += z;
            }
        }
        return [sum[0] / numpts, sum[1] / numpts, sum[2] / numpts];
    }
}

/*
    Layers without normals (water, parks, surface)
*/
class Layer {
    constructor(vertices, indices, color, normals = null) {
        this.vertices = vertices;
        this.indices = indices;
        this.color = color;
        this.normals = normals;

        this.hasNormals = false;
        if (this.normals) {
            this.hasNormals = true;
        }
    }

    init() {
        this.layerProgram = new LayerProgram();
        this.shadowProgram = new ShadowMapProgram();

        this.vertexBuffer = createBuffer(gl, gl.ARRAY_BUFFER, new Float32Array(this.vertices));
        this.indexBuffer = createBuffer(gl, gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(this.indices));

        if (this.normals) {
            this.normalBuffer = createBuffer(gl, gl.ARRAY_BUFFER, new Float32Array(this.normals));
            this.vao = createVAO(gl, 0, this.vertexBuffer, 1, this.normalBuffer);
        } else {
            this.vao = createVAO(gl, 0, this.vertexBuffer);
        }
    }

    draw(modelMatrix, viewMatrix, projectionMatrix, lightViewMatrix, lightProjectionMatrix, shadowPass = false, texture = null) {
        // TODO: Handle shadow pass (using ShadowMapProgram) and regular pass (using LayerProgram)
        if (shadowPass) {
            //use ShadowMapProgram
            gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);

            this.shadowProgram.use();

            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, texture);
            gl.uniform1i(this.shadowProgram.samplerLoc, 0);

            gl.uniform4fv(this.shadowProgram.colorAttribLoc, this.color);
            gl.uniform1i(this.shadowProgram.hasNormalsAttribLoc, this.hasNormals);
            gl.uniformMatrix4fv(this.shadowProgram.modelLoc, false, new Float32Array(modelMatrix));
            gl.uniformMatrix4fv(this.shadowProgram.projectionLoc, false, new Float32Array(projectionMatrix));
            gl.uniformMatrix4fv(this.shadowProgram.viewLoc, false, new Float32Array(viewMatrix));
            gl.uniformMatrix4fv(this.shadowProgram.lightViewLoc, false, new Float32Array(lightViewMatrix));
            gl.uniformMatrix4fv(this.shadowProgram.lightProjectionLoc, false, new Float32Array(lightProjectionMatrix));
            gl.uniform3fv(this.shadowProgram.lightDirAttribLoc, currLightDirection);

            gl.bindVertexArray(this.vao);
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
            gl.drawElements(gl.TRIANGLES, this.indices.length, gl.UNSIGNED_INT, 0);
        } else {
            //use LayerProgram
            this.layerProgram.use();

            gl.uniform4fv(this.layerProgram.colorAttribLoc, this.color);
            gl.uniformMatrix4fv(this.layerProgram.modelLoc, false, new Float32Array(modelMatrix));
            gl.uniformMatrix4fv(this.layerProgram.projectionLoc, false, new Float32Array(projectionMatrix));
            gl.uniformMatrix4fv(this.layerProgram.viewLoc, false, new Float32Array(viewMatrix));

            gl.bindVertexArray(this.vao);
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
            gl.drawElements(gl.TRIANGLES, this.indices.length, gl.UNSIGNED_INT, 0);
        }
    }
}

/*
    Event handlers
*/
window.updateRotate = function() {
    currRotate = parseInt(document.querySelector("#rotate").value);
    updateViewMatrix(currRotate);
    updateModelMatrix(currRotate);
    updateProjectionMatrix();
}

window.updateLightRotate = function() {
    currLightRotate = parseInt(document.querySelector("#lightRotate").value);
    updateLightViewMatrix(currLightRotate);
    updateLightProjectionMatrix();
}

window.updateZoom = function() {
    currZoom = parseFloat(document.querySelector("#zoom").value);
}

window.updateProjection = function() {
    currProj = document.querySelector("#projection").value;
}

window.displayShadowmap = function(e) {
    displayShadowmap = e.checked;
}

/*
    File handler
*/
window.handleFile = function(e) {
    var reader = new FileReader();
    reader.onload = function(evt) {
        var parsed = JSON.parse(evt.target.result);
        for (var layer in parsed) {
            var aux = parsed[layer];
            layers.addLayer(layer, aux['coordinates'], aux['indices'], aux['color'], aux['normals']);
        }
    }
    reader.readAsText(e.files[0]);
}

/*
    Update transformation matrices
*/
function updateModelMatrix(centroid) {
    modelMatrix = identityMatrix();
    return identityMatrix();
}

function updateProjectionMatrix() {
    // TODO: Projection matrix 
    projectionMatrix = identityMatrix();
    var aspect = window.innerWidth / window.innerHeight;
    if (currProj == 'perspective') {
        projectionMatrix = perspectiveMatrix(45 * Math.PI / 180.0, aspect, 1, 50000);
    } else {
        var maxzoom = 5000;
        var size = maxzoom - (currZoom / 100.0) * maxzoom * 0.99;
        projectionMatrix = orthographicMatrix(-aspect * size, aspect * size, -1 * size, 1 * size, -1, 50000);
    }
    return projectionMatrix;
}

function updateViewMatrix(centroid) {
    // TODO: View matrix
    viewMatrix = identityMatrix();
    var radRotate = currRotate * Math.PI / 180.0;
    var maxzoom = 5000;
    var radius = maxzoom - (currZoom / 100.0) * maxzoom * 0.99;
    var x = radius * Math.cos(radRotate);
    var y = radius * Math.sin(radRotate);
    viewMatrix = lookAt(add(centroid, [x, y, radius]), centroid, [0, 0, 1]);
    return viewMatrix;
}

function updateLightViewMatrix(centroid) {
    lightViewMatrix = identityMatrix();
    var radRotate = currLightRotate * Math.PI / 180.0;
    var radius = 500;
    var x = radius * Math.cos(radRotate);
    var y = radius * Math.sin(radRotate);
    var position = add(centroid, [x, y, radius]);
    lightViewMatrix = lookAt(position, centroid, [0, 0, 1]);
    currLightDirection = normalize(sub(position, centroid));
    return lightViewMatrix;
}

function updateLightProjectionMatrix() {
    lightProjectionMatrix = orthographicMatrix(-fbo.size * 2, fbo.size * 2, -fbo.size * 2, fbo.size * 2, -2000, 5000);
    return lightProjectionMatrix;
}

/*
    Main draw function (should call layers.draw)
*/
function draw() {

    gl.clearColor(190 / 255, 210 / 255, 215 / 255, 1);
    gl.clearDepth(1.0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    modelMatrix = updateModelMatrix(layers.centroid);
    viewMatrix = updateViewMatrix(layers.centroid);
    projectionMatrix = updateProjectionMatrix(identityMatrix());

    lightViewMatrix = updateLightViewMatrix(identityMatrix());
    lightProjectionMatrix = updateLightProjectionMatrix(layers.centroid);

    fbo.start();
    layers.draw(modelMatrix, lightViewMatrix, lightProjectionMatrix);
    fbo.stop()

    if (!displayShadowmap) {
        gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
        layers.draw(modelMatrix, viewMatrix, projectionMatrix, lightViewMatrix, lightProjectionMatrix, true, fbo.texture);
    } else {
        gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
        renderToScreen.draw(fbo.texture);
    }

    requestAnimationFrame(draw);

}

/*
    Initialize everything
*/
function initialize() {

    var canvas = document.querySelector("#glcanvas");
    canvas.width = canvas.clientWidth;
    canvas.height = canvas.clientHeight;

    gl = canvas.getContext("webgl2");

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LESS);

    gl.enable(gl.POLYGON_OFFSET_FILL);

    layers = new Layers();
    fbo = new FBO(currResolution);
    renderToScreen = new RenderToScreenProgram();

    window.requestAnimationFrame(draw);

}


window.onload = initialize;