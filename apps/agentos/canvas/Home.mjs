import Base               from '../../../node_modules/neo.mjs/src/canvas/Base.mjs';
import {PALETTES, rgb}     from './fmPalette.mjs';

const
    hasRaf  = typeof requestAnimationFrame === 'function',
    BUCKETS = 4,    // alpha steps a link fades through, one stroke each
    GLOW    = 64,   // px, the side of a lit mark's glow sprite
    LAYERS  = 3,    // depth layers, far to near
    PAIRS   = 1024, // links per bucket and frame
    RIPPLES = 4,    // ripples alive at once
    STRIDE  = 6,    // a mote: x, y, vx, vy, layer, phase
    TAU     = Math.PI * 2;

/**
 * @summary A `#rrggbb` colour at an alpha, as a CSS colour.
 * @param {String} hex
 * @param {Number} alpha
 * @returns {String}
 */
function rgba(hex, alpha) {
    const [r, g, b] = rgb(hex).map(channel => Math.round(channel * 255));

    return `rgba(${r},${g},${b},${alpha})`
}

/**
 * @summary A seeded PRNG (mulberry32): the field's rest layout is a function of its size alone, so a still frame
 * draws the same field on every run.
 * @param {Number} seed
 * @returns {Function} Returns floats in [0, 1)
 */
function mulberry32(seed) {
    return () => {
        seed = seed + 0x6D2B79F5 | 0;

        let t = Math.imul(seed ^ seed >>> 15, 1 | seed);

        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;

        return ((t ^ t >>> 14) >>> 0) / 4294967296
    }
}

/**
 * @summary Home's field, drawn on the canvas worker in the cockpit's ink. Motes on three depth layers drift on a
 * slow current and link where they pass close; the pointer parts them and shifts the layers apart, and a click
 * sends a ripple through them. The field claims nothing: it stays ambient until the App Worker hands it the team
 * the roster read answers, `{total, up}`. Then one mark per rostered agent rides a ring through the field, the marks
 * of the agents that are up spread evenly around it, glowing and reaching into the motes they pass.
 *
 * A still field, the host's reduced-motion preference, is one frame at its seeded rest layout, drawn again only when
 * an input changes (the size, the theme, the team); a moving field runs the loop. `getStats` answers what the specs
 * read: the frames drawn, the motes, the marks, stillness, the theme and the size.
 *
 * @class AgentOS.canvas.Home
 * @extends Neo.canvas.Base
 * @singleton
 */
class Home extends Base {
    static config = {
        /**
         * @member {String} className='AgentOS.canvas.Home'
         * @protected
         */
        className: 'AgentOS.canvas.Home',
        /**
         * The field's geometry, in CSS pixels and seconds: one mote per `density` px² on screen, a visible target
         * clamped to `moteMin`..`moteMax`, seeded across the whole wrap domain so the current carries as many motes in
         * as out; the count on screen drifts around that target rather than holding it on every frame. Never more
         * than `moteCap` in all, which bounds the links' pairwise work, and none on a surface without area. Motes link
         * within `link`, a lit mark reaches `markLink`; the current carries each layer at its `speed`, draws it at
         * its `radius` and shifts it by up to its `parallax` with the pointer; the pointer parts the motes within
         * `reach`, clearing a core of the `part` share of it and spreading them evenly over the rest; the ring turns
         * `orbit` rad/s; a ripple runs at `speed` for `life`, lifting what its `band` crosses by up to `lift`.
         * Parting and ripples move where a mote is drawn, never where it is, so neither leaves a hole behind. The
         * field goes quiet under the rects the host names, softened over `feather`.
         * @member {Object} field
         */
        field: {
            density : 6000,
            feather : 10,
            link    : 120,
            markLink: 140,
            moteCap : 320,
            moteMax : 200,
            moteMin : 60,
            orbit   : 0.035,
            parallax: [4, 9, 16],
            part    : 0.5,
            radius  : [0.9, 1.4, 2.1],
            reach   : 130,
            ripple  : {band: 26, life: 1.6, lift: 22, speed: 260},
            seed    : 0x5eed,
            speed   : [5, 9, 15]
        },
        /**
         * The field's ink per skin: the links' strongest alpha, the motes' alpha by layer (far to near), the
         * strength of a lit mark's glow, and of the signal's haze at the ring's heart. The dark skin adds light
         * where marks glow, the light skin lays it over.
         * @member {Object} fieldStyle
         */
        fieldStyle: {
            dark : {glow: 0.55, haze: 0.08, link: 0.34, motes: [0.3,  0.5, 0.75]},
            light: {glow: 0.35, haze: 0.06, link: 0.4,  motes: [0.24, 0.4, 0.6]}
        },
        /**
         * Remote method access: the base's set plus the team, the motion preference, the quiet rects and the stats.
         * @member {Object} remote={app: ['getStats', 'setMotion', 'setQuiet', 'setTeam']}
         * @protected
         */
        remote: {
            app: ['getStats', 'setMotion', 'setQuiet', 'setTeam']
        },
        /**
         * @member {Boolean} singleton=true
         * @protected
         */
        singleton: true
    }

