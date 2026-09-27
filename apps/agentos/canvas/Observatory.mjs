import GraphScene      from '../../../node_modules/neo.mjs/src/canvas/GraphScene.mjs';
import {PALETTES, rgb} from './fmPalette.mjs';

/**
 * Node sizes in the engine's unit, pixels at the camera's distance: every node takes `node` in a read of up to
 * `nodeScaleFrom` nodes, and a denser read shrinks it with the square root of the excess, down to `nodeMin`, so a
 * whole graph reads as dust that glows where it gathers. While the route is drawn a seed shrinks down the route
 * from the first rank to the last between its two bounds, at any scale. Under a selection the selected node grows
 * by the `selected` factor, never below the last seed so it stands out of the dust, and a node outside its
 * neighbourhood shrinks by the `faded` one.
 * @type {Object}
 */
const SIZES = {faded: 0.6, node: 5, nodeMin: 0.4, nodeScaleFrom: 400, seedMax: 10, seedMin: 6, selected: 1.6};

/**
 * The community palette: a golden-angle hue step from the signal's hue that skips the `gold` band of hues, the
 * route's alone, and a lightness per skin.
 * @type {Object}
 */
const TONES = {gold: {from: 25, span: 60}, lightness: {dark: 0.62, light: 0.42}, saturation: 0.55, step: 137.508};

/**
 * @summary A hue in degrees, a saturation and a lightness as the three unit floats a WebGL attribute takes.
 * @param {Number} hue
 * @param {Number} saturation
 * @param {Number} lightness
 * @returns {Number[]}
 */
function hsl(hue, saturation, lightness) {
    const chroma = saturation * Math.min(lightness, 1 - lightness), channel = n => {
        const k = (n + hue / 30) % 12;

        return lightness - chroma * Math.max(-1, Math.min(k - 3, 9 - k, 1))
    };

    return [channel(0), channel(8), channel(4)]
}

/**
 * @summary The hue of a `#rrggbb` colour, in degrees.
 * @param {String} hex
 * @returns {Number}
 */
function hueOf(hex) {
    const [r, g, b] = rgb(hex), max = Math.max(r, g, b), span = max - Math.min(r, g, b);

    if (!span) {
        return 0
    }

    const hue = max === r ? (g - b) / span % 6 : max === g ? (b - r) / span + 2 : (r - g) / span + 4;

    return (hue * 60 + 360) % 360
}

/**
 * The fewest nodes a scene draws through the engine's level of detail. Its far level shows each community as
 * one centroid, which a large graph needs and a small read does not: below this, every node is drawn and can
 * be picked at any distance.
 * @type {Number}
 */
const LOD_FROM = 2000;

/**
 * @summary The observatory renderer: {@link Neo.canvas.GraphScene} in the cockpit's ink. The App Worker hands
 * it the scene {@link AgentOS.util.ObservatorySceneLayout} derives from the graph read in its wire form
 * ({@link AgentOS.util.ObservatorySceneLayout#wire}): typed arrays by node index for positions, communities,
 * edges and the route's seeds with their ranks, plus the currency. With it come the selected node's index and
 * whether the route is drawn, and this class inks the scene into the engine's flat scene.
 * Each community takes its own hue ({@link #toneOf}), the nodes shrink as the read grows, and a large scene
 * hands its communities to the engine as `clusters`: the fitted camera draws every node over the bundles, a
 * closer one adds the nearest communities' own edges, and only a camera drawn back shows one centroid per
 * community. On the dark skin the points add up, so a dense community glows. The route is an overlay: while it
 * is drawn, its seeds grow by rank and a gold path joins them in route order, gold only while the read is
 * current; switching it off inks the same positions again. A selection fades every node but the selected one
 * and its neighbours, except a drawn route's seeds, which only shrink. An empty scene clears the surface, and
 * the currency line above the canvas says why. A theme change inks the same scene again.
 *
 * No node object or id crosses: `pick` answers the engine's index and `locate` takes one, and the App Worker
 * resolves them against the scene it holds. `getStats` adds the pane's facts: its counts, currency,
 * completeness, snapshot, selected index and overlay.
 *
 * @class AgentOS.canvas.Observatory
 * @extends Neo.canvas.GraphScene
 * @singleton
 */
