import GraphScene      from '../../../node_modules/neo.mjs/src/canvas/GraphScene.mjs';
import {PALETTES, rgb} from './fmPalette.mjs';

/**
 * Node sizes in the engine's unit, pixels at the camera's distance: a seed shrinks down the route from the
 * first rank to the last between its two bounds, a node one hop out takes `near`, every node further out
 * `far`. Under a selection the selected node grows by the `selected` factor and a node outside its
 * neighbourhood shrinks by the `faded` one, so the faded nodes cover less of the lit ones.
 * @type {Object}
 */
const SIZES = {faded: 0.6, far: 12, near: 17, seedMax: 52, seedMin: 27, selected: 1.25};

/**
 * @summary The observatory renderer: {@link Neo.canvas.GraphScene} in the cockpit's ink. The App Worker hands
 * it the scene {@link AgentOS.util.ObservatorySceneLayout} derives from the bounded graph read — nodes in unit
 * space, the feed's edges as node index pairs, the currency — with the selected node's id, and this class
 * inks it into the engine's flat scene. Ink steps down by hop: the seeds (the route's items, sized by their
 * rank) brightest — in the signal only while the read is current — the nodes one hop out next, everything
 * further dim. A selection fades every node but the selected one and its neighbours. Only the feed's edges are
 * drawn; no line joins the route's ranks. An empty scene clears the surface, and the currency line above the
 * canvas says why. A theme change inks the same scene again.
 *
 * `pick` answers the node itself, `{id, kind, label, rank, hop, cluster}`, where the engine answers its index,
 * and `getStats` adds the pane's facts: its counts, currency, completeness, snapshot and selection.
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
         * Remote method access: the engine's set plus `locate`, the inverse of `pick`.
         * @member {Object} remote={app: ['locate']}
         * @protected
         */
        remote: {
            app: ['locate']
        },
        /**
         * @member {Boolean} singleton=true
         * @protected
         */
        singleton: true
    }

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
        const {selectedId, sourceScene} = this;

        return {
            ...super.getStats(),
            completeness: sourceScene?.completeness ?? null,
            counts      : sourceScene ? {nodes: sourceScene.nodes.length, edges: sourceScene.edges.length, seeds: sourceScene.seeds.length} : null,
            currency    : sourceScene?.currency ?? null,
            selectedId,
            snapshotId  : sourceScene?.snapshotId ?? null
        }
    }

    /**
     * @summary The engine's flat scene for a layout scene in the current theme's ink, or `null` when there
     * is nothing to draw.
     * @param {Object|null} scene `{currency, empty, nodes, edges, seeds, index}`
     * @param {String|null} [selectedId=null] The node to highlight; an id the scene lacks highlights nothing
     * @returns {Object|null} `{colors, edges, positions, sizes}`
     */
    ink(scene, selectedId = null) {
        if (!scene || scene.empty) {
            return null
        }

        const
            palette  = PALETTES[this.theme] || PALETTES.dark,
            // the ladder steps down by hop; only a current read spends the signal
            ladder   = (scene.currency === 'current' ? [palette.signal, palette.ink, palette.inkDim] : [palette.ink, palette.inkDim, palette.inkDim]).map(rgb),
            faded    = rgb(palette.line),
            selected = Object.hasOwn(scene.index, selectedId) ? scene.index[selectedId] : -1,
            lit      = selected < 0 ? null : new Set([selected, ...scene.edges.filter(pair => pair.includes(selected)).flat()]),
            lastRank = Math.max(1, ...scene.nodes.filter(node => node.hop === 0).map(node => node.rank)),
            sizeOf   = node => {
                if (node.hop === 0) {
                    return lastRank > 1 ? SIZES.seedMax - (node.rank - 1) / (lastRank - 1) * (SIZES.seedMax - SIZES.seedMin) : SIZES.seedMax
                }

                return node.hop === 1 ? SIZES.near : SIZES.far
            };

        return {
            colors   : scene.nodes.flatMap((node, index) => lit && !lit.has(index) ? faded : ladder[Math.min(node.hop ?? 2, 2)]),
            edges    : scene.edges.flat(),
            positions: scene.nodes.flatMap(node => [node.x, node.y, node.z]),
            sizes    : scene.nodes.map((node, index) => sizeOf(node) * (index === selected ? SIZES.selected : lit && !lit.has(index) ? SIZES.faded : 1))
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
     * @summary Remote entry: the App Worker hands over the layout's scene, or `null`, with the selected id; it
     * is inked and drawn. The pane's scene and selection change only once the engine took the inked scene, so
     * a refused scene leaves `pick` and the stats answering for the scene still drawn.
     * @param {Object} data
     * @param {Object|null} data.scene
     * @param {String|null} [data.selectedId=null]
     * @param {String} [data.windowId]
     * @throws {Error} when the engine refuses the inked scene
     */
    setScene({scene, selectedId = null}) {
        const me = this, next = scene ?? null;

        super.setScene(me.ink(next, selectedId));
        me.sourceScene = next;
        me.selectedId  = next && Object.hasOwn(next.index, selectedId) ? selectedId : null
    }

    /**
     * @summary The theme changed: the same scene is inked again in the new palette.
     * @param {Number} width
     * @param {Number} height
     */
    updateResources(width, height) {
        const me = this;

        me.sourceScene ? super.setScene(me.ink(me.sourceScene, me.selectedId)) : super.updateResources(width, height)
    }
}

export default Neo.setupClass(Observatory);
