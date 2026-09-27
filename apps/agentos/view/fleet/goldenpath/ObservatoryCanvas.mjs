import ObservatorySceneLayout from '../../../util/ObservatorySceneLayout.mjs';
import SharedCanvas           from '../../../../../node_modules/neo.mjs/src/app/SharedCanvas.mjs';

/**
 * How far, in CSS pixels, the pointer may travel between press and release for the click to still select:
 * further, the gesture was an orbit.
 * @type {Number}
 */
const CLICK_SLOP = 4;

/**
 * @summary The App Worker half of the observatory: an offscreen canvas handed to the canvas worker's
 * {@link AgentOS.canvas.Observatory} renderer. It draws nothing itself: it forwards the scene, the selection
 * and the route overlay its pane derives, the surface size and the pointer (moves, buttons and the wheel, so the
 * worker orbits and zooms), asks the renderer which node the pointer rests on, and reports a click that did not
 * orbit as a selection. The three are reactive configs: a new scene crosses to the worker with the other two,
 * and a new selection or overlay crosses alone, so a click never resends a whole graph. The scene crosses in
 * its wire form ({@link AgentOS.util.ObservatorySceneLayout#wire}), typed arrays by node index. A node crosses
 * as its index, and this class resolves it against the scene it holds, so no node object or id ever crosses.
 *
 * @class AgentOS.view.fleet.goldenpath.ObservatoryCanvas
 * @extends Neo.app.SharedCanvas
 */
class ObservatoryCanvas extends SharedCanvas {
    static config = {
        /**
         * @member {String} className='AgentOS.view.fleet.goldenpath.ObservatoryCanvas'
         * @protected
         */
        className: 'AgentOS.view.fleet.goldenpath.ObservatoryCanvas',
        /**
         * @member {String} ntype='fm-observatory-canvas'
         * @protected
         */
        ntype: 'fm-observatory-canvas',
        /**
         * @member {String[]} cls=['fm-observatory-canvas']
         */
        cls: ['fm-observatory-canvas'],
        /**
         * @member {String} rendererClassName='AgentOS.canvas.Observatory'
         */
        rendererClassName: 'AgentOS.canvas.Observatory',
        /**
         * The canvas worker imports renderers relative to the engine package (`../../<path>` from
         * `src/worker/`), so a workspace app climbs out of `node_modules/neo.mjs` first.
         * @member {String} rendererImportPath='../../apps/agentos/canvas/Observatory.mjs'
         */
        rendererImportPath: '../../apps/agentos/canvas/Observatory.mjs',
        /**
         * Whether the route is drawn over the graph.
         * @member {Boolean} routeOverlay_=true
         * @reactive
         */
        routeOverlay_: true,
        /**
         * The layout scene to draw ({@link AgentOS.util.ObservatorySceneLayout#fromGraphScene}), or `null` for
         * the empty surface.
         * @member {Object|null} scene_=null
         * @reactive
         */
        scene_: null,
        /**
         * The id of the node to highlight, or `null`.
         * @member {String|null} selectedId_=null
         * @reactive
         */
        selectedId_: null
    }

    /**
     * The node the pointer rested on at the last report, by id — a hover fires once per node.
     * @member {String|null} hoveredId=null
     */
    hoveredId = null
    /**
     * Where the last press landed, canvas-relative, or `null` — also once the pointer carried it past the
     * slop, because from then on the gesture is an orbit, wherever it is released.
     * @member {Number[]|null} pressedAt=null
     */
    pressedAt = null

    /**
     * @param {Object} config
     */
    construct(config) {
        super.construct(config);

        const me = this;

        // mousemove and wheel are not on the main thread's global target list — LOCAL listeners on the
        // node, the wheel non-passive so the page does not scroll while the scene zooms; the rest are global
        me.addDomListeners([{
            click     : me.onClick,
            mousedown : me.onMouseDown,
            mouseleave: me.onMouseLeave,
            mousemove : {fn: me.onMouseMove, local: true},
            mouseup   : me.onMouseUp,
            wheel     : {fn: me.onWheel, local: true, passive: false},
            scope     : me
        }])
    }

    /**
     * Triggered after the isCanvasReady config got changed — the first scene lands here.
     * @param {Boolean} value
     * @param {Boolean} oldValue
     * @protected
     */
    afterSetIsCanvasReady(value, oldValue) {
        super.afterSetIsCanvasReady(value, oldValue);
        value && this.pushScene()
    }

    /**
     * Triggered after the scene config got changed — the worker follows once the canvas is ready.
     * @param {Object|null} value
     * @param {Object|null} oldValue
     * @protected
     */
    afterSetScene(value, oldValue) {
        this.pushScene()
    }

    /**
     * Triggered after the routeOverlay config got changed — the worker inks the drawn scene again, without
     * the scene crossing to it.
     * @param {Boolean} value
     * @param {Boolean} oldValue
     * @protected
     */
    afterSetRouteOverlay(value, oldValue) {
        const me = this;

        me.isCanvasReady && me.renderer && me.renderer.setRouteOverlay({routeOverlay: value, windowId: me.windowId})
    }

    /**
     * Triggered after the selectedId config got changed — the worker inks the new selection, without the scene
     * crossing to it.
     * @param {String|null} value
     * @param {String|null} oldValue
     * @protected
     */
    afterSetSelectedId(value, oldValue) {
        const me = this;

        me.isCanvasReady && me.renderer && me.renderer.setSelection({selected: me.indexOf(value), windowId: me.windowId})
    }