class Observatory extends GraphScene {
    static config = {
        /**
         * @member {String} className='AgentOS.canvas.Observatory'
         * @protected
         */
        className: 'AgentOS.canvas.Observatory',
        /**
         * The engine's level of detail with the fitted camera one level in: it draws every node, and the
         * centroids only once the camera is drawn back past the whole graph.
         * @member {Object} lod={far: 1.3, near: 0.55, nearClusters: 6}
         */
        lod: {far: 1.3, near: 0.55, nearClusters: 6},
        /**
         * Remote method access: the engine's set plus `locate`, the inverse of `pick`, and the two changes that
         * ink the drawn scene again without handing it over: the selection and the route overlay.
         * @member {Object} remote={app: ['locate', 'setRouteOverlay', 'setSelection']}
         * @protected
         */
        remote: {
            app: ['locate', 'setRouteOverlay', 'setSelection']
        },
        /**
         * Faint edges, so the web shows where it is dense and the nodes stay in front, and a route of small
         * beads, so it reads as a line between its beacons, not a band over the graph; few enough that a short
         * leg's beads, which add up on the dark skin, stay gold.
         * @member {Object} sceneStyle={beadAlpha: 0.45, beadSize: 2, beadsPerLeg: 24, edgeAlpha: 0.14, nodeAlpha: 0.85, pathAlpha: 0.9}
         */
        sceneStyle: {beadAlpha: 0.45, beadSize: 2, beadsPerLeg: 24, edgeAlpha: 0.14, nodeAlpha: 0.85, pathAlpha: 0.9},
        /**
         * @member {Boolean} singleton=true
         * @protected
         */
        singleton: true
    }

    /**
     * Whether the route is drawn over the graph.
     * @member {Boolean} routeOverlay=true
     */
    routeOverlay = true
    /**
     * The index of the node the drawn scene highlights, or `-1`.
     * @member {Number} selected=-1
     */
    selected = -1
    /**
     * The engine's frame count when the drawn scene arrived. `getStats` reports the frames drawn since, so a
     * frame owed to that scene reads apart from any earlier one.
     * @member {Number} sceneFrame=0
     */
    sceneFrame = 0
    /**
     * The last scene the App Worker handed over, in its wire form, or `null`.
     * @member {Object|null} sourceScene=null
     */
    sourceScene = null

    /**
     * @summary A node index the scene holds, else `-1`.
     * @param {Object|null} scene A wire scene
     * @param {Number} index
     * @returns {Number}
     */
    static nodeIndex(scene, index) {
        return scene && Number.isInteger(index) && index >= 0 && index < scene.count ? index : -1
    }

    /**
     * @summary Forgets the pane's scene and selection with the engine's scene.
     */
    clearGraph() {
        super.clearGraph();
        this.selected    = -1;
        this.sourceScene = null
    }

    /**
     * @summary Remote entry for the specs and the stats line: the engine's stats with the pane's facts. An
     * empty scene counts zeros; no scene counts `null`.
     * @returns {Object}
     */
    getStats() {
        const {routeOverlay, selected, sourceScene} = this, stats = super.getStats();

        return {
            ...stats,
            completeness: sourceScene?.completeness ?? null,
            counts      : sourceScene ? {...stats.counts, nodes: sourceScene.count, edges: sourceScene.edges.length / 2, seeds: sourceScene.seeds.length, communities: sourceScene.communities} : null,
            currency    : sourceScene?.currency ?? null,
            routeOverlay,
            sceneFrames : stats.frames - this.sceneFrame,
            selected,
            snapshotId  : sourceScene?.snapshotId ?? null
        }
    }

    /**
     * @summary The engine's flat scene for a wire scene in the current theme's ink, or `null` when there is
     * nothing to draw.
     * @param {Object|null} scene A wire scene (`{count, positions, clusters, edges, seeds, ranks, currency, communities, empty}`)
     * @param {Number}      [selectedIndex=-1] The index of the node to highlight; one the scene lacks highlights nothing
     * @param {Boolean}     [routeOverlay=true] Whether the route is drawn
     * @returns {Object|null} `{clusters, colors, edges, paths, positions, sizes}`
     */
    ink(scene, selectedIndex = -1, routeOverlay = true) {
        if (!scene || scene.empty) {
            return null
        }

        const
            me       = this,
            {clusters, count, edges, ranks, seeds} = scene,
            selected = me.constructor.nodeIndex(scene, selectedIndex),
            palette  = PALETTES[me.theme] || PALETTES.dark,
            tones    = Array.from({length: Math.max(1, scene.communities)}, (item, community) => me.toneOf(community)),
            // only a current read spends the route's gold
            seed     = rgb(scene.currency === 'current' ? palette.route : palette.ink),
            faded    = rgb(palette.line),
            lit      = selected < 0 ? null : new Set([selected]),
            rankOf   = routeOverlay ? new Map(Array.from(seeds, (node, position) => [node, ranks[position]])) : null,
            lastRank = Math.max(1, ...ranks),
            nodeSize = Math.max(SIZES.nodeMin, SIZES.node * Math.min(1, Math.sqrt(SIZES.nodeScaleFrom / count))),
            colors   = new Float32Array(count * 3),
            sizes    = new Float32Array(count);

        for (let pair = 0; lit && pair < edges.length; pair += 2) {
            edges[pair]     === selected && lit.add(edges[pair + 1]);
            edges[pair + 1] === selected && lit.add(edges[pair])
        }

        for (let index = 0; index < count; index++) {
            const
                rank = rankOf?.get(index),
                base = rank === undefined ? nodeSize : lastRank > 1 ? SIZES.seedMax - (rank - 1) / (lastRank - 1) * (SIZES.seedMax - SIZES.seedMin) : SIZES.seedMax,
                out  = lit !== null && !lit.has(index);

            // a drawn route keeps its colour under a selection: it recedes in size only
            colors.set(rank !== undefined ? seed : out ? faded : tones[clusters[index]], index * 3);
            sizes[index] = index === selected ? Math.max(base * SIZES.selected, SIZES.seedMin) : base * (out ? SIZES.faded : 1)
        }

        return {
            clusters : count >= LOD_FROM ? clusters : null,
            colors,
            edges,
            paths    : routeOverlay && seeds.length > 1 ? [seeds] : [],
            positions: scene.positions,
            sizes
        }
    }

