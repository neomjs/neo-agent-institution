import GraphScene      from '../../../node_modules/neo.mjs/src/canvas/GraphScene.mjs';
import {PALETTES, rgb} from './fmPalette.mjs';

/**
 * Node sizes in the engine's unit, pixels at the camera's distance: an item scales with its weight between
 * the two bounds, a citation takes one size. They keep the pane's look from when sizes were pixels at unit
 * depth and the fitted camera stood about 2.3 units out.
 * @type {Object}
 */
const SIZES = {citation: 17, itemMax: 52, itemMin: 27};

/**
 * @summary The observatory renderer: {@link Neo.canvas.GraphScene} in the cockpit's ink. The App Worker hands
 * it the scene {@link AgentOS.util.ObservatorySceneLayout} derives from the Golden Path envelope — nodes in
 * unit space, edges and the route as node indices, the currency — and this class inks it into the engine's
 * flat scene: the route and its items in the signal when the route is current, dim when it is withheld,
 * citations dim, the route as the one beaded path. An empty scene (degraded, unavailable, unobserved) clears
 * the surface, and the currency line above the canvas says why. A theme change inks the same scene again.
 *
 * `pick` answers the node itself, `{id, kind, label, rank, score}`, where the engine answers its index, and
 * `getStats` counts the pane's scene: its nodes, edges and route.
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
         * The engine's look with the route's beads in the same unit as the node SIZES.
         * @member {Object} sceneStyle={beadAlpha: 0.55, beadSize: 10, beadsPerLeg: 18, edgeAlpha: 0.4, nodeAlpha: 0.95, pathAlpha: 0.9}
         */
        sceneStyle: {beadAlpha: 0.55, beadSize: 10, beadsPerLeg: 18, edgeAlpha: 0.4, nodeAlpha: 0.95, pathAlpha: 0.9},
        /**
         * @member {Boolean} singleton=true
         * @protected
         */
        singleton: true
    }

    /**
     * The last scene the App Worker handed over, as the layout derived it, or `null`.
     * @member {Object|null} sourceScene=null
     */
    sourceScene = null

    /**
     * @summary Forgets the pane's scene with the engine's.
     */
    clearGraph() {
        super.clearGraph();
        this.sourceScene = null
    }

    /**
     * @summary Remote entry for the specs and the stats line: the engine's stats, with the pane's counts
     * and currency. An empty scene counts zeros; no scene counts `null`.
     * @returns {Object}
     */
    getStats() {
        const {sourceScene} = this;

        return {
            ...super.getStats(),
            counts  : sourceScene ? {nodes: sourceScene.nodes.length, edges: sourceScene.edges.length, route: sourceScene.route.length} : null,
            currency: sourceScene?.currency ?? null
        }
    }

    /**
     * @summary The engine's flat scene for a layout scene in the current theme's ink, or `null` when there
     * is nothing to draw.
     * @param {Object|null} scene `{currency, empty, nodes, edges, route}`
     * @returns {Object|null} `{colors, edges, paths, positions, sizes}`
     */
    ink(scene) {
        if (!scene || scene.empty) {
            return null
        }

        const
            palette  = PALETTES[this.theme] || PALETTES.dark,
            item     = rgb(scene.currency === 'current' ? palette.signal : palette.inkDim),
            citation = rgb(palette.inkDim),
            isItem   = node => node.kind === 'item';

        return {
            colors   : scene.nodes.flatMap(node => isItem(node) ? item : citation),
            edges    : scene.edges.flat(),
            paths    : scene.route.length > 1 ? [scene.route] : [],
            positions: scene.nodes.flatMap(node => [node.x, node.y, node.z]),
            sizes    : scene.nodes.map(node => isItem(node) ? SIZES.itemMin + node.weight * (SIZES.itemMax - SIZES.itemMin) : SIZES.citation)
        }
    }

    /**
     * @summary The node under a canvas position, if any.
     * @param {Object} data
     * @param {Number} data.x Canvas-relative, CSS pixels
     * @param {Number} data.y
     * @returns {Object|null} `{id, kind, label, rank, score}`
     */
    pick(data) {
        const index = super.pick(data), node = index < 0 ? null : this.sourceScene?.nodes[index];

        return node ? {id: node.id, kind: node.kind, label: node.label, rank: node.rank, score: node.score} : null
    }

    /**
     * @summary Remote entry: the App Worker hands over the layout's scene, or `null`; it is inked and drawn. The
     * pane's scene changes only once the engine took the inked one, so a refused scene leaves `pick` and the
     * stats answering for the scene still drawn.
     * @param {Object} data
     * @param {Object|null} data.scene
     * @param {String} [data.windowId]
     * @throws {Error} when the engine refuses the inked scene
     */
    setScene({scene}) {
        const next = scene ?? null;

        super.setScene(this.ink(next));
        this.sourceScene = next
    }

    /**
     * @summary The theme changed: the same scene is inked again in the new palette.
     * @param {Number} width
     * @param {Number} height
     */
    updateResources(width, height) {
        const me = this;

        me.sourceScene ? super.setScene(me.ink(me.sourceScene)) : super.updateResources(width, height)
    }
}

export default Neo.setupClass(Observatory);
