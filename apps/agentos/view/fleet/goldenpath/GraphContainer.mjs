import Container             from '../../../../../node_modules/neo.mjs/src/container/Base.mjs';
import GoldenPathGraphLayout from '../../../util/GoldenPathGraphLayout.mjs';
import GraphCanvas           from './GraphCanvas.mjs';
import ViewerTime            from '../../../util/ViewerTime.mjs';

/**
 * @summary The Golden Path graph pane — a south-strip reading surface: a currency line first
 * (the cockpit's one reading of the envelope, with when the route was captured), then the graph
 * on the canvas worker. It binds the cockpit's `goldenPathEnvelope` leaf and synthesizes nothing:
 * a route drawn as current is current, a withheld one is drawn dim as the last known good route,
 * and a degraded, unavailable or unobserved source draws nothing.
 *
 * @class AgentOS.view.fleet.goldenpath.GraphContainer
 * @extends Neo.container.Base
 */
class GraphContainer extends Container {
    static config = {
        /**
         * @member {String} className='AgentOS.view.fleet.goldenpath.GraphContainer'
         * @protected
         */
        className: 'AgentOS.view.fleet.goldenpath.GraphContainer',
        /**
         * @member {String} ntype='fm-goldenpath-graph-pane'
         * @protected
         */
        ntype: 'fm-goldenpath-graph-pane',
        /**
         * @member {String[]} baseCls=['fm-goldenpath-graph-pane']
         */
        baseCls: ['fm-goldenpath-graph-pane'],
        /**
         * The `fleetGoldenPath` envelope, bound from the cockpit provider's `goldenPathEnvelope` leaf.
         * @member {Object|null} envelope_=null
         * @reactive
         */
        envelope_: null,
        /**
         * @member {Object} layout={ntype: 'vbox', align: 'stretch'}
         */
        layout: {ntype: 'vbox', align: 'stretch'},
        /**
         * The currency line; the canvas joins it in {@link #construct} where a canvas worker exists.
         * @member {Object[]} items
         */
        items: [{
            ntype    : 'component',
            cls      : ['fm-goldenpath-head'],
            flex     : 'none',
            reference: 'graph-head',
            vdom     : {cn: [
                {tag: 'span', cls: ['fm-goldenpath-title'],    text: 'Golden Path · graph'},
                {tag: 'span', cls: ['fm-goldenpath-currency'], text: GoldenPathGraphLayout.describeCurrency(null).text}
            ]}
        }]
    }

    /**
     * Mounts the canvas only where a canvas worker exists: without one (a config without it; the
     * unit harness, whose stubs resolve the worker's readiness but never define `Neo.worker.Canvas`)
     * the engine's canvas boot throws, so the pane keeps its currency line and no surface.
     * @param {Object} config
     */
    construct(config) {
        super.construct(config);

        if (Neo.config.useCanvasWorker && !Neo.config.unitTestMode) {
            this.add({module: GraphCanvas, flex: 1, reference: 'graph-canvas'})
        }
    }

    /**
     * Triggered after the envelope config got changed: the currency line and the canvas follow.
     * @param {Object|null} value
     * @param {Object|null} oldValue
     * @protected
     */
    afterSetEnvelope(value, oldValue) {
        const
            me     = this,
            head   = me.getReference('graph-head'),
            canvas = me.getReference('graph-canvas');

        if (head) {
            // the instant in the viewer's own clock, the way the Golden Path text pane stamps it
            head.vdom.cn[1].text = GoldenPathGraphLayout.describeCurrency(value, at => ViewerTime.formatViewerTime(at)?.text ?? null).text;
            head.update()
        }

        if (canvas) {
            canvas.envelope = value
        }
    }
}

export default Neo.setupClass(GraphContainer);
