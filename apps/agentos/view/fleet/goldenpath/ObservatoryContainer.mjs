import Container             from '../../../../../node_modules/neo.mjs/src/container/Base.mjs';
import GoldenPathGraphLayout from '../../../util/GoldenPathGraphLayout.mjs';
import ObservatoryCanvas     from './ObservatoryCanvas.mjs';
import ViewerTime            from '../../../util/ViewerTime.mjs';

/**
 * @summary The Observatory keeper-view — the Golden Path as a navigable 3D scene on the canvas worker,
 * with the cockpit's currency line first (the one reading of the envelope, with when the route was
 * captured) and the node under the pointer named beside it. It binds the shell's `goldenPathEnvelope`
 * leaf, which the cockpit's Golden Path read writes, and synthesizes nothing: a current route is drawn in the signal, a withheld one dim as the last known
 * good route, and a degraded, unavailable or unobserved source draws nothing. Drag orbits, the wheel
 * zooms.
 *
 * @class AgentOS.view.fleet.goldenpath.ObservatoryContainer
 * @extends Neo.container.Base
 */
class ObservatoryContainer extends Container {
    static config = {
        /**
         * @member {String} className='AgentOS.view.fleet.goldenpath.ObservatoryContainer'
         * @protected
         */
        className: 'AgentOS.view.fleet.goldenpath.ObservatoryContainer',
        /**
         * @member {String} ntype='fm-observatory-pane'
         * @protected
         */
        ntype: 'fm-observatory-pane',
        /**
         * @member {String[]} baseCls=['fm-observatory-pane']
         */
        baseCls: ['fm-observatory-pane'],
        /**
         * The `fleetGoldenPath` envelope, bound from the Viewport provider's `goldenPathEnvelope` leaf.
         * @member {Object|null} envelope_=null
         * @reactive
         */
        envelope_: null,
        /**
         * @member {Object} layout={ntype: 'vbox', align: 'stretch'}
         */
        layout: {ntype: 'vbox', align: 'stretch'},
        /**
         * The head: title, currency line, the hovered node; the canvas joins it in {@link #construct}
         * where a canvas worker exists.
         * @member {Object[]} items
         */
        items: [{
            ntype    : 'component',
            cls      : ['fm-observatory-head'],
            flex     : 'none',
            reference: 'observatory-head',
            vdom     : {cn: [
                {tag: 'span', cls: ['fm-observatory-title'],    text: 'Golden Path · observatory'},
                {tag: 'span', cls: ['fm-observatory-currency'], text: GoldenPathGraphLayout.describeCurrency(null).text},
                {tag: 'span', cls: ['fm-observatory-hover', 'is-hint'], text: 'drag orbits · wheel zooms'}
            ]}
        }]
    }

    /**
     * Mounts the canvas only where a canvas worker exists: without one (a config without it; the unit
     * harness, whose stubs resolve the worker's readiness but never define `Neo.worker.Canvas`) the
     * engine's canvas boot throws, so the pane keeps its head and no surface.
     * @param {Object} config
     */
    construct(config) {
        super.construct(config);

        const me = this;

        if (Neo.config.useCanvasWorker && !Neo.config.unitTestMode) {
            me.add({
                module   : ObservatoryCanvas,
                flex     : 1,
                reference: 'observatory-canvas',
                listeners: {nodeHover: me.onNodeHover, scope: me}
            })
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
            head   = me.getReference('observatory-head'),
            canvas = me.getReference('observatory-canvas');

        if (head) {
            // the instant in the viewer's own clock, the way the Golden Path text pane stamps it
            head.vdom.cn[1].text = GoldenPathGraphLayout.describeCurrency(value, at => ViewerTime.formatViewerTime(at)?.text ?? null).text;
            head.update()
        }

        if (canvas) {
            canvas.envelope = value
        }
    }

    /**
     * @summary Names the node under the pointer in the head — its label with the producer's rank and
     * score — and returns the gesture hint when the pointer rests on no node.
     * @param {Object} data
     * @param {Object|null} data.node
     */
    onNodeHover({node}) {
        const head = this.getReference('observatory-head'), slot = head?.vdom.cn[2];

        if (slot) {
            slot.text = node ? [
                node.label,
                Number.isInteger(node.rank) ? `rank ${node.rank}` : null,
                typeof node.score === 'number' ? `score ${node.score}` : null
            ].filter(Boolean).join(' · ') : 'drag orbits · wheel zooms';
            slot.cls = ['fm-observatory-hover', ...(node ? [] : ['is-hint'])];
            head.update()
        }
    }
}

export default Neo.setupClass(ObservatoryContainer);