    /**
     * @summary Remote entry, the inverse of `pick`: where a node of the drawn scene lies on the surface.
     * @param {Object} data
     * @param {Number} data.index The node's index in the scene
     * @returns {Object|null} `{x, y}`, canvas-relative CSS pixels, or `null` for an index the scene lacks
     */
    locate({index}) {
        const me = this, {canvasSize, sourceScene} = me, node = me.constructor.nodeIndex(sourceScene, index);

        if (node < 0 || !me.scene || !canvasSize) {
            return null
        }

        const
            {positions} = sourceScene,
            // the frame `pick` measures in
            [x, y]      = me.constructor.project(me.matrix(), positions[node * 3], positions[node * 3 + 1], positions[node * 3 + 2], canvasSize.width, canvasSize.height);

        return {x, y}
    }

    /**
     * @summary The engine's frame in the skin's blend: on the dark ground the points add up, so a dense community
     * glows; the light ground keeps the engine's blend, where added light would wash it out.
     */
    render() {
        const {gl} = this;

        gl?.blendFunc(gl.ONE, this.theme === 'light' ? gl.ONE_MINUS_SRC_ALPHA : gl.ONE);
        super.render()
    }

    /**
     * @summary Remote entry: whether the route is drawn. The drawn scene is inked again; nothing moves.
     * @param {Object}  data
     * @param {Boolean} data.routeOverlay
     * @param {String}  [data.windowId]
     */
    setRouteOverlay({routeOverlay}) {
        const me = this;

        me.sourceScene && super.setScene(me.ink(me.sourceScene, me.selected, routeOverlay));
        me.routeOverlay = routeOverlay
    }

    /**
     * @summary Remote entry: the App Worker hands over the wire scene, or `null`, with the selected index and
     * the overlay; it is inked and drawn. The pane's scene and selection change only once the engine took the
     * inked scene, so a refused scene leaves `pick` and the stats answering for the scene still drawn.
     * @param {Object}      data
     * @param {Object|null} data.scene A wire scene ({@link AgentOS.util.ObservatorySceneLayout#wire})
     * @param {Number}      [data.selected=-1] An index the scene lacks selects nothing
     * @param {Boolean}     [data.routeOverlay=true]
     * @param {String}      [data.windowId]
     * @throws {Error} when the engine refuses the inked scene
     */
    setScene({routeOverlay = true, scene, selected = -1}) {
        const me = this, next = scene ?? null, index = me.constructor.nodeIndex(next, selected);

        super.setScene(me.ink(next, index, routeOverlay));
        me.routeOverlay = routeOverlay;
        me.sceneFrame   = me.frames;
        me.sourceScene  = next;
        me.selected     = index
    }

    /**
     * @summary Remote entry: the selected index, or `-1`. The drawn scene is inked again; an index the scene
     * lacks selects nothing.
     * @param {Object} data
     * @param {Number} data.selected
     * @param {String} [data.windowId]
     */
    setSelection({selected}) {
        const me = this, scene = me.sourceScene, index = me.constructor.nodeIndex(scene, selected);

        scene && super.setScene(me.ink(scene, index, me.routeOverlay));
        me.selected = index
    }

    /**
     * @summary A community's ink in the current skin: the signal's hue stepped by the golden angle per community,
     * so neighbouring communities read apart, around the gold band, so none reads as the route.
     * @param {Number} community
     * @returns {Number[]} `[r, g, b]`, each 0…1
     */
    toneOf(community) {
        const
            palette      = PALETTES[this.theme] || PALETTES.dark,
            {from, span} = TONES.gold,
            // step around a wheel without the band, then open the band where it lies
            hue          = (hueOf(palette.signal) + community * TONES.step) % (360 - span);

        return hsl(hue < from ? hue : hue + span, TONES.saturation, TONES.lightness[this.theme] ?? TONES.lightness.dark)
    }

    /**
     * @summary The theme changed: the same scene is inked again in the new palette.
     * @param {Number} width
     * @param {Number} height
     */
    updateResources(width, height) {
        const me = this;

        me.sourceScene ? super.setScene(me.ink(me.sourceScene, me.selected, me.routeOverlay)) : super.updateResources(width, height)
    }
}

export default Neo.setupClass(Observatory);