    /**
     * Where each mote is drawn this frame, `x, y` per mote: its place plus its layer's parallax, the pointer's parting
     * and the ripples' lift.
     * @member {Float32Array|null} drawn=null
     */
    drawn = null
    /**
     * Frames drawn since the worker loaded the renderer.
     * @member {Number} frames=0
     */
    frames = 0
    /**
     * A lit mark's glow, drawn once per theme, or `null` on a host without `OffscreenCanvas`.
     * @member {OffscreenCanvas|null} glow=null
     */
    glow = null
    /**
     * When the last frame stepped, or `0` when the next one steps by nothing.
     * @member {Number} lastTime=0
     */
    lastTime = 0
    /**
     * Each mark's angle on the ring.
     * @member {Float32Array|null} markAngles=null
     */
    markAngles = null
    /**
     * Each mark's drawn position, `x, y` per mark.
     * @member {Float32Array|null} markXY=null
     */
    markXY = null
    /**
     * The motes the field holds.
     * @member {Number} moteCount=0
     */
    moteCount = 0
    /**
     * The motes, {@link STRIDE} floats each: `x, y, vx, vy, layer, phase`.
     * @member {Float32Array|null} motes=null
     */
    motes = null
    /**
     * Each layer's parallax shift, `x, y` per layer.
     * @member {Float32Array} offsets
     */
    offsets = new Float32Array(LAYERS * 2)
    /**
     * The links of the frame being drawn, by alpha bucket: pairs of indices.
     * @member {Uint16Array} pairs
     */
    pairs = new Uint16Array(BUCKETS * PAIRS * 2)
    /**
     * How many pairs each bucket holds.
     * @member {Uint16Array} pairCounts
     */
    pairCounts = new Uint16Array(BUCKETS)
    /**
     * How strongly the pointer parts the field, easing to `1` while it is over the surface and back to `0` after it
     * leaves, around the last place it was: `strength, x, y`.
     * @member {Float32Array} parting
     */
    parting = new Float32Array(3)
    /**
     * The rects the field stays out of, canvas-relative in CSS pixels: the hero's lines, so no mote or link sits in
     * their letters or their leading.
     * @member {Object[]} quiet=[]
     */
    quiet = []
    /**
     * The ring the marks ride and the haze centres on, for the current size: `{cx, cy, rx, ry}`.
     * @member {Object|null} ring=null
     */
    ring = null
    /**
     * The ripples, `x, y, age` each; a negative age is a free slot.
     * @member {Float32Array} ripples
     */
    ripples = new Float32Array(RIPPLES * 3).fill(-1)
    /**
     * Whether the field is still: `true` until the host says it allows motion.
     * @member {Boolean} still=true
     */
    still = true
    /**
     * The team the marks draw, `{total, up}`, or `null` while the roster has not answered.
     * @member {Object|null} team=null
     */
    team = null

    /**
     * @summary Whether the mark at a ring place is lit: `up` of `total` places, spread evenly around the ring.
     * @param {Number} index
     * @param {Number} total
     * @param {Number} up
     * @returns {Boolean}
     */
    static isLit(index, total, up) {
        return Math.floor((index + 1) * up / total) > Math.floor(index * up / total)
    }

