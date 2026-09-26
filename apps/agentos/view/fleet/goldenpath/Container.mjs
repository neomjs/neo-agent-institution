import Button             from '../../../../../node_modules/neo.mjs/src/button/Base.mjs';
import Component          from '../../../../../node_modules/neo.mjs/src/component/Base.mjs';
import Container          from '../../../../../node_modules/neo.mjs/src/container/Base.mjs';
import GoldenPathEnvelope from '../../../util/GoldenPathEnvelope.mjs';
import GoldenPathItems    from '../../../store/GoldenPathItems.mjs';
import ViewerTime         from '../../../util/ViewerTime.mjs';

/**
 * The resident Golden Path reading surface (a south-strip tab).
 *
 * @summary Renders the `fleetGoldenPath` envelope as text. The currency line comes first, then the
 * route's items in the producer's order, then the producer's provenance. It synthesizes, ranks, merges
 * and caches nothing. The items go into a pane-local Store exactly as written, and a route that is not
 * current says so before any item shows. The envelope is the shell's `goldenPathEnvelope` leaf on the
 * Viewport provider, bound like every other Golden Path pane's. Reads are intent events that the owning
 * cockpit relays to the authenticated fleet bridge.
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
         * @member {String[]} baseCls=['fm-golden-path-pane']
         */
        baseCls: ['fm-golden-path-pane'],
        /**
         * Maximum citations rendered per item before an honest overflow count.
         * @member {Number} citationLimit=3
         */
        citationLimit: 3,
        /**
         * The envelope in the closed shape of {@link AgentOS.util.GoldenPathEnvelope}. `null` and the
         * blank are both unobserved, never empty.
         * @member {Object|null} envelope_=null
         * @reactive
         */
        envelope_: null,
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
            cls   : ['fm-golden-path-head'],
            flex  : 'none',
            layout: {ntype: 'hbox', align: 'center'},
            items : [{
                ntype: 'component',
                cls  : ['fm-golden-path-title'],
                flex : 1,
                text : 'Golden Path'
            }, {
                module   : Button,
                reference: 'golden-path-refresh',
                text     : 'Refresh',
                iconCls  : 'fa fa-rotate',
                ui       : 'ghost',
                handler  : 'up.onRefreshClick'
            }]
        }, {
            ntype    : 'component',
            cls      : ['fm-golden-path-currency', 'is-unobserved'],
            flex     : 'none',
            reference: 'golden-path-currency',
            text     : 'Golden Path not observed yet'
        }, {
            ntype    : 'component',
            cls      : ['fm-golden-path-rem'],
            flex     : 'none',
            reference: 'golden-path-rem'
        }, {
            ntype    : 'container',
            cls      : ['fm-golden-path-items'],
            flex     : 1,
            layout   : {ntype: 'vbox', align: 'stretch'},
            reference: 'golden-path-items'
        }, {
            ntype    : 'component',
            cls      : ['fm-golden-path-provenance'],
            flex     : 'none',
            reference: 'golden-path-provenance'
        }]
    }

    /** @member {AgentOS.store.GoldenPathItems|null} itemStore=null */
    itemStore = null

    /**
     * @summary Creates the pane-local Store, renders any envelope already bound, then requests a read. A resident south-tab pane constructs at projection time, so this first request can fire
     * before the fleet bridge wires. The owning cockpit re-drives the read when the bridge arrives.
     * @param {...*} args
     */
    onConstructed(...args) {
        super.onConstructed(...args);

        this.itemStore = Neo.create(GoldenPathItems);
        this.applyEnvelope();
        this.fire('goldenPathRequest', {})
    }

    /** @param {...*} args */
    destroy(...args) {
        this.itemStore?.destroy();
        this.itemStore = null;
        super.destroy(...args)
    }

    /**
     * @summary A bound envelope can land while the pane is still constructing, so the Store's presence
     * is the guard. An envelope bound before the Store exists is applied by `onConstructed`.
     * @param {Object|null} value
     * @param {Object|null} oldValue
     */
    afterSetEnvelope(value, oldValue) {
        this.itemStore && this.applyEnvelope()
    }

    /** @summary Re-read the computed route. */
    onRefreshClick() {
        this.fire('goldenPathRequest', {})
    }

    /**
     * @summary Projects the latest envelope into the currency line, the REM line, the item Store and the
     * provenance line.
     */
    applyEnvelope() {
        const envelope   = this.envelope,
              currency   = GoldenPathEnvelope.currency(envelope),
              route      = GoldenPathEnvelope.routeOf(envelope),
              currencyEl = this.getReference('golden-path-currency'),
              remEl      = this.getReference('golden-path-rem'),
              itemsEl    = this.getReference('golden-path-items'),
              sourceEl   = this.getReference('golden-path-provenance'),
              stampedAt  = route ? route.capturedAt : envelope?.capability?.capturedAt;

        if (currencyEl) {
            currencyEl.set({cls: ['fm-golden-path-currency', `is-${currency}`], text: this.currencyText(envelope, currency)});
            currencyEl.changeVdomRootKey('title', stampedAt ? ViewerTime.viewerTimeTitle(stampedAt) : null)
        }

        remEl && (remEl.text = this.remText(envelope));

        if (!this.itemStore) return;

        this.itemStore.clear();
        route?.items?.length && this.itemStore.add(route.items.map((item, position) => ({...item, position})));

        if (itemsEl) {
            itemsEl.cls = ['fm-golden-path-items', `is-${currency}`];
            itemsEl.removeAll(true);

            if (route && !route.items?.length) {
                itemsEl.add({module: Component, cls: ['fm-golden-path-empty'], text: `No items in this route · kind ${route.kind || 'unknown'}`})
            } else if (route) {
                itemsEl.add(this.itemStore.items.map(record => this.itemConfig(record)))
            }
        }

        sourceEl && (sourceEl.text = this.provenanceText(route))
    }

    /**
     * @summary The currency line, in the producer's words.
     * @param {Object|null} envelope
     * @param {String} currency
     * @returns {String}
     */
    currencyText(envelope, currency) {
        const route = GoldenPathEnvelope.routeOf(envelope);

        switch (currency) {
            case 'unobserved' : return 'Golden Path not observed yet';
            case 'unavailable': return `Unavailable · ${envelope.capability?.reason || 'no reason given'}`;
            case 'degraded'   : return `Degraded · ${envelope.capability?.reason || envelope.sources?.route?.reason || 'no route'}`;
            case 'withheld'   : return `Withheld · ${GoldenPathEnvelope.withheldReason(envelope)} · last known good route, captured ${this.formatStamp(route.capturedAt)}`;
            default           : return `Current · captured ${this.formatStamp(route.capturedAt)}`
        }
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
     * @summary The producer's provenance for the route shown.
     * @param {Object|null} route
     * @returns {String}
     */
    provenanceText(route) {
        if (!route) return '';

        const {producer, runId, algorithmVersion} = route.provenance || {};

        return `${producer || 'unknown producer'} · run ${runId || 'unknown'} · ${algorithmVersion || 'unknown algorithm'} · expires ${this.formatStamp(route.expiresAt)}${route.expired === true ? ' (expired)' : ''}`
    }

    /**
     * @summary Builds one item card from a Store record: rank, title and score as written, then the id
     * and a bounded list of citations.
     * @param {Neo.data.Model} record
     * @returns {Object}
     */
    itemConfig(record) {
        const labels   = (record.citations || []).map(GoldenPathEnvelope.citationLabel).filter(Boolean),
              visible  = labels.slice(0, this.citationLimit),
              overflow = labels.length - visible.length,
              meta     = [record.id, ...visible, ...(overflow > 0 ? [`${overflow} more`] : [])];

        return {
            module: Container,
            cls   : ['fm-golden-path-item'],
            flex  : 'none',
            layout: {ntype: 'vbox', align: 'stretch'},
            items : [{
                module: Container,
                cls   : ['fm-golden-path-item-head'],
                layout: {ntype: 'hbox', align: 'baseline'},
                items : [
                    {module: Component, cls: ['fm-golden-path-item-rank'],  text: Number.isInteger(record.rank) ? `#${record.rank}` : '—'},
                    {module: Component, cls: ['fm-golden-path-item-title'], flex: 1, text: record.title || record.id},
                    {module: Component, cls: ['fm-golden-path-item-score'], text: typeof record.score === 'number' ? `score ${record.score}` : ''}
                ]
            }, {
                module: Component,
                cls   : ['fm-golden-path-item-meta'],
                text  : meta.join(' · ')
            }]
        }
    }

    /**
     * @summary Viewer-local stamp via the shared cockpit formatter.
     * @param {Date|String|Number|null} value
     * @returns {String}
     */
    formatStamp(value) {
        return ViewerTime.formatViewerTime(value)?.text ?? 'unknown time'
    }
}

export default Neo.setupClass(GoldenPathPane);
