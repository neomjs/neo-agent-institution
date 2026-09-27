import GraphScene      from '../../../node_modules/neo.mjs/src/canvas/GraphScene.mjs';
import {PALETTES, rgb} from './fmPalette.mjs';

/**
 * Node sizes in the engine's unit, pixels at the camera's distance: every node takes `node`, and while the
 * route is drawn a seed shrinks down the route from the first rank to the last between its two bounds. Under a
 * selection the selected node grows by the `selected` factor and a node outside its neighbourhood shrinks by
 * the `faded` one, so the faded nodes cover less of the lit ones.
 * @type {Object}
 */
const SIZES = {faded: 0.6, node: 12, seedMax: 52, seedMin: 27, selected: 1.25};

/**
 * The fewest nodes a scene draws through the engine's level of detail. Its far level shows each community as
 * one centroid, which a large graph needs and a small read does not: below this, every node is drawn and can
 * be picked at any distance.
 * @type {Number}
 */
const LOD_FROM = 2000;

/**
 * @summary A colour between two, as unit floats.
 * @param {Number[]} from
 * @param {Number[]} to
 * @param {Number}   share 0 is `from`, 1 is `to`
 * @returns {Number[]}
 */
const mix = (from, to, share) => from.map((value, channel) => value + (to[channel] - value) * share);