    /**
     * @summary A mark's radius: a small team draws large marks, a large one smaller, so the ring never crowds.
     * @param {Number} total
     * @returns {Number} CSS pixels
     */
    static markRadius(total) {
        return Math.min(5.5, Math.max(2.5, 44 / Math.sqrt(total)))
    }

    /**
     * @summary Forgets the field with the canvas; the host hands its inputs over again once a canvas returns.
     */
    clearGraph() {
        const me = this;

        super.clearGraph();
        me.lastTime   = 0;
        me.markAngles = null;
        me.markXY     = null;
        me.moteCount  = 0;
        me.motes      = null;
        me.ring       = null;
        me.still      = true;
        me.team       = null;
        me.drawn      = null;
        me.parting.fill(0);
        me.quiet      = [];
        me.ripples.fill(-1)
    }

    /**
     * @summary How many motes the last frame drew inside the surface.
     * @returns {Number}
     */
    countVisible() {
        const {canvasSize, drawn, moteCount} = this;

        let count = 0;

        if (drawn && canvasSize) {
            for (let i = 0; i < moteCount; i++) {
                const x = drawn[i * 2], y = drawn[i * 2 + 1];

                x >= 0 && x <= canvasSize.width && y >= 0 && y <= canvasSize.height && count++
            }
        }

        return count
    }

    /**
     * @summary Draws one frame at the motes' drawn places: the links, the motes by layer and the ripples. Then the
     * field goes quiet under the hero's lines, the haze fills in beneath it, and the marks go on top, so no mark is
     * dimmed.
     */
    draw() {
        const
            me      = this,
            ctx     = me.context,
            size    = me.canvasSize,
            palette = PALETTES[me.theme] || PALETTES.dark,
            style   = me.fieldStyle[me.theme] || me.fieldStyle.dark,
            ratio   = size.devicePixelRatio || 1;

        ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
        ctx.clearRect(0, 0, size.width, size.height);

        me.placeMotes();
        me.drawLinks(ctx, palette, style);
        me.drawMotes(ctx, palette, style);
        me.drawRipples(ctx, palette);
        me.quiet.length && me.drawQuiet(ctx);

        if (me.gradients.haze) {
            ctx.globalAlpha              = 1;
            ctx.globalCompositeOperation = 'destination-over';
            ctx.fillStyle                = me.gradients.haze;
            ctx.fillRect(0, 0, size.width, size.height);
            ctx.globalCompositeOperation = 'source-over'
        }

        me.team && me.drawMarks(ctx, palette, style);

        ctx.globalAlpha              = 1;
        ctx.globalCompositeOperation = 'source-over';
        me.frames++
    }

    /**
     * @summary Links the motes that pass close, on the same layer or a neighbouring one, fading with distance: the
     * pairs gather into alpha buckets first, so a frame strokes once per bucket.
     * @param {OffscreenCanvasRenderingContext2D} ctx
     * @param {Object} palette
     * @param {Object} style
     */
    drawLinks(ctx, palette, style) {
        const
            me    = this,
            {drawn, field, motes, moteCount, pairCounts, pairs} = me,
            link2 = field.link * field.link;

        pairCounts.fill(0);

        for (let i = 0; i < moteCount; i++) {
            const
                la = motes[i * STRIDE + 4],
                ax = drawn[i * 2],
                ay = drawn[i * 2 + 1];

            for (let j = i + 1; j < moteCount; j++) {
                const lb = motes[j * STRIDE + 4];

                if (Math.abs(la - lb) < 2) {
                    const
                        dx = drawn[j * 2]     - ax,
                        dy = drawn[j * 2 + 1] - ay,
                        d2 = dx * dx + dy * dy;

                    if (d2 < link2) {
                        const bucket = Math.min(BUCKETS - 1, (1 - Math.sqrt(d2) / field.link) * BUCKETS | 0), n = pairCounts[bucket];

                        if (n < PAIRS) {
                            pairs[(bucket * PAIRS + n) * 2]     = i;
                            pairs[(bucket * PAIRS + n) * 2 + 1] = j;
                            pairCounts[bucket]                  = n + 1
                        }
                    }
                }
            }
        }

        ctx.lineWidth   = 0.7;
        ctx.strokeStyle = palette.inkDim;

        for (let bucket = 0; bucket < BUCKETS; bucket++) {
            const count = pairCounts[bucket];

            if (count) {
                ctx.globalAlpha = style.link * (bucket + 1) / BUCKETS;
                ctx.beginPath();

                for (let n = 0; n < count; n++) {
                    const
                        a = pairs[(bucket * PAIRS + n) * 2]     * 2,
                        b = pairs[(bucket * PAIRS + n) * 2 + 1] * 2;

                    ctx.moveTo(drawn[a], drawn[a + 1]);
                    ctx.lineTo(drawn[b], drawn[b + 1])
                }

                ctx.stroke()
            }
        }
    }

