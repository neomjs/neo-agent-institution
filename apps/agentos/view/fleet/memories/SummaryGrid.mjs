import RowsGrid   from './RowsGrid.mjs';
import SummaryRow from './SummaryRow.mjs';

/**
 * The browse register: one agent's session-summary cards through the buffered grid — the second
 * scored #20-arc surface (#44), on the #40/#41 pattern.
 *
 * @summary A headerless single-component-column grid of pooled
 * {@link AgentOS.view.fleet.memories.SummaryRow} cells. Owns two derivations and one delegation:
 * the viewer-calendar band facts ({@link #stampFacts} — the first card of each band carries the
 * band eyebrow; a stamped bag fact, so grouping is decided exactly once, before records exist),
 * and the drill-open click (a native button inside the pooled cell, delegated HERE — the cell
 * stays passive; record resolution walks the engine's `.neo-grid-row` `data.recordId` contract
 * and re-fires as the `cardOpen` event the owning pane consumes — opening a session is a pane
 * INTENT, never grid state).
 *
 * @class AgentOS.view.fleet.memories.SummaryGrid
 * @extends AgentOS.view.fleet.memories.RowsGrid
 */
class SummaryGrid extends RowsGrid {
    static config = {
        /**
         * @member {String} className='AgentOS.view.fleet.memories.SummaryGrid'
         * @protected
         */
        className: 'AgentOS.view.fleet.memories.SummaryGrid',
        /**
         * @member {String} ntype='fm-memories-summary-grid'
         * @protected
         */
        ntype: 'fm-memories-summary-grid',
        /**
         * Keeps the memories skin anchors on the grid root; the SCSS collapses the header
         * toolbar — a headerless designed list, not a data table.
         * @member {String[]} baseCls=['fm-memories-summary-grid','neo-grid-container']
         */
        baseCls: ['fm-memories-summary-grid', 'neo-grid-container'],
        /**
         * The engine grid positions rows on a FIXED row lattice — variable card heights overlap
         * (measured in the browser: 32px default vs ~180px cards stacked cell content on top of
         * itself). The cell is height-NORMED in the SCSS (`.fm-memories-card-cell` in
         * `fleet/memories/Grid.scss`) and THIS value carries the same total: change one, change
         * both.
         * @member {Number} rowHeight=132
         * @reactive
         */
        rowHeight: 132,
        /**
         * The selected target identity — handed to every cell bag so co-author attribution can
         * exclude the target itself. Written by the pane per adopted envelope.
         * @member {String|null} target=null
         */
        target: null,
        /**
         * Injected wall-clock (ms) for the viewer-calendar band derivation; `null` → live
         * `Date.now()`. Test seam — bands are viewer-local by design.
         * @member {Number|null} now=null
         */
        now: null
    }

    /**
     * The band facts are re-derived per projection ({@link RowsGrid#extractBags} strips them).
     * @member {String[]} derivedFields=['bandFacts']
     */
    derivedFields = ['bandFacts']

    /**
     * @summary One headerless component column: the designed card IS the cell. The factory
     * builds a FRESH `rowData` bag per call (the pooled-cell contract — see
     * {@link AgentOS.view.fleet.memories.SummaryRow}).
     */
    onConstructed() {
        let me = this;

        me.columns = [{
            dataField: 'title',
            flex     : 1,
            component: ({record}) => ({
                module : SummaryRow,
                rowData: {
                    bandFacts            : record.bandFacts,
                    category             : record.category,
                    memoryCount          : record.memoryCount,
                    quality              : record.quality,
                    sessionId            : record.sessionId,
                    sourceAgentIdentities: record.sourceAgentIdentities,
                    summary              : record.summary,
                    target               : me.target,
                    timestamp            : record.timestamp,
                    title                : record.title
                }
            })
        }];

        super.onConstructed();

        me.addDomListeners({
            click   : me.onCardOpenClick,
            delegate: '.fm-memories-card-open',
            scope   : me
        })
    }

    /**
     * @summary Stamp the viewer-calendar band facts: the first bag of each band (bags arrive in
     * render order, newest first) carries `{label}`, every other bag explicit `null` — grouping
     * is derived exactly once, at bag time, never re-computed per cell.
     * @param {Object[]} bags
     * @returns {Object[]} The same array, facts stamped.
     */
    stampFacts(bags) {
        const me = this;
        let lastBand = null;

        bags.forEach(bag => {
            const band = me.bandLabelFor(bag.timestamp);

            bag.bandFacts = band !== lastBand && band !== null ? {label: band} : null;
            lastBand = band
        });

        return bags
    }

    /**
     * @summary The viewer-calendar band for one timestamp — viewer-LOCAL calendar days (T5:
     * the reading operator's clock, exact instants stay on the row `title`s): `today`,
     * `yesterday`, `this week` (the five days before yesterday), `earlier`; an unparseable
     * stamp joins no band.
     * @param {String|Number|Date|null} value
     * @returns {String|null}
     */
    bandLabelFor(value) {
        const ms = value instanceof Date ? value.getTime()
            : typeof value === 'number' ? value
            : typeof value === 'string' ? Date.parse(value)
            : NaN;

        if (!Number.isFinite(ms)) {
            return null
        }

        const
            now      = new Date(this.now ?? Date.now()),
            then     = new Date(ms),
            dayStart = date => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime(),
            dayDiff  = Math.floor((dayStart(now) - dayStart(then)) / 86_400_000);

        return dayDiff <= 0 ? 'today' : dayDiff === 1 ? 'yesterday' : dayDiff < 7 ? 'this week' : 'earlier'
    }

    /**
     * @summary The delegated drill-open click: resolve the card's record via the engine's
     * `.neo-grid-row` `data.recordId` contract and re-fire as the pane-consumable `cardOpen`
     * intent event. The grid mutates nothing.
     * @param {Object} data The delegated click; the open button sits inside its row cell.
     */
    onCardOpenClick(data) {
        const
            me       = this,
            rowNode  = (data.path || []).find(node => node.cls?.includes('neo-grid-row')),
            recordId = rowNode?.data?.recordId,
            record   = recordId != null ? me.store.get(recordId) : null;

        record && me.fire('cardOpen', {record, source: me})
    }
}

export default Neo.setupClass(SummaryGrid);