/**
 * @summary The observatory renderer: {@link Neo.canvas.GraphScene} in the cockpit's ink. The App Worker hands
 * it the scene {@link AgentOS.util.ObservatorySceneLayout} derives from the graph read — nodes in unit space
 * with their community, the feed's edges as node index pairs, the route's seeds, the currency — with the
 * selected node's id and whether the route is drawn, and this class inks it into the engine's flat scene.
 * Each community takes its own step between ink and dim ink, and a large scene hands its communities to the
 * engine as `clusters`, so a far camera draws them through the level of detail. The route is an overlay: while it is
 * drawn, its seeds grow by rank and a path joins them in route order, in the signal only while the read is
 * current; switching it off inks the same positions again. A selection fades every node but the selected one
 * and its neighbours. An empty scene clears the surface, and the currency line above the canvas says why. A
 * theme change inks the same scene again.
 *
 * `pick` answers the node itself, `{id, kind, label, rank, hop, cluster}`, where the engine answers its index,
 * and `getStats` adds the pane's facts: its counts, currency, completeness, snapshot, selection and overlay.
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
         * Remote method access: the engine's set plus `locate`, the inverse of `pick`, and the two changes that
         * ink the drawn scene again without handing it over: the selection and the route overlay.
         * @member {Object} remote={app: ['locate', 'setRouteOverlay', 'setSelection']}
         * @protected
         */
        remote: {
            app: ['locate', 'setRouteOverlay', 'setSelection']
        },
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
     * The id of the node the drawn scene highlights, or `null`.
     * @member {String|null} selectedId=null
     */
    selectedId = null
    /**
     * The last scene the App Worker handed over, as the layout derived it, or `null`.
     * @member {Object|null} sourceScene=null
     */
    sourceScene = null

    /**
     * @summary Forgets the pane's scene and selection with the engine's scene.
     */
    clearGraph() {
        super.clearGraph();
        this.selectedId  = null;
        this.sourceScene = null
    }

    /**
     * @summary Remote entry for the specs and the stats line: the engine's stats with the pane's facts. An
     * empty scene counts zeros; no scene counts `null`.
     * @returns {Object}
     */
    getStats() {
        const {routeOverlay, selectedId, sourceScene} = this, stats = super.getStats();

        return {
            ...stats,
            completeness: sourceScene?.completeness ?? null,
            counts      : sourceScene ? {...stats.counts, nodes: sourceScene.nodes.length, edges: sourceScene.edges.length, seeds: sourceScene.seeds.length, communities: sourceScene.communities} : null,
            currency    : sourceScene?.currency ?? null,
            routeOverlay,
            selectedId,
            snapshotId  : sourceScene?.snapshotId ?? null
        }
    }

    /**
     * @summary The engine's flat scene for a layout scene in the current theme's ink, or `null` when there
     * is nothing to draw.
     * @param {Object|null} scene `{currency, empty, nodes, edges, seeds, index, communities}`
     * @param {String|null} [selectedId=null] The node to highlight; an id the scene lacks highlights nothing
     * @param {Boolean}     [routeOverlay=true] Whether the route is drawn
     * @returns {Object|null} `{clusters, colors, edges, paths, positions, sizes}`
     */
    ink(scene, selectedId = null, routeOverlay = true) {
        if (!scene || scene.empty) {
            return null
        }

        const
            palette  = PALETTES[this.theme] || PALETTES.dark,
            ink      = rgb(palette.ink),
            // each community its own step toward dim ink, the golden ratio spreading neighbouring indices apart
            tones    = Array.from({length: Math.max(1, scene.communities)}, (item, community) => mix(ink, rgb(palette.inkDim), community * 0.618034 % 1 * 0.8)),
            // only a current read spends the signal
            seed     = rgb(scene.currency === 'current' ? palette.signal : palette.ink),
            faded    = rgb(palette.line),
            selected = Object.hasOwn(scene.index, selectedId) ? scene.index[selectedId] : -1,
            lit      = selected < 0 ? null : new Set([selected, ...scene.edges.filter(pair => pair.includes(selected)).flat()]),
            seeds    = routeOverlay ? new Set(scene.seeds) : null,
            lastRank = Math.max(1, ...scene.seeds.map(index => scene.nodes[index].rank)),
            sizeOf   = (node, index) => {
                const base = seeds?.has(index) ? (lastRank > 1 ? SIZES.seedMax - (node.rank - 1) / (lastRank - 1) * (SIZES.seedMax - SIZES.seedMin) : SIZES.seedMax) : SIZES.node;

                return base * (index === selected ? SIZES.selected : lit && !lit.has(index) ? SIZES.faded : 1)
            };

        return {
            clusters : scene.nodes.length >= LOD_FROM ? scene.nodes.map(node => node.cluster) : null,
            colors   : scene.nodes.flatMap((node, index) => lit && !lit.has(index) ? faded : seeds?.has(index) ? seed : tones[node.cluster]),
            edges    : scene.edges.flat(),
            paths    : routeOverlay && scene.seeds.length > 1 ? [scene.seeds] : [],
            positions: scene.nodes.flatMap(node => [node.x, node.y, node.z]),
            sizes    : scene.nodes.map(sizeOf)
        }
    }

    /**
     * @summary Remote entry, the inverse of `pick`: where a node of the drawn scene lies on the surface.
     * @param {Object} data
     * @param {String} data.id The node's origin-qualified id
     * @returns {Object|null} `{x, y}`, canvas-relative CSS pixels, or `null` for an id the scene lacks
     */
    locate({id}) {
        const
            me             = this,
            {canvasSize}   = me,
            index          = me.sourceScene && Object.hasOwn(me.sourceScene.index, id) ? me.sourceScene.index[id] : -1,
            node           = index < 0 || !me.scene || !canvasSize ? null : me.sourceScene.nodes[index];

        if (!node) {
            return null
        }

        // the frame `pick` measures in
        const [x, y] = me.constructor.project(me.matrix(), node.x, node.y, node.z, canvasSize.width, canvasSize.height);

        return {x, y}
    }

    /**
     * @summary The node under a canvas position, if any.
     * @param {Object} data
     * @param {Number} data.x Canvas-relative, CSS pixels
     * @param {Number} data.y
     * @returns {Object|null} `{id, kind, label, rank, hop, cluster}`
     */
    pick(data) {
        const index = super.pick(data), node = index < 0 ? null : this.sourceScene?.nodes[index];

        return node ? {id: node.id, kind: node.kind, label: node.label, rank: node.rank, hop: node.hop, cluster: node.cluster} : null
    }

    /**
     * @summary Remote entry: whether the route is drawn. The drawn scene is inked again; nothing moves.
     * @param {Object}  data
     * @param {Boolean} data.routeOverlay
     * @param {String}  [data.windowId]
     */
    setRouteOverlay({routeOverlay}) {
        const me = this;

        me.sourceScene && super.setScene(me.ink(me.sourceScene, me.selectedId, routeOverlay));
        me.routeOverlay = routeOverlay
    }

    /**
     * @summary Remote entry: the App Worker hands over the layout's scene, or `null`, with the selected id and
     * the overlay; it is inked and drawn. The pane's scene and selection change only once the engine took the
     * inked scene, so a refused scene leaves `pick` and the stats answering for the scene still drawn.
     * @param {Object}      data
     * @param {Object|null} data.scene
     * @param {String|null} [data.selectedId=null]
     * @param {Boolean}     [data.routeOverlay=true]
     * @param {String}      [data.windowId]
     * @throws {Error} when the engine refuses the inked scene
     */
    setScene({routeOverlay = true, scene, selectedId = null}) {
        const me = this, next = scene ?? null;

        super.setScene(me.ink(next, selectedId, routeOverlay));
        me.routeOverlay = routeOverlay;
        me.sourceScene  = next;
        me.selectedId   = next && Object.hasOwn(next.index, selectedId) ? selectedId : null
    }

    /**
     * @summary Remote entry: the selected id, or `null`. The drawn scene is inked again; an id the scene lacks
     * selects nothing.
     * @param {Object}      data
     * @param {String|null} data.selectedId
     * @param {String}      [data.windowId]
     */
    setSelection({selectedId}) {
        const me = this, scene = me.sourceScene, id = scene && Object.hasOwn(scene.index, selectedId) ? selectedId : null;

        scene && super.setScene(me.ink(scene, id, me.routeOverlay));
        me.selectedId = id
    }

    /**
     * @summary The theme changed: the same scene is inked again in the new palette.
     * @param {Number} width
     * @param {Number} height
     */
    updateResources(width, height) {
        const me = this;

        me.sourceScene ? super.setScene(me.ink(me.sourceScene, me.selectedId, me.routeOverlay)) : super.updateResources(width, height)
    }
}

export default Neo.setupClass(Observatory);