    /**
     * @summary The team's marks: each lit mark reaches into the motes within its reach, glows and holds a solid
     * core; the others are hollow rings of the same size, so the eye counts every rostered agent.
     * @param {OffscreenCanvasRenderingContext2D} ctx
     * @param {Object} palette
     * @param {Object} style
     */
    drawMarks(ctx, palette, style) {
        const
            me     = this,
            {drawn, field, glow, markXY, moteCount, time} = me,
            {total, up} = me.team,
            reach2 = field.markLink * field.markLink,
            radius = Home.markRadius(total);

        ctx.lineWidth   = 0.8;
        ctx.strokeStyle = palette.signal;

        for (let i = 0; i < total; i++) {
            if (Home.isLit(i, total, up)) {
                const x = markXY[i * 2], y = markXY[i * 2 + 1];

                for (let m = 0; m < moteCount; m++) {
                    const
                        dx = drawn[m * 2]     - x,
                        dy = drawn[m * 2 + 1] - y,
                        d2 = dx * dx + dy * dy;

                    if (d2 < reach2) {
                        ctx.globalAlpha = 0.5 * (1 - Math.sqrt(d2) / field.markLink);
                        ctx.beginPath();
                        ctx.moveTo(x, y);
                        ctx.lineTo(x + dx, y + dy);
                        ctx.stroke()
                    }
                }
            }
        }

        ctx.globalCompositeOperation = me.theme === 'light' ? 'source-over' : 'lighter';

        for (let i = 0; glow && i < total; i++) {
            if (Home.isLit(i, total, up)) {
                const side = radius * 7;

                ctx.globalAlpha = style.glow * (0.8 + 0.2 * Math.sin(time * 1.7 + i * 1.3));
                ctx.drawImage(glow, markXY[i * 2] - side / 2, markXY[i * 2 + 1] - side / 2, side, side)
            }
        }

        ctx.globalAlpha              = 1;
        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle                = palette.signal;
        ctx.lineWidth                = 1.6;
        ctx.strokeStyle              = palette.inkDim;

        for (let i = 0; i < total; i++) {
            const x = markXY[i * 2], y = markXY[i * 2 + 1];

            ctx.beginPath();

            if (Home.isLit(i, total, up)) {
                ctx.arc(x, y, radius, 0, TAU);
                ctx.fill()
            } else {
                // inset by half the stroke, so a hollow mark spans exactly a lit one
                ctx.arc(x, y, radius - 0.8, 0, TAU);
                ctx.stroke()
            }
        }
    }

    /**
     * @summary The motes, one path per layer: the far layers small and dim, the near one larger, in the full ink.
     * @param {OffscreenCanvasRenderingContext2D} ctx
     * @param {Object} palette
     * @param {Object} style
     */
    drawMotes(ctx, palette, style) {
        const {drawn, field, moteCount} = this;

        for (let layer = 0; layer < LAYERS; layer++) {
            const radius = field.radius[layer];

            ctx.fillStyle   = layer === LAYERS - 1 ? palette.ink : palette.inkDim;
            ctx.globalAlpha = style.motes[layer];
            ctx.beginPath();

            // the motes interleave by layer at seed time: every LAYERS-th mote from `layer` is this layer's
            for (let i = layer; i < moteCount; i += LAYERS) {
                const x = drawn[i * 2], y = drawn[i * 2 + 1];

                ctx.moveTo(x + radius, y);
                ctx.arc(x, y, radius, 0, TAU)
            }

            ctx.fill()
        }
    }

