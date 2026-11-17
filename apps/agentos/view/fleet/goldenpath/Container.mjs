import Button             from '../../../../../node_modules/neo.mjs/src/button/Base.mjs';
import MarkdownComponent  from '../../../../../node_modules/neo.mjs/src/component/markdown/Component.mjs';
import Container          from '../../../../../node_modules/neo.mjs/src/container/Base.mjs';
import GoldenPathEnvelope from '../../../util/GoldenPathEnvelope.mjs';
import ViewerTime         from '../../../util/ViewerTime.mjs';

/**
 * The resident Golden Path reading surface (a south-strip tab).
 *
 * @summary Renders the `fleetGoldenPath` envelope as a complete producer-written Markdown reading surface.
 * The typed route remains compact independent state (currency, REM and provenance), never a duplicate
 * rendering of the same recommendations; it reads first, as one facts row under the head, in the order
 * of trust — when the route was captured, how digested the memory behind it is, which run produced it,
 * when the recommendation's own source last changed — and the recommendation is the pane's scrolling
 * column beneath it, so the facts never leave the screen whatever height the pane gets. It synthesizes, ranks, merges and caches nothing. The envelope is the
 * cockpit's `goldenPathEnvelope` leaf, bound like every other Golden Path pane's. Reads are intent events
 * that the owning cockpit relays to the authenticated fleet bridge.
 *
 * @class AgentOS.view.fleet.goldenpath.Container
 * @extends Neo.container.Base
 */
class GoldenPathPane extends Container {
    static config = {
        /**
         * @member {String} className='AgentOS.view.fleet.goldenpath.Container'
         * @protected
         */
        className: 'AgentOS.view.fleet.goldenpath.Container',
        /**
         * @member {String} ntype='fm-golden-path-pane'
         * @protected
         */
        ntype: 'fm-golden-path-pane',
        /**
         * @member {String[]} baseCls=['fm-golden-path-pane','fm-pane']
         */
        baseCls: ['fm-golden-path-pane', 'fm-pane'],
        /**
         * The envelope in the closed shape of {@link AgentOS.util.GoldenPathEnvelope}. `null` and the
         * blank are both unobserved, never empty.
         * @member {Object|null} envelope_=null
         * @reactive
         */
        envelope_: null,
        /**
         * The viewer's clock (epoch ms) the facts row is measured against. The cockpit's liveness pass
         * sets it, so the currency word and the stamps age without a new envelope; `null` reads the clock
         * at each apply.
         * @member {Number|null} now_=null
         * @reactive
         */
        now_: null,
        /**
         * @member {Object} layout={ntype:'vbox',align:'stretch'}
         * @reactive
         */
        layout: {ntype: 'vbox', align: 'stretch'},
        /**
         * @member {Object[]} items
         */
        items: [{
            ntype : 'container',
            cls   : ['fm-pane-head'],
            flex  : 'none',
            layout: {ntype: 'hbox', align: 'center', wrap: 'wrap'},
            items : [{
                ntype: 'component',
                cls  : ['fm-pane-title'],
                text : 'Golden Path'
            }, {
                ntype : 'container',
                cls   : ['fm-pane-actions'],
                layout: {ntype: 'hbox', align: 'center'},
                items : [{
                    module   : Button,
                    reference: 'golden-path-refresh',
                    text     : 'Refresh',
                    iconCls  : 'fa fa-rotate',
                    ui       : 'ghost',
                    handler  : 'up.onRefreshClick'
                }]
            }]
        }, {
            ntype    : 'container',
            cls      : ['fm-golden-path-facts'],
            flex     : 'none',
            layout   : {ntype: 'hbox', align: 'center', wrap: 'wrap'},
            reference: 'golden-path-facts',
            items    : [{
                ntype    : 'component',
                cls      : ['fm-golden-path-currency', 'is-unobserved'],
                reference: 'golden-path-currency',
                text     : 'Typed route · not observed yet'
            }, {
                ntype    : 'component',
                cls      : ['fm-golden-path-rem'],
                reference: 'golden-path-rem'
            }, {
                ntype    : 'component',
                cls      : ['fm-golden-path-provenance'],
                reference: 'golden-path-provenance'
            }, {
                ntype    : 'component',
                cls      : ['fm-golden-path-handoff-state'],
                hidden   : true,
                reference: 'golden-path-handoff-state'
            }]
        }, {
            module    : MarkdownComponent,
            cls       : ['fm-golden-path-markdown'],
            flex      : 1,
            reference : 'golden-path-markdown',
            value     : null,
            // A handoff is a complete producer document, not an appending transcript. Rendering every
            // block lets the column's scroll surface begin at its heading instead of following a
            // synthetic tail window.
            virtualize: false
        }]
    }

    /**
     * @summary Renders any envelope already bound, then requests a read. A resident south-tab pane constructs at projection time, so this first request can fire
     * before the fleet bridge wires. The owning cockpit re-drives the read when the bridge arrives.
     * @param {...*} args
     */
    onConstructed(...args) {
        super.onConstructed(...args);

        this.applyEnvelope();
        this.fire('goldenPathRequest', {})
    }

    /**
     * @summary A bound envelope can land while the pane is still constructing; the primary Markdown and
     * its independent typed-route chrome are applied once the reference tree exists.
     * @param {Object|null} value
     * @param {Object|null} oldValue
     */
    afterSetEnvelope(value, oldValue) {
        this.isConstructed && this.applyEnvelope()
    }

