import ComponentController from '../../../../../node_modules/neo.mjs/src/controller/Component.mjs';

/**
 * @class AgentOS.view.fleet.cockpit.ViewerWakeController
 * @extends Neo.controller.Component
 * @summary The cockpit's viewer-wake custody and observation layer. LivenessController extends
 * it, retaining one final controller instance and the same inherited caller seams. The final
 * cockpit Controller supplies the fresh authenticated bridge getter; this layer never retains
 * credentials or owns transport retry policy. Consumer observations land on the cockpit provider.
 */
class ViewerWakeController extends ComponentController {
    static config = {
        /**
         * @member {String} className='AgentOS.view.fleet.cockpit.ViewerWakeController'
         * @protected
         */
        className: 'AgentOS.view.fleet.cockpit.ViewerWakeController'
    }

    /**
     * The live wake-stream consumer + the bridge identity it was opened against (custody heals
     * swap the bridge; a kept consumer would outlive its authority).
     * @member {Object|null} viewerWakeConsumer=null
     * @protected
     */
    viewerWakeConsumer = null

    /**
     * @member {Object|null} viewerWakeBridge=null
     * @protected
     */
    viewerWakeBridge = null


    /**
     * @summary The provider-owned bounded viewer-wake feed; absent composition yields no feed.
     * @returns {Neo.data.Store|null}
     * @protected
     */
    getViewerWakeFeed() {
        try {
            return this.component.getStateProvider()?.getStore('viewerWakeFeed') ?? null
        } catch {
            return null
        }
    }


    /**
     * @summary Keep exactly one wake-stream consumer bound to the CURRENT bridge identity: a
     * custody heal swaps the bridge, and a consumer kept across that swap would hold a
     * credentialed connection on dead authority. An unwired bridge stamps the honest not-wired
     * truth instead.
     * @protected
     */
    ensureViewerWakeStream() {
        const
            me       = this,
            {bridge} = me;

        if (!bridge?.openWakeStream) {
            if (me.viewerWakeConsumer) {
                me.viewerWakeConsumer.stop();
                me.viewerWakeConsumer = null;
                me.viewerWakeBridge   = null
            }

            me.stampViewerWake({
                stream: {
                    alive     : 'unknown',
                    reason    : 'wake push not wired — this composition carries no direct-browser wake capability',
                    capturedAt: Date.now()
                }
            });
            return
        }

        if (me.viewerWakeConsumer && me.viewerWakeBridge === bridge) {
            me.stampViewerWake();
            return
        }

        me.viewerWakeConsumer?.stop();

        me.viewerWakeConsumer = bridge.openWakeStream({
            onWake: signal => me.onViewerWakeSignal(signal),
            ...(me.component.wakePollDigest ? {pollDigest: me.component.wakePollDigest} : {})
        });
        me.viewerWakeBridge = bridge;

        me.viewerWakeConsumer.start();
        me.stampViewerWake()
    }


    /**
     * @summary One observed wake frame → the bounded feed + an immediate stamp. A frame carrying
     * no envelope is still a receipt (the stream moved) but yields no feed row to fabricate.
     * @param {Object} signal `{subscriptionId, envelope, receivedAt}` from the consumer's onWake.
     * @protected
     */
    onViewerWakeSignal({subscriptionId, envelope, receivedAt}) {
        const me = this;

        if (me.isDestroyed) return;

        if (envelope?.eventId) {
            me.getViewerWakeFeed()?.addSignal({
                eventId  : envelope.eventId,
                kind     : envelope.eventType ?? 'wake',
                logId    : envelope.logId ?? null,
                emittedAt: envelope.emittedAt ?? null,
                receivedAt,
                subscriptionId
            })
        }

        me.stampViewerWake()
    }


    /**
     * @summary Write the consumer's OWN observations into the provider (`viewerWake`) — the
     * telltale binds and renders itself: one writer, zero re-judging, liveness vocabulary and
     * catch-up states pass through verbatim.
     * @param {Object} [override] `{stream}` for the not-wired stamp, when no consumer exists.
     * @protected
     */
    stampViewerWake(override = null) {
        const
            me       = this,
            provider = me.component.getStateProvider(),
            consumer = me.viewerWakeConsumer;

        if (!provider) return;

        provider.setData('viewerWake', {
            stream: override?.stream ?? (consumer
                ? {...consumer.resolveDeliveryLiveness(), capturedAt: Date.now()}
                : {alive: 'unknown', reason: 'wake stream not started', capturedAt: Date.now()}),
            catchUp: consumer?.describe().lastCatchUp ?? {state: null, at: null, pending: null},
            // the bounded signal window rides the stamp so the telltale FORMULA derives the chip
            // from data alone (formulas receive data, never the provider)
            signals: (me.getViewerWakeFeed()?.items ?? []).slice(0, 5).map(record => ({
                kind      : record.kind,
                emittedAt : record.emittedAt,
                receivedAt: record.receivedAt
            }))
        })
    }


    /**
     * @summary Release the credentialed consumer when the final controller leaves. A liveness
     * timer stop is a separate operation and does not retire this stream's custody.
     * @param {...*} args
     */
    destroy(...args) {
        const me = this;

        me.viewerWakeConsumer?.stop();
        me.viewerWakeConsumer = null;
        me.viewerWakeBridge   = null;
        super.destroy(...args)
    }
}

export default Neo.setupClass(ViewerWakeController);