    /**
     * @summary Erases the field under the quiet rects, softened over the field's `feather`, so no mote, link or ripple
     * sits in a line's letters or its leading.
     * @param {OffscreenCanvasRenderingContext2D} ctx
     */
    drawQuiet(ctx) {
        const {feather} = this.field;

        ctx.globalAlpha              = 1;
        ctx.globalCompositeOperation = 'destination-out';
        ctx.fillStyle                = '#000';
        ctx.filter                   = `blur(${feather / 2}px)`;

        for (const {height, width, x, y} of this.quiet) {
            ctx.fillRect(x - feather / 2, y - feather / 2, width + feather, height + feather)
        }

        ctx.filter                   = 'none';
        ctx.globalCompositeOperation = 'source-over'
    }

    /**
     * @summary Each live ripple as a ring that widens and fades.
     * @param {OffscreenCanvasRenderingContext2D} ctx
     * @param {Object} palette
     */
    drawRipples(ctx, palette) {
        const {field: {ripple}, ripples} = this;

        ctx.lineWidth   = 1;
        ctx.strokeStyle = palette.signal;

        for (let r = 0; r < RIPPLES; r++) {
            const age = ripples[r * 3 + 2];

            if (age >= 0) {
                ctx.globalAlpha = 0.35 * (1 - age / ripple.life);
                ctx.beginPath();
                ctx.arc(ripples[r * 3], ripples[r * 3 + 1], age * ripple.speed, 0, TAU);
                ctx.stroke()
            }
        }
    }

    /**
     * @summary Remote entry for the specs: what the field holds, how many of its motes are on screen, and how many
     * frames it drew.
     * @returns {Object} `{frames, marks, motes, quiet, size, still, theme, visible}`; `marks` is `{total, up}` or `null`,
     * and `visible` counts the motes drawn inside the surface
     */
    getStats() {
        const me = this, {canvasSize, team} = me;

        return {
            frames : me.frames,
            marks  : team && {...team},
            motes  : me.moteCount,
            size   : canvasSize && {height: canvasSize.height, width: canvasSize.width},
            still  : me.still,
            quiet  : me.quiet.length,
            theme  : me.theme,
            visible: me.countVisible()
        }
    }

    /**
     * @summary A click sends a ripple from where it landed, into a free slot or over the oldest ripple. A still
     * field takes no ripple.
     * @param {Object} data
     * @param {Number} [data.x]
     * @param {Number} [data.y]
     */
    onMouseClick({x, y}) {
        const {ripples} = this;

        if (!this.still && x !== undefined && y !== undefined) {
            let slot = 0;

            for (let r = 0; r < RIPPLES; r++) {
                if (ripples[r * 3 + 2] < 0) {
                    slot = r;
                    break
                }

                ripples[r * 3 + 2] > ripples[slot * 3 + 2] && (slot = r)
            }

            ripples[slot * 3]     = x;
            ripples[slot * 3 + 1] = y;
            ripples[slot * 3 + 2] = 0
        }
    }

    /**
     * @summary Places the marks on the ring, on the near layer's parallax. A moving field eases each mark toward
     * its place, so a team that grows or shrinks re-spaces without a jump; a still field sets them at rest.
     * @param {Number} dt Seconds since the last frame, `0` to set the marks at rest
     */
    placeMarks(dt) {
        const me = this, {field, markAngles, markXY, offsets, ring, team} = me;

        if (!team || !ring) {
            return
        }

        const
            {cx, cy, rx, ry} = ring,
            spin = me.still ? 0 : me.time * field.orbit,
            ease = Math.min(1, dt * 2);

        for (let i = 0; i < team.total; i++) {
            const
                target = spin + i * TAU / team.total,
                delta  = ((target - markAngles[i] + Math.PI) % TAU + TAU) % TAU - Math.PI,
                angle  = dt ? markAngles[i] + delta * ease : target,
                wobble = 1 + 0.05 * Math.sin(me.time * 0.6 + i * 1.7);

            markAngles[i]     = angle;
            markXY[i * 2]     = cx + Math.cos(angle) * rx * wobble + offsets[(LAYERS - 1) * 2];
            markXY[i * 2 + 1] = cy + Math.sin(angle) * ry * wobble + offsets[(LAYERS - 1) * 2 + 1]
        }
    }