    /**
     * @summary Positions the pointer from the event's own offset pair, which is canvas-relative already.
     * The base subtracts a cached client rect that a ResizeObserver report replaces with the node's
     * contentRect (origin 0,0), so every report after a dock resize would miss by the canvas's viewport
     * offset; adding that rect's origin back cancels it out whichever rect is cached.
     * @param {Object} data The DOM event data
     * @param {Object} [extra]
     * @protected
     */
    forwardPointer(data, extra) {
        const {canvasRect} = this;

        if (canvasRect && typeof data.offsetX === 'number' && typeof data.offsetY === 'number') {
            data = {...data, clientX: data.offsetX + canvasRect.left, clientY: data.offsetY + canvasRect.top}
        }

        super.forwardPointer(data, extra)
    }

    /**
     * @summary A click the pointer did not travel for selects the node under it — or, on the empty surface,
     * nothing — and fires `nodeSelect`; a click that ends an orbit selects nothing. The pick answers for the
     * scene it was asked about: a read that landed meanwhile owns the selection, so a late answer is dropped.
     * @param {Object} data
     * @returns {Promise<void>}
     */
    async onClick(data) {
        const me = this, {pressedAt, scene} = me;

        super.onClick(data);

        if (me.isCanvasReady && pressedAt && Math.hypot(data.offsetX - pressedAt[0], data.offsetY - pressedAt[1]) <= CLICK_SLOP) {
            const index = await me.renderer.pick({x: data.offsetX, y: data.offsetY, windowId: me.windowId});

            me.isDestroyed || me.scene !== scene || me.fire('nodeSelect', {node: me.nodeAt(index)})
        }
    }

    /**
     * @summary The index of a node in the held scene, the form the renderer takes; `-1` for an id it lacks.
     * @param {String|null} id
     * @returns {Number}
     */
    indexOf(id) {
        const {scene} = this;

        return scene && Object.hasOwn(scene.index, id) ? scene.index[id] : -1
    }

    /**
     * @summary The held scene's node at an index the renderer answered, or `null`.
     * @param {Number} index
     * @returns {Object|null} `{id, kind, label, rank, hop, cluster, x, y, z}`
     */
    nodeAt(index) {
        return index >= 0 ? this.scene?.nodes[index] ?? null : null
    }

    /**
     * @summary Forwards the press and remembers where it landed.
     * @param {Object} data
     */
    onMouseDown(data) {
        super.onMouseDown(data);
        this.pressedAt = typeof data.offsetX === 'number' ? [data.offsetX, data.offsetY] : null
    }

    /**
     * @summary The pointer left: the worker forgets it, and the pane names no node.
     * @param {Object} data
     */
    onMouseLeave(data) {
        super.onMouseLeave(data);
        this.reportHover(null)
    }

    /**
     * @summary Forwards the move, then asks the renderer which node the pointer rests on. A held press the
     * move carries past the slop becomes an orbit for good.
     * @param {Object} data
     * @returns {Promise<void>}
     */
    async onMouseMove(data) {
        const me = this, {pressedAt, scene} = me;

        super.onMouseMove(data);

        if (pressedAt && data.buttons && Math.hypot(data.offsetX - pressedAt[0], data.offsetY - pressedAt[1]) > CLICK_SLOP) {
            me.pressedAt = null
        }

        if (me.isCanvasReady && typeof data.offsetX === 'number') {
            const index = await me.renderer.pick({x: data.offsetX, y: data.offsetY, windowId: me.windowId});

            // an index answers for the scene it was asked about
            me.isDestroyed || me.reportHover(me.scene === scene ? me.nodeAt(index) : null)
        }
    }

    /**
     * @summary Where a node of the drawn scene lies on the surface, the inverse of the pointer's pick.
     * @param {String} id The node's origin-qualified id
     * @returns {Promise<Object|null>} `{x, y}`, canvas-relative CSS pixels, or `null` for an id the scene lacks
     */
    async locate(id) {
        const me = this, index = me.indexOf(id);

        return me.isCanvasReady && me.renderer && index >= 0 ? me.renderer.locate({index, windowId: me.windowId}) : null
    }

    /**
     * @summary Hands the scene in its wire form, the selected index and the overlay to the renderer, once the
     * canvas is ready.
     * @protected
     */
    pushScene() {
        const me = this;

        if (me.isCanvasReady && me.renderer) {
            me.renderer.setScene({routeOverlay: me.routeOverlay, scene: ObservatorySceneLayout.wire(me.scene), selected: me.indexOf(me.selectedId), windowId: me.windowId})
        }
    }

    /**
     * @summary The renderer's live statistics — the camera, the surface, the counts, the frames — as
     * the specs read them, with the selection the renderer draws named by its id; `null` before the canvas is
     * ready.
     * @returns {Promise<Object|null>}
     */
    async readStats() {
        const me = this;

        if (!(me.isCanvasReady && me.renderer)) {
            return null
        }

        const {selected, ...stats} = await me.renderer.getStats({windowId: me.windowId});

        return {...stats, selectedId: me.nodeAt(selected)?.id ?? null}
    }

    /**
     * @summary Fires `nodeHover` when the node under the pointer changes.
     * @param {Object|null} node `{id, kind, label, rank, hop, cluster}` or `null`
     * @protected
     */
    reportHover(node) {
        const me = this, id = node?.id ?? null;

        if (id !== me.hoveredId) {
            me.hoveredId = id;
            me.fire('nodeHover', {node})
        }
    }
}

export default Neo.setupClass(ObservatoryCanvas);
