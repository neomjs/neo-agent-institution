import Base            from '../../../node_modules/neo.mjs/src/canvas/Base.mjs';
import {PALETTES, rgb} from './fmPalette.mjs';

const hasRaf = typeof requestAnimationFrame === 'function';

/**
 * The one program: a point or line vertex carries its unit-space position, colour and size; the size
 * shrinks with depth so a far node reads far, and every fragment fades a little toward the ground.
 * The output is premultiplied, which is what an `alpha: true` canvas composites onto the pane's ground.
 * @type {Object}
 */
const SHADERS = {
    vertex: `#version 300 es
layout(location = 0) in vec3  aPos;
layout(location = 1) in vec3  aCol;
layout(location = 2) in float aSize;
uniform mat4  uMvp;
uniform float uScale;
out vec3  vCol;
out float vDepth;
void main() {
    gl_Position  = uMvp * vec4(aPos, 1.0);
    gl_PointSize = aSize * uScale / max(gl_Position.w, 0.2);
    vCol   = aCol;
    vDepth = gl_Position.w;
}`,
    fragment: `#version 300 es
precision mediump float;
in vec3  vCol;
in float vDepth;
uniform float uAlpha;
uniform float uRound;
out vec4 outColor;
void main() {
    float edge = 1.0;
    if (uRound > 0.5) {
        vec2  d  = gl_PointCoord - 0.5;
        float d2 = dot(d, d);
        if (d2 > 0.25) discard;
        edge = smoothstep(0.25, 0.16, d2);
    }
    float alpha = uAlpha * edge * clamp(1.6 - vDepth * 0.28, 0.4, 1.0);
    outColor = vec4(vCol * alpha, alpha);
}`
};

/**
 * Point sizes in drawing-buffer pixels at the reference scale, the beads that make the route read as a
 * ribbon rather than a hairline (WebGL draws a line one pixel wide), and the hover radius in CSS pixels.
 * @type {Object}
 */
const STYLE = {
    beadSize    : 24,
    beadsPerLeg : 18,
    citationSize: 40,
    itemSizeMax : 120,
    itemSizeMin : 62,
    pickRadius  : 14
};

/**
 * The camera's fit: the scene's bounding radius in units and the share of the surface it may fill
 * along the tighter axis, so a new scene or a resized surface frames the whole route.
 * @type {Object}
 */
const FIT = {radius: 0.95, fill: 0.86};

/**
 * @summary The observatory renderer — runs on the canvas worker and only draws. The App Worker hands it
 * a scene (nodes in unit space, edges and the route as node indices; today derived from the Golden Path
 * envelope, tomorrow the Brain's bounded scene feed) and it paints it as a WebGL2 scene in the theme's
 * ink: edges as quiet lines, nodes as round points sized by their weight, the route as a line strip
 * beaded into a ribbon. A frame is owed only to a change — a scene, the surface, the theme, the
 * camera — never to a clock: idle, the worker draws nothing. Drag orbits the camera, the wheel zooms,
 * and `pick` answers which node the pointer rests on. Nothing is ranked, merged or animated here.
 *
 * The picture's tone is the cockpit's currency: a current route draws in the signal, a withheld one —
 * the last known good route — in dim ink, and degraded, unavailable or unobserved states clear the
 * surface — the currency line above the canvas says why.
 *
 * @class AgentOS.canvas.Observatory
 * @extends Neo.canvas.Base
 * @singleton
 */