    /**
     * @summary Where each mote is drawn this frame: its place shifted by its layer's parallax, parted away from the
     * pointer, and lifted outward by every ripple whose band crosses it. None of this moves a mote, so once the
     * pointer has left and a ripple's life has passed, the field is drawn as if neither had been there.
     */
    placeMotes() {
        const
            me                 = this,
            {drawn, field, motes, moteCount, offsets, parting, ripples} = me,
            {reach, ripple}    = field,
            [strength, px, py] = parting,
            core               = strength * field.part * reach,
            // the disc maps onto the ring outside the core by area, so every mote keeps its share and none pile at the rim
            keep               = 1 - core * core / (reach * reach);

        for (let i = 0, o = 0; i < moteCount; i++, o += STRIDE) {
            const layer = motes[o + 4];

            let x = motes[o]     + offsets[layer * 2],
                y = motes[o + 1] + offsets[layer * 2 + 1];

            if (strength > 0) {
                const dx = x - px, dy = y - py, d2 = dx * dx + dy * dy;

                if (d2 < reach * reach && d2 > 1) {
                    const scale = Math.sqrt((core * core + d2 * keep) / d2);

                    x = px + dx * scale;
                    y = py + dy * scale
                }
            }

            for (let r = 0; r < RIPPLES; r++) {
                const age = ripples[r * 3 + 2];

                if (age >= 0) {
                    const
                        dx   = x - ripples[r * 3],
                        dy   = y - ripples[r * 3 + 1],
                        d    = Math.sqrt(dx * dx + dy * dy),
                        edge = Math.abs(d - age * ripple.speed);

                    if (edge < ripple.band && d > 1) {
                        const lift = (1 - edge / ripple.band) * (1 - age / ripple.life) * ripple.lift / d;

                        x += dx * lift;
                        y += dy * lift
                    }
                }
            }

            drawn[i * 2]     = x;
            drawn[i * 2 + 1] = y
        }
    }

    /**
     * @summary An input changed: a moving field shows it on its next frame, a still one draws it now.
     */
    refresh() {
        const me = this;

        (me.still || !me.animationId) && me.render()
    }

    /**
     * @summary One frame: a moving field steps by the time since the last one, then draws, then schedules the next;
     * a still field draws and stops.
     */
    render() {
        const me = this;

        me.animationId = null;

        if (!me.canRender || !me.motes) {
            return
        }

        const now = performance.now(), dt = me.lastTime ? Math.min(now - me.lastTime, 50) / 1000 : 0;

        me.lastTime = now;
        me.still || me.step(dt);
        me.placeMarks(me.still ? 0 : dt);
        me.draw();

        if (!me.still) {
            me.animationId = hasRaf ? requestAnimationFrame(me.renderLoop) : setTimeout(me.renderLoop, 1000 / 60)
        }
    }

    /**
     * @summary Lays the field out at rest for a size. The motes fill the whole wrap domain, a link's length beyond
     * every edge, at the density the surface shows, so the current carries as many in as out. The layers interleave,
     * the seeded generator places every mote where it placed it last time at this size, and the ring sits right of
     * the hero's column on a wide surface, below it on a narrow one.
     * @param {Number} width
     * @param {Number} height
     */
    seed(width, height) {
        const
            me      = this,
            {field} = me,
            margin  = field.link,
            random  = mulberry32(field.seed),
            wide    = width >= 900,
            domainW = width  + margin * 2,
            domainH = height + margin * 2,
            visible = Math.min(field.moteMax, Math.max(field.moteMin, width * height / field.density)),
            area    = width * height,
            count   = area > 0 ? Math.min(field.moteCap, Math.round(visible * domainW * domainH / area)) : 0;

        me.ring = {
            cx: width  * (wide ? 0.72 : 0.5),
            cy: height * (wide ? 0.5  : 0.74),
            rx: Math.min(width  * (wide ? 0.2  : 0.38), 300),
            ry: Math.min(height * (wide ? 0.28 : 0.16), 190)
        };

        if (!me.motes || me.motes.length < count * STRIDE) {
            me.motes = new Float32Array(count * STRIDE);
            me.drawn = new Float32Array(count * 2)
        }

        for (let i = 0, o = 0; i < count; i++, o += STRIDE) {
            me.motes[o]     = random() * domainW - margin;
            me.motes[o + 1] = random() * domainH - margin;
            me.motes[o + 2] = 0;
            me.motes[o + 3] = 0;
            me.motes[o + 4] = i % LAYERS;
            me.motes[o + 5] = random() * TAU
        }

        me.moteCount = count;
        me.lastTime  = 0;
        me.time      = 0;
        me.offsets.fill(0);
        me.parting.fill(0);
        me.ripples.fill(-1)
    }