    /**
     * @summary A new pass instant re-applies the facts row against it.
     * @param {Number|null} value
     * @param {Number|null} oldValue
     */
    afterSetNow(value, oldValue) {
        this.isConstructed && this.applyEnvelope()
    }

    /** @summary Re-read the computed route. */
    onRefreshClick() {
        this.fire('goldenPathRequest', {})
    }

    /**
     * @summary Projects the latest envelope into independent typed-route chrome and the complete
     * producer-written handoff section. Handoff source metadata never stands in for the route's capture.
     */
    applyEnvelope() {
        const envelope   = this.envelope,
              now        = this.now ?? Date.now(),
              currency   = GoldenPathEnvelope.currency(envelope, now),
              handoff    = envelope?.handoff,
              route      = GoldenPathEnvelope.routeOf(envelope),
              currencyEl = this.getReference('golden-path-currency'),
              handoffEl  = this.getReference('golden-path-handoff-state'),
              markdownEl = this.getReference('golden-path-markdown'),
              remEl      = this.getReference('golden-path-rem'),
              sourceEl   = this.getReference('golden-path-provenance'),
              stampedAt  = route ? route.capturedAt : envelope?.capability?.capturedAt,
              title      = stampedAt ? ViewerTime.viewerTimeTitle(stampedAt) : null;

        if (currencyEl) {
            currencyEl.set({cls: ['fm-golden-path-currency', `is-${currency}`], text: this.currencyText(envelope, currency, now)});
            // a pass re-applies every 15 s: only a changed title is worth a vdom update
            (currencyEl.getVdomRoot().title ?? null) !== title && currencyEl.changeVdomRootKey('title', title)
        }

        remEl && (remEl.text = this.remText(envelope));

        const handoffState = this.handoffText(handoff, now);

        handoffEl?.set({hidden: !handoffState, text: handoffState});
        markdownEl && (markdownEl.value = typeof handoff?.markdown === 'string' ? handoff.markdown : null);

        sourceEl && (sourceEl.text = this.provenanceText(route, now))
    }

    /**
     * @summary The currency line, in the producer's words.
     * @param {Object|null} envelope
     * @param {String} currency
     * @param {Number} now The viewer's clock, epoch ms.
     * @returns {String}
     */
    currencyText(envelope, currency, now) {
        const route = GoldenPathEnvelope.routeOf(envelope);

        switch (currency) {
            case 'unobserved' : return 'Typed route · not observed yet';
            case 'unavailable': return `Typed route · unavailable · ${envelope.capability?.reason || 'no reason given'}`;
            case 'degraded'   : return `Typed route · degraded · ${envelope.capability?.reason || envelope.sources?.route?.reason || 'no route'}`;
            case 'withheld'   : return `Typed route · withheld · ${GoldenPathEnvelope.withheldReason(envelope, now)} · last known good route, captured ${this.formatStamp(route.capturedAt, now)}`;
            default           : return `Typed route · current · captured ${this.formatStamp(route.capturedAt, now)}`
        }
    }

    /**
     * @summary Names the handoff artifact's own freshness independently from the typed route. `mtimeMs`
     * means the source document changed; it is never presented as the Golden Path's capture instant.
     * @param {Object|null} handoff
     * @param {Number} now The viewer's clock, epoch ms.
     * @returns {String}
     */
    handoffText(handoff, now) {
        if (!handoff || typeof handoff !== 'object') return '';

        const updated = Number.isFinite(handoff.mtimeMs) ? this.formatStamp(handoff.mtimeMs, now) : null;

        if (typeof handoff.markdown !== 'string') {
            return handoff.reason ? `Recommendation unavailable · ${handoff.reason}` : 'Recommendation unavailable'
        }

        return [handoff.stale === true ? 'Recommendation source stale' : 'Recommendation source', updated && `updated ${updated}`]
            .filter(Boolean)
            .join(' · ')
    }

    /**
     * @summary The REM counts that explain a withheld route, or the reason they are missing.
     * @param {Object|null} envelope
     * @returns {String}
     */
    remText(envelope) {
        const rem   = GoldenPathEnvelope.remOf(envelope),
              count = value => Number.isInteger(value) ? value : '?';

        if (rem) return `REM · ${count(rem.undigested)} undigested · ${count(rem.digested)} digested · ${count(rem.recentCycles)} recent cycles`;

        return envelope?.sources?.rem?.reason ? `REM unavailable · ${envelope.sources.rem.reason}` : ''
    }

    /**
     * @summary The producer's provenance for the route shown. The run id is the one value this line exists
     * to show, so its absence is said in words rather than as `unknown`.
     * @param {Object|null} route
     * @param {Number} now The viewer's clock, epoch ms.
     * @returns {String}
     */
    provenanceText(route, now) {
        if (!route) return '';

        const
            {producer, runId, algorithmVersion} = route.provenance || {},
            run = runId ? `run ${runId}` : 'run id not recorded by the synthesizer';

        return `${producer || 'unknown producer'} · ${run} · ${algorithmVersion || 'unknown algorithm'} · expires ${this.formatStamp(route.expiresAt, now)}${GoldenPathEnvelope.isExpired(route, now) ? ' (expired)' : ''}`
    }

    /**
     * @summary Viewer-local stamp via the shared cockpit formatter, on the viewer's day as of `now`.
     * @param {Date|String|Number|null} value
     * @param {Number} now The viewer's clock, epoch ms.
     * @returns {String}
     */
    formatStamp(value, now) {
        return ViewerTime.formatViewerTime(value, {now})?.text ?? 'unknown time'
    }
}

export default Neo.setupClass(GoldenPathPane);
