import ObservatorySceneLayout from '../../../util/ObservatorySceneLayout.mjs';
import SharedCanvas           from '../../../../../node_modules/neo.mjs/src/app/SharedCanvas.mjs';

/**
 * @summary The App Worker half of the observatory: an offscreen canvas handed to the canvas worker's
 * {@link AgentOS.canvas.Observatory} renderer. It draws nothing itself: it derives the scene from the
 * envelope the pane binds through the pure layout, forwards it with the surface size and the pointer
 * (moves, buttons and the wheel, so the worker orbits and zooms), and asks the renderer which node the
 * pointer rests on. The envelope is a reactive config so a provider write reaches the worker as one
 * message.
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
         * The `fleetGoldenPath` envelope the scene derives from, or `null` for the empty surface.
         * @member {Object|null} envelope_=null
         * @reactive
         */
        envelope_: null,
        /**
         * @member {String} rendererClassName='AgentOS.canvas.Observatory'
         */
        rendererClassName: 'AgentOS.canvas.Observatory',
        /**
         * The canvas worker imports renderers relative to the engine package (`../../<path>` from
         * `src/worker/`), so a workspace app climbs out of `node_modules/neo.mjs` first.
         * @member {String} rendererImportPath='../../apps/agentos/canvas/Observatory.mjs'
         */
        rendererImportPath: '../../apps/agentos/canvas/Observatory.mjs'
    }

    /**
     * The node the pointer rested on at the last report, by id — a hover fires once per node.
     * @member {String|null} hoveredId=null
     */
    hoveredId = null

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
     * Triggered after the envelope config got changed — the scene follows once the canvas is ready.
     * @param {Object|null} value
     * @param {Object|null} oldValue
     * @protected
     */
    afterSetEnvelope(value, oldValue) {
        this.pushScene()
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
     * @summary The pointer left: the worker forgets it, and the pane names no node.
     * @param {Object} data
     */
    onMouseLeave(data) {
        super.onMouseLeave(data);
        this.reportHover(null)
    }

    /**
     * @summary Forwards the move, then asks the renderer which node the pointer rests on.
     * @param {Object} data
     * @returns {Promise<void>}
     */
    async onMouseMove(data) {
        const me = this;

        super.onMouseMove(data);

        if (me.isCanvasReady && typeof data.offsetX === 'number') {
            const node = await me.renderer.pick({x: data.offsetX, y: data.offsetY, windowId: me.windowId});

            me.isDestroyed || me.reportHover(node)
        }
    }

    /**
     * @summary Hands the scene of the current envelope to the renderer, if both exist.
     * @protected
     */
    pushScene() {
        const me = this;

        if (me.isCanvasReady && me.renderer) {
            // the bound value is the provider's tracking proxy; the layout reads plain data and the
            // worker message carries plain data
            const envelope = me.envelope ? JSON.parse(JSON.stringify(me.envelope)) : null;

            me.renderer.setScene({scene: ObservatorySceneLayout.fromGoldenPath(envelope), windowId: me.windowId})
        }
    }

    /**
     * @summary The renderer's live statistics — the camera, the surface, the counts, the frames — as
     * the specs read them; `null` before the canvas is ready.
     * @returns {Promise<Object|null>}
     */
    async readStats() {
        const me = this;

        return me.isCanvasReady && me.renderer ? me.renderer.getStats({windowId: me.windowId}) : null
    }

    /**
     * @summary Fires `nodeHover` when the node under the pointer changes.
     * @param {Object|null} node `{id, kind, label, rank, score}` or `null`
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