class Observatory extends Base {
    static config = {
        /**
         * @member {String} className='AgentOS.canvas.Observatory'
         * @protected
         */
        className: 'AgentOS.canvas.Observatory',
        /**
         * A transparent, premultiplied surface: the pane's ground shows through the cleared canvas.
         * @member {Object} contextAttributes={alpha: true, antialias: false, powerPreference: 'high-performance', premultipliedAlpha: true}
         */
        contextAttributes: {alpha: true, antialias: false, powerPreference: 'high-performance', premultipliedAlpha: true},
        /**
         * @member {String} contextType='webgl2'
         */
        contextType: 'webgl2',
        /**
         * Remote method access — the base's lifecycle set plus the scene entry, the hover question and the stats.
         * @member {Object} remote
         * @protected
         */
        remote: {
            app: [
                'clearGraph',
                'getStats',
                'initGraph',
                'pause',
                'pick',
                'resume',
                'setScene',
                'setTheme',
                'updateMouseState',
                'updateSize'
            ]
        },
        /**
         * @member {Boolean} singleton=true
         * @protected
         */
        singleton: true,
        /**
         * Drawing-buffer pixels per CSS pixel; the worker has no `devicePixelRatio`, so the host's usual
         * value is assumed.
         * @member {Number} dpr=2
         */
        dpr: 2
    }

    /**
     * The orbit camera: yaw and pitch in radians, the distance from the scene's origin in units, and
     * whether the pointer has taken it — an untouched camera re-fits to every new scene and surface.
     * @member {Object} camera={yaw: 0.7, pitch: 0.32, dist: 3, touched: false}
     */
    camera = {yaw: 0.7, pitch: 0.32, dist: 3, touched: false}
    /**
     * Frames drawn since the canvas arrived — the witness that idle draws none.
     * @member {Number} frames=0
     */
    frames = 0
    /**
     * The compiled program with its uniform locations, or `null` before the canvas arrives.
     * @member {Object|null} program=null
     */
    program = null
    /**
     * The last scene the App Worker handed over; `null` clears the surface.
     * @member {Object|null} scene=null
     */
    scene = null
    /**
     * The uploaded scene: a vertex array over the nodes, one over the route beads, the edge and route
     * index buffers — or `null` when there is nothing to draw.
     * @member {Object|null} surfaces=null
     */
    surfaces = null

    /**
     * The WebGL2 context the base class acquired for `contextType`.
     * @member {WebGL2RenderingContext|null} gl
     */
    get gl() {
        return this.context
    }

    /**
     * @summary Forgets the scene and every GL object with the canvas.
     */
    clearGraph() {
        this.dispose();
        super.clearGraph();
        this.program = null;
        this.scene   = null
    }

    /**
     * @summary Remote entry for the specs and the stats line: the camera, the surface, the counts, the frames.
     * @returns {Object}
     */
    getStats() {
        const me = this, {camera, gl, scene} = me;

        return {
            camera  : {...camera},
            canvas  : gl ? [gl.canvas.width, gl.canvas.height] : [0, 0],
            counts  : scene ? {nodes: scene.nodes.length, edges: scene.edges.length, route: scene.route.length} : null,
            currency: scene?.currency ?? null,
            frames  : me.frames,
            gpu     : me.gpu || null
        }
    }

    /**
     * @summary The base has acquired the context and sized the buffer: compile once, set the blend for
     * premultiplied output, upload whatever scene arrived first, and owe a frame.
     */
    onGraphMounted() {
        const me = this, {gl} = me, debug = gl.getExtension('WEBGL_debug_renderer_info');

        me.program = me.compile();
        me.gpu     = debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);

        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.disable(gl.DEPTH_TEST);