    /**
     * @summary Remote entry: whether the field is still, the host's reduced-motion preference. Anything but an
     * explicit `false` is still. A field that turns still returns to its rest layout.
     * @param {Object}  data
     * @param {Boolean} data.still
     * @param {String}  [data.windowId]
     */
    setMotion({still}) {
        const me = this, next = still !== false, {canvasSize} = me;

        if (next !== me.still) {
            me.still    = next;
            me.lastTime = 0;
            next && canvasSize && me.motes && me.seed(canvasSize.width, canvasSize.height);
            me.refresh()
        }
    }

    /**
     * @summary Remote entry: the rects the field stays out of, canvas-relative in CSS pixels. A rect without a
     * positive size, a hidden line, is left out.
     * @param {Object}   data
     * @param {Object[]} [data.rects=[]] `{x, y, width, height}` each
     * @param {String}   [data.windowId]
     */
    setQuiet({rects = []}) {
        const me = this;

        me.quiet = rects
            .filter(rect => rect?.width > 0 && rect?.height > 0)
            .map(({height, width, x, y}) => ({height, width, x, y}));

        me.refresh()
    }

    /**
     * @summary Remote entry: the team the roster read answers, `{total, up}`, or `null` while it has not answered.
     * A team of none draws no marks. Marks that stay keep their angle and ease to the new spacing, new ones start
     * at their place.
     * @param {Object}      data
     * @param {Object|null} data.team
     * @param {String}      [data.windowId]
     */
    setTeam({team = null}) {
        const
            me    = this,
            total = Number.isInteger(team?.total) && team.total > 0 ? team.total : 0,
            old   = me.markAngles,
            spin  = me.still ? 0 : me.time * me.field.orbit;

        me.team = total ? {total, up: Math.max(0, Math.min(total, team.up | 0))} : null;

        if (total !== (old?.length ?? 0)) {
            me.markAngles = total ? new Float32Array(total) : null;
            me.markXY     = total ? new Float32Array(total * 2) : null;

            for (let i = 0; i < total; i++) {
                me.markAngles[i] = old && i < old.length ? old[i] : spin + i * TAU / total
            }
        }

        me.refresh()
    }

