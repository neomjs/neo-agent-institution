import SharedCanvas from '../../../../../node_modules/neo.mjs/src/app/SharedCanvas.mjs';

/**
 * @summary The App Worker half of the Golden Path graph: an offscreen canvas handed to the
 * canvas worker's {@link AgentOS.canvas.GoldenPathGraph} renderer. It draws nothing itself; it
 * forwards the envelope the pane binds, the surface size and the pointer, and lets the renderer
 * paint. The envelope is a reactive config so a provider write reaches the worker as one message.
 *
 * @class AgentOS.view.fleet.goldenpath.GraphCanvas
 * @extends Neo.app.SharedCanvas
 */
class GraphCanvas extends SharedCanvas {
    static config = {
        /**
         * @member {String} className='AgentOS.view.fleet.goldenpath.GraphCanvas'
         * @protected
         */
        className: 'AgentOS.view.fleet.goldenpath.GraphCanvas',
        /**
         * @member {String} ntype='fm-goldenpath-graph-canvas'
         * @protected
         */
        ntype: 'fm-goldenpath-graph-canvas',
        /**
         * @member {String[]} cls=['fm-goldenpath-graph-canvas']
         */
        cls: ['fm-goldenpath-graph-canvas'],
        /**
         * The `fleetGoldenPath` envelope to draw, or `null` for the empty surface.
         * @member {Object|null} envelope_=null
         * @reactive
         */
        envelope_: null,
        /**
         * @member {String} rendererClassName='AgentOS.canvas.GoldenPathGraph'
         */
        rendererClassName: 'AgentOS.canvas.GoldenPathGraph',
        /**
         * The canvas worker imports renderers relative to the engine package (`../../<path>` from
         * `src/worker/`), so a workspace app climbs out of `node_modules/neo.mjs` first.
         * @member {String} rendererImportPath='../../apps/agentos/canvas/GoldenPathGraph.mjs'
         */
        rendererImportPath: '../../apps/agentos/canvas/GoldenPathGraph.mjs'
    }

    /**
     * @param {Object} config
     */
    construct(config) {
        super.construct(config);

        const me = this;

        // mousemove is not on the main thread's global target list — a LOCAL listener on the node,
        // the way the engine's own SharedCanvas consumers subscribe it; click and leave are global
        me.addDomListeners([{
            click     : me.onClick,
            mouseleave: me.onMouseLeave,
            mousemove : {fn: me.onMouseMove, local: true},
            scope     : me
        }])
    }

    /**
     * Triggered after the envelope config got changed — pushes it to the renderer once the canvas is ready.
     * @param {Object|null} value
     * @param {Object|null} oldValue
     * @protected
     */
    afterSetEnvelope(value, oldValue) {
        this.pushEnvelope()
    }

    /**
     * Triggered after the isCanvasReady config got changed — the first push happens here.
     * @param {Boolean} value
     * @param {Boolean} oldValue
     * @protected
     */
    afterSetIsCanvasReady(value, oldValue) {
        super.afterSetIsCanvasReady(value, oldValue);
        value && this.pushEnvelope()
    }

    /**
     * @summary Positions the pointer from the event's own offset pair, which is canvas-relative already.
     * The base subtracts a cached client rect that a ResizeObserver report replaces with the node's
     * contentRect (origin 0,0), so every hover after a dock resize would miss by the canvas's viewport
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
     * @summary Hands the current envelope to the renderer, if both exist.
     * @protected
     */
    pushEnvelope() {
        const me = this;

        if (me.isCanvasReady && me.renderer) {
            // the bound value is the provider's tracking proxy; a worker message carries plain data
            me.renderer.setEnvelope({envelope: me.envelope ? JSON.parse(JSON.stringify(me.envelope)) : null, windowId: me.windowId})
        }
    }
}

export default Neo.setupClass(GraphCanvas);