        me.upload();
        me.requestFrame()
    }

    /**
     * @summary The wheel zooms: the camera distance scales with the vertical delta, clamped to the
     * scene's useful range.
     * @param {Object} data
     */
    onWheel(data) {
        const me = this, delta = data.wheel?.deltaY || 0;

        me.camera.dist    = Math.min(9, Math.max(1.2, me.camera.dist * Math.exp(delta * 0.0015)));
        me.camera.touched = true;
        me.requestFrame()
    }

    /**
     * @summary The node under a canvas position, if any: the nearest whose projected centre lies within
     * the pick radius, projected against the current camera so a hover answers right after an orbit.
     * @param {Object} data
     * @param {Number} data.x Canvas-relative, CSS pixels
     * @param {Number} data.y
     * @returns {Object|null} `{id, kind, label, rank, score}`
     */
    pick({x, y}) {
        const me = this, {canvasSize, scene} = me;

        if (!scene || scene.empty || !canvasSize) {
            return null
        }

        const mvp = me.matrix(), {width, height} = canvasSize;
        let best = null, bestDistance = STYLE.pickRadius;

        scene.nodes.forEach(node => {
            const point = me.project(mvp, node, width, height), distance = point && Math.hypot(point[0] - x, point[1] - y);

            if (point && distance <= bestDistance) {
                bestDistance = distance;
                best         = node
            }
        });

        return best ? {id: best.id, kind: best.kind, label: best.label, rank: best.rank, score: best.score} : null
    }

    /**
     * @summary Owes one frame to the next animation slot; a frame already owed is not doubled.
     */
    requestFrame() {
        const me = this;

        if (me.canRender && !me.animationId) {
            me.animationId = hasRaf ? requestAnimationFrame(me.renderLoop) : setTimeout(me.renderLoop, 16)
        }
    }

    /**
     * @summary One frame: clear to the transparent ground, then edges, the route line, its beads and the
     * nodes. No frame is scheduled from here — the next one is owed by the next change.
     */
    render() {
        const me = this, {gl, program, surfaces} = me;

        me.animationId = null;

        if (!me.canRender) {
            return
        }

        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);

        if (program && surfaces) {
            gl.useProgram(program.id);
            gl.uniformMatrix4fv(program.uMvp, false, me.matrix());
            gl.uniform1f(program.uScale, Math.min(gl.canvas.width, gl.canvas.height) / 400);

            gl.bindVertexArray(surfaces.nodes.vao);
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, surfaces.edges.buffer);
            gl.uniform1f(program.uRound, 0);
            gl.uniform1f(program.uAlpha, 0.4);
            gl.drawElements(gl.LINES, surfaces.edges.count, gl.UNSIGNED_INT, 0);

            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, surfaces.route.buffer);
            gl.uniform1f(program.uAlpha, 0.9);
            gl.drawElements(gl.LINE_STRIP, surfaces.route.count, gl.UNSIGNED_INT, 0);

            gl.bindVertexArray(surfaces.beads.vao);
            gl.uniform1f(program.uRound, 1);
            gl.uniform1f(program.uAlpha, 0.55);
            gl.drawArrays(gl.POINTS, 0, surfaces.beads.count);

            gl.bindVertexArray(surfaces.nodes.vao);
            gl.uniform1f(program.uAlpha, 0.95);
            gl.drawArrays(gl.POINTS, 0, surfaces.nodes.count);
            gl.bindVertexArray(null)
        }

        me.frames++
    }

    /**
     * @summary Remote entry: the App Worker hands over a scene (or `null`); it uploads and owes a frame.
     * @param {Object} data
     * @param {Object|null} data.scene
     * @param {String} [data.windowId]
     */
    setScene({scene}) {
        const me = this;

        me.scene = scene ?? null;
        me.upload();
        me.fit();
        me.requestFrame()
    }

    /**
     * @summary Pointer reports orbit the camera while the primary button is held; the base keeps the state.
     * @param {Object} data
     */
    updateMouseState(data) {
        const me = this;

        super.updateMouseState(data);

        if (!data.leave && (me.mouse.buttons & 1) && (me.mouse.dx || me.mouse.dy)) {
            me.camera.yaw    += me.mouse.dx * 0.006;
            me.camera.pitch   = Math.min(1.45, Math.max(-1.45, me.camera.pitch + me.mouse.dy * 0.006));
            me.camera.touched = true;
            me.requestFrame()
        }
    }

    /**
     * @summary The theme changed: the palette re-uploads and the picture follows.
     * @param {Number} width
     * @param {Number} height
     */
    updateResources(width, height) {
        this.upload();
        this.requestFrame()
    }

    /**
     * @summary Sizes the drawing buffer at the configured pixel ratio and the viewport with it.
     * @param {Object} size
     * @param {Number} size.width CSS pixels
     * @param {Number} size.height
     */
    updateSize(size) {
        const me = this, {dpr, gl} = me;

        me.canvasSize = size;

        if (gl) {
            const width = Math.max(1, Math.floor(size.width * dpr)), height = Math.max(1, Math.floor(size.height * dpr));

            gl.canvas.width  = width;
            gl.canvas.height = height;
            gl.viewport(0, 0, width, height);
            me.fit();
            me.requestFrame()
        }
    }

    /**
     * @summary Frames the scene: an untouched camera moves to the distance at which the scene's
     * bounding sphere fills its share of the surface's tighter axis. A pointer that took the camera
     * keeps it.
     * @protected
     */
    fit() {
        const me = this, {camera, gl} = me;

        if (gl && !camera.touched) {
            const
                tan    = Math.tan(0.45),
                aspect = gl.canvas.width / gl.canvas.height,
                // the vertical field of view is the projection's own; the horizontal one is it times
                // the aspect, so the tighter axis is the one with the smaller tangent
                reach  = Math.min(tan, tan * aspect) * FIT.fill;

            camera.dist = FIT.radius / reach
        }
    }

    /**
     * @summary Compiles and links the one program.
     * @returns {Object} `{id, uAlpha, uMvp, uRound, uScale}`
     * @protected
     */
    compile() {
        const
            me     = this,
            {gl}   = me,
            shader = (type, source) => {
                const id = gl.createShader(type);

                gl.shaderSource(id, source);
                gl.compileShader(id);

                if (!gl.getShaderParameter(id, gl.COMPILE_STATUS)) {
                    throw new Error(`${me.className}: ${gl.getShaderInfoLog(id)}`)
                }

                return id
            },
            id = gl.createProgram();

        gl.attachShader(id, shader(gl.VERTEX_SHADER, SHADERS.vertex));
        gl.attachShader(id, shader(gl.FRAGMENT_SHADER, SHADERS.fragment));
        gl.linkProgram(id);

        if (!gl.getProgramParameter(id, gl.LINK_STATUS)) {
            throw new Error(`${me.className}: ${gl.getProgramInfoLog(id)}`)
        }

        return {id, ...Object.fromEntries(['uAlpha', 'uMvp', 'uRound', 'uScale'].map(name => [name, gl.getUniformLocation(id, name)]))}
    }

    /**
     * @summary Deletes the uploaded scene's GL objects, if any.
     * @protected
     */
    dispose() {
        const {gl, surfaces} = this;

        if (gl && surfaces) {
            ['beads', 'nodes'].forEach(key => {
                surfaces[key].buffers.forEach(buffer => gl.deleteBuffer(buffer));
                gl.deleteVertexArray(surfaces[key].vao)
            });
            ['edges', 'route'].forEach(key => gl.deleteBuffer(surfaces[key].buffer))
        }

        this.surfaces = null
    }

    /**
     * @summary An index buffer over the node vertex array.
     * @param {Uint32Array} indices
     * @returns {{buffer: WebGLBuffer, count: Number}}
     * @protected
     */
    indexBuffer(indices) {
        const {gl} = this, buffer = gl.createBuffer();

        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);

        return {buffer, count: indices.length}
    }

    /**
     * @summary The column-major model-view-projection of the current camera over the buffer's aspect.
     * @returns {Float32Array}
     * @protected
     */
    matrix() {
        const
            me     = this,
            {gl}   = me,
            {yaw, pitch, dist} = me.camera,
            aspect = gl.canvas.width / gl.canvas.height,
            f      = 1 / Math.tan(0.45),
            near   = 0.05,
            far    = 40,
            r      = 1 / (near - far),
            P      = [f / aspect, 0, 0, 0,  0, f, 0, 0,  0, 0, (near + far) * r, -1,  0, 0, 2 * near * far * r, 0],
            cy     = Math.cos(yaw),
            sy     = Math.sin(yaw),
            cp     = Math.cos(pitch),
            sp     = Math.sin(pitch),
            V      = [cy, sy * sp, -sy * cp, 0,  0, cp, sp, 0,  sy, -cy * sp, cy * cp, 0,  0, 0, -dist, 1],
            M      = new Float32Array(16);

        for (let i = 0; i < 4; i++) {
            for (let j = 0; j < 4; j++) {
                M[j * 4 + i] = P[i] * V[j * 4] + P[4 + i] * V[j * 4 + 1] + P[8 + i] * V[j * 4 + 2] + P[12 + i] * V[j * 4 + 3]
            }
        }

        return M
    }

    /**
     * @summary A node's centre on the surface in CSS pixels, or `null` behind the camera.
     * @param {Float32Array} M The model-view-projection.
     * @param {Object} node `{x, y, z}`
     * @param {Number} width The surface width in CSS pixels.
     * @param {Number} height
     * @returns {Number[]|null} `[x, y]`
     * @protected
     */
    project(M, {x, y, z}, width, height) {
        const
            cx = M[0] * x + M[4] * y + M[8]  * z + M[12],
            cy = M[1] * x + M[5] * y + M[9]  * z + M[13],
            cw = M[3] * x + M[7] * y + M[11] * z + M[15];

        return cw <= 0 ? null : [(cx / cw * 0.5 + 0.5) * width, (0.5 - cy / cw * 0.5) * height]
    }

    /**
     * @summary Uploads the current scene in the theme's ink: nodes and their colours and sizes, the
     * edge and route indices, and the beads sampled along the route's legs. Nothing to draw leaves
     * `surfaces` null.
     * @protected
     */
    upload() {
        const me = this, {gl, scene} = me;

        me.dispose();

        if (!gl || !me.program || !scene || scene.empty) {
            return
        }

        const
            palette       = PALETTES[me.theme] || PALETTES.dark,
            itemColor     = rgb(scene.currency === 'current' ? palette.signal : palette.inkDim),
            citationColor = rgb(palette.inkDim),
            count         = scene.nodes.length,
            positions     = new Float32Array(count * 3),
            colors        = new Float32Array(count * 3),
            sizes         = new Float32Array(count),
            legs          = Math.max(0, scene.route.length - 1),
            beadCount     = legs * STYLE.beadsPerLeg,
            beadPositions = new Float32Array(beadCount * 3),
            beadColors    = new Float32Array(beadCount * 3),
            beadSizes     = new Float32Array(beadCount).fill(STYLE.beadSize);

        scene.nodes.forEach((node, index) => {
            const item = node.kind === 'item';

            positions.set([node.x, node.y, node.z], index * 3);
            colors.set(item ? itemColor : citationColor, index * 3);
            sizes[index] = item ? STYLE.itemSizeMin + node.weight * (STYLE.itemSizeMax - STYLE.itemSizeMin) : STYLE.citationSize
        });

        for (let leg = 0; leg < legs; leg++) {
            const a = scene.nodes[scene.route[leg]], b = scene.nodes[scene.route[leg + 1]];

            for (let k = 0; k < STYLE.beadsPerLeg; k++) {
                const t = (k + 0.5) / STYLE.beadsPerLeg, index = leg * STYLE.beadsPerLeg + k;

                beadPositions.set([a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t], index * 3);
                beadColors.set(itemColor, index * 3)
            }
        }

        me.surfaces = {
            beads: me.vertexArray(beadPositions, beadColors, beadSizes),
            nodes: me.vertexArray(positions, colors, sizes),
            edges: me.indexBuffer(new Uint32Array(scene.edges.flat())),
            route: me.indexBuffer(new Uint32Array(scene.route))
        };

        gl.bindVertexArray(null)
    }

    /**
     * @summary A vertex array with the program's three attributes uploaded once.
     * @param {Float32Array} positions
     * @param {Float32Array} colors
     * @param {Float32Array} sizes
     * @returns {{vao: WebGLVertexArrayObject, buffers: WebGLBuffer[], count: Number}}
     * @protected
     */
    vertexArray(positions, colors, sizes) {
        const {gl} = this, vao = gl.createVertexArray(), buffers = [];

        gl.bindVertexArray(vao);

        [[0, positions, 3], [1, colors, 3], [2, sizes, 1]].forEach(([location, data, size]) => {
            const buffer = gl.createBuffer();

            gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
            gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
            gl.enableVertexAttribArray(location);
            gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
            buffers.push(buffer)
        });

        return {vao, buffers, count: sizes.length}
    }
}

export default Neo.setupClass(Observatory);