    /**
     * @summary Advances the field by `dt` seconds: the layers ease toward the pointer's parallax, the pointer's
     * parting eases in or out, the ripples age, the current steers every mote, and a mote that leaves the surface by
     * more than a link's length comes back on the other side, where no link shows the jump.
     * @param {Number} dt
     */
    step(dt) {
        const
            me       = this,
            {field, motes, moteCount, mouse, offsets, parting, ripples} = me,
            {height, width} = me.canvasSize,
            active   = mouse.x > -1000,
            ease     = Math.min(1, dt * 3),
            pull     = Math.min(1, dt * 0.8),
            margin   = field.link,
            {ripple} = field;

        me.time += dt;

        const t = me.time;

        for (let layer = 0; layer < LAYERS; layer++) {
            const depth = field.parallax[layer];

            offsets[layer * 2]     += ((active ? (mouse.x / width  - 0.5) * 2 * depth : 0) - offsets[layer * 2])     * ease;
            offsets[layer * 2 + 1] += ((active ? (mouse.y / height - 0.5) * 2 * depth : 0) - offsets[layer * 2 + 1]) * ease
        }

        parting[0] += ((active ? 1 : 0) - parting[0]) * ease;

        if (active) {
            parting[1] = mouse.x;
            parting[2] = mouse.y
        }

        for (let r = 0; r < RIPPLES; r++) {
            if (ripples[r * 3 + 2] >= 0) {
                ripples[r * 3 + 2] += dt;
                ripples[r * 3 + 2] > ripple.life && (ripples[r * 3 + 2] = -1)
            }
        }

        for (let i = 0, o = 0; i < moteCount; i++, o += STRIDE) {
            const
                layer = motes[o + 4],
                speed = field.speed[layer],
                // the current: a slow flow field over position and time, one heading per point
                angle = (Math.sin(motes[o] * 0.0041 + t * 0.13 + motes[o + 5]) + Math.cos(motes[o + 1] * 0.0053 - t * 0.11)) * Math.PI;

            let x  = motes[o],
                y  = motes[o + 1],
                vx = motes[o + 2] + (Math.cos(angle) * speed - motes[o + 2]) * pull,
                vy = motes[o + 3] + (Math.sin(angle) * speed - motes[o + 3]) * pull;

            x += vx * dt;
            y += vy * dt;

            motes[o]     = x < -margin ? x + width  + margin * 2 : x > width  + margin ? x - width  - margin * 2 : x;
            motes[o + 1] = y < -margin ? y + height + margin * 2 : y > height + margin ? y - height - margin * 2 : y;
            motes[o + 2] = vx;
            motes[o + 3] = vy
        }
    }

    /**
     * @summary The theme changed or the surface did: the haze and the glow are drawn again in the skin's signal,
     * then the field.
     * @param {Number} width
     * @param {Number} height
     */
    updateResources(width, height) {
        const
            me       = this,
            {signal} = PALETTES[me.theme] || PALETTES.dark,
            style    = me.fieldStyle[me.theme] || me.fieldStyle.dark,
            {ring}   = me;

        if (me.context && ring) {
            const haze = me.context.createRadialGradient(ring.cx, ring.cy, 0, ring.cx, ring.cy, Math.max(width, height) * 0.5);

            haze.addColorStop(0, rgba(signal, style.haze));
            haze.addColorStop(1, rgba(signal, 0));
            me.gradients.haze = haze
        }

        if (typeof OffscreenCanvas === 'function') {
            const
                sprite   = me.glow ??= new OffscreenCanvas(GLOW, GLOW),
                ctx      = sprite.getContext('2d'),
                gradient = ctx.createRadialGradient(GLOW / 2, GLOW / 2, 0, GLOW / 2, GLOW / 2, GLOW / 2);

            gradient.addColorStop(0,    rgba(signal, 0.9));
            gradient.addColorStop(0.35, rgba(signal, 0.35));
            gradient.addColorStop(1,    rgba(signal, 0));

            ctx.clearRect(0, 0, GLOW, GLOW);
            ctx.fillStyle = gradient;
            ctx.fillRect(0, 0, GLOW, GLOW)
        }

        me.refresh()
    }

    /**
     * @summary Sizes the backing store at the host's pixel ratio, so the lines stay crisp, and lays the field out
     * again at rest for the new size. A report of the size already drawn changes nothing: resizing the backing
     * store would clear the field.
     * @param {Object} size
     * @param {Number} size.height CSS pixels
     * @param {Number} size.width  CSS pixels
     * @param {Number} [size.devicePixelRatio=1]
     */
    updateSize(size) {
        const me = this, drawn = me.canvasSize;

        if (me.motes && drawn?.width === size.width && drawn.height === size.height && (drawn.devicePixelRatio || 1) === (size.devicePixelRatio || 1)) {
            return
        }

        me.canvasSize = size;

        if (me.context) {
            const ratio = size.devicePixelRatio || 1;

            me.context.canvas.width  = Math.round(size.width  * ratio);
            me.context.canvas.height = Math.round(size.height * ratio);
            me.seed(size.width, size.height);
            me.updateResources(size.width, size.height)
        }
    }
}

export default Neo.setupClass(Home);
