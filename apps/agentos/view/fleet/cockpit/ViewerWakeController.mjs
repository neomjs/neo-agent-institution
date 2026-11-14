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
     * Whether the viewer's push lane has been armed and live during the current bridge session.
     * @member {Boolean} viewerWakeEverAlive=false
     * @protected
     */
    viewerWakeEverAlive = false

    /**
     * Short bounded timer polling for the initial SSE `state` frame after opening a stream.
     * @member {*|null} viewerWakeHandshakeTimer=null
     * @protected
     */
    viewerWakeHandshakeTimer = null


    /**
     * @summary Cancel any pending post-open handshake check.
     * @protected
     */
    clearViewerWakeHandshakeTimer() {
        if (this.viewerWakeHandshakeTimer !== null) {
            clearTimeout(this.viewerWakeHandshakeTimer);
            this.viewerWakeHandshakeTimer = null
        }
    }


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
            me.clearViewerWakeHandshakeTimer();

            if (me.viewerWakeConsumer) {
                me.viewerWakeConsumer.stop();
                me.viewerWakeConsumer = null;
                me.viewerWakeBridge   = null
            }

            me.viewerWakeEverAlive = false;
            me.stampViewerWake({
                armed : false,
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
            me.watchViewerWakeHandshake(me.viewerWakeConsumer);
            return
        }

        me.clearViewerWakeHandshakeTimer();
        me.viewerWakeConsumer?.stop();
        me.viewerWakeEverAlive = false;

        me.viewerWakeConsumer = bridge.openWakeStream({
            onWake: signal => me.onViewerWakeSignal(signal),
            ...(me.component.wakePollDigest ? {pollDigest: me.component.wakePollDigest} : {})
        });
        me.viewerWakeBridge = bridge;

        me.viewerWakeConsumer.start();
        me.stampViewerWake();
        me.watchViewerWakeHandshake(me.viewerWakeConsumer)
    }


    /**
     * @summary Observe the asynchronous SSE `state` handshake promptly after stream start or
     * reconnect without adding non-whitelisted options to `openWakeStream`.
     * @param {Object} consumer
     * @param {Number} [remaining=20]
     * @protected
     */
    watchViewerWakeHandshake(consumer, remaining = 20) {
        const
            me       = this,
            snapshot = consumer?.describe?.() ?? null;

        if (me.isDestroyed || me.viewerWakeConsumer !== consumer || remaining <= 0) {
            return
        }

        if (!snapshot || !('lastState' in snapshot) || snapshot.lastState !== null || (snapshot.consecutiveDrops > 0 && !snapshot.connected)) {
            return
        }

        if (me.viewerWakeHandshakeTimer !== null) {
            return
        }

        me.viewerWakeHandshakeTimer = setTimeout(() => {
            me.viewerWakeHandshakeTimer = null;

            if (me.isDestroyed || me.viewerWakeConsumer !== consumer) {
                return
            }

            me.stampViewerWake();
            me.watchViewerWakeHandshake(consumer, remaining - 1)
        }, 100);
        me.viewerWakeHandshakeTimer?.unref?.()
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
     * telltale and diagnostics surfaces bind and render from one writer.
     * @param {Object|null} [override=null] Optional `{armed, everAlive, stream}` override.
     * @protected
     */
    stampViewerWake(override = null) {
        const
            me       = this,
            provider = me.component.getStateProvider(),
            consumer = me.viewerWakeConsumer,
            snapshot = consumer?.describe?.() ?? null,
            liveness = override?.stream ?? (consumer
                ? {...consumer.resolveDeliveryLiveness(), capturedAt: Date.now()}
                : {alive: 'unknown', reason: 'wake stream not started', capturedAt: Date.now()}),
            armed    = override && 'armed' in override
                ? override.armed
                : !consumer
                    ? false
                    : snapshot && 'lastState' in snapshot
                        ? (snapshot.lastState === null ? null : Boolean(snapshot.lastState.armedForViewer))
                        : (liveness?.alive === true ? true : null);

        if (override && 'everAlive' in override) {
            me.viewerWakeEverAlive = Boolean(override.everAlive)
        } else if (armed === false) {
            me.viewerWakeEverAlive = false
        } else if (armed === true && liveness?.alive === true) {
            me.viewerWakeEverAlive = true
        }

        if (!provider) return;

        provider.setData('viewerWake', {
            armed,
            everAlive: Boolean(me.viewerWakeEverAlive),
            stream   : liveness,
            catchUp  : snapshot?.lastCatchUp ?? {state: null, at: null, pending: null},
            signals  : (me.getViewerWakeFeed()?.items ?? []).slice(0, 5).map(record => ({
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

        me.clearViewerWakeHandshakeTimer();
        me.viewerWakeConsumer?.stop();
        me.viewerWakeConsumer  = null;
        me.viewerWakeBridge    = null;
        me.viewerWakeEverAlive = false;
        super.destroy(...args)
    }
}

export default Neo.setupClass(ViewerWakeController);
