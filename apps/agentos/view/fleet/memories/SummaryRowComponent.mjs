import Component  from '../../../../../node_modules/neo.mjs/src/component/Base.mjs';
import ViewerTime from '../../../util/ViewerTime.mjs';

/**
 * One session-summary card as a pooled grid cell — the merged memories sketch's card anatomy
 * (`apps/agentos/design/institution-memories-pane.html`, #37/#38): an optional viewer-calendar
 * band eyebrow, the card head (title · DERIVED provenance chip · the drill-open button), the
 * meta line (T5 viewer-local stamp with the exact ISO on `title`, session id, category, counts),
 * explicit co-author attribution, and the summary body.
 *
 * @summary Deliberately FLAT: pure vdom, zero child components — a child-updating cell carries
 * the engine's documented recycle-tearing hazard; a flat cell cannot exhibit it. The cell renders
 * from a plain {@link #rowData} bag (a FRESH object per column-factory call — a re-seat applies
 * configs via `set()`, and a same-reference value never re-fires afterSet). The drill-open
 * affordance is a native button (keyboard-operable) and stays PASSIVE here — the owning
 * {@link AgentOS.view.fleet.memories.SummaryGrid} delegates the click and resolves the record
 * through the engine's `.neo-grid-row` `data.recordId` contract.
 *
 * All content renders as escaped `text` — record-derived strings never become markup. Guarded-null
 * titles/summaries are NAMED (the model's convert guards feed this cell), never coerced.
 *
 * @class AgentOS.view.fleet.memories.SummaryRowComponent
 * @extends Neo.component.Base
 */
class SummaryRowComponent extends Component {
    static config = {
        /**
         * @member {String} className='AgentOS.view.fleet.memories.SummaryRowComponent'
         * @protected
         */
        className: 'AgentOS.view.fleet.memories.SummaryRowComponent',
        /**
         * @member {String} ntype='fm-memories-summary-row'
         * @protected
         */
        ntype: 'fm-memories-summary-row',
        /**
         * @member {String[]} baseCls=['fm-memories-card-cell']
         */
        baseCls: ['fm-memories-card-cell'],
        /**
         * The plain render bag: `{bandFacts, category, memoryCount, quality, sessionId,
         * sourceAgentIdentities, summary, target, timestamp, title}`. A fresh object per
         * factory call — see the class summary for why the record instance itself must never
         * be the render source.
         * @member {Object|null} rowData_=null
         * @reactive
         */
        rowData_: null
    }

    /**
     * @param {Object|null} value
     * @param {Object|null} oldValue
     */
    afterSetRowData(value, oldValue) {
        value && this.buildRow()
    }

    /**
     * @summary Rebuild the card's full vdom from the current bag — one pass, no incremental
     * child mutation (the flat-cell contract).
     */
    buildRow() {
        const
            me       = this,
            data     = me.rowData,
            band     = data.bandFacts?.label,
            session  = typeof data.sessionId === 'string' && data.sessionId ? data.sessionId.slice(0, 8) : 'unknown',
            stamp    = ViewerTime.formatViewerTime(data.timestamp)?.text ?? 'unknown time',
            iso      = ViewerTime.viewerTimeTitle(data.timestamp),
            coAuthors = (data.sourceAgentIdentities || []).filter(identity => identity !== data.target),
            metaBits = [
                stamp,
                `session ${session}`,
                // attribution rides the meta line (the cell is height-NORMED for the grid's fixed
                // row lattice — no per-card extra line), ahead of the counters: who else authored
                // outranks the quality figure when the one-line clamp has to cut
                coAuthors.length > 0 ? `with ${coAuthors.join(', ')}` : null,
                data.category || null,
                Number.isFinite(data.memoryCount) ? `${data.memoryCount} memories` : null,
                Number.isFinite(data.quality) ? `quality ${data.quality}` : null
            ].filter(Boolean),
            cardChildren = [{
                cls: ['fm-memories-card-head'],
                cn : [{
                    cls : ['fm-memories-card-title'],
                    text: data.title ?? 'Title unavailable for this session.'
                }, {
                    cls : ['fm-memories-provenance', 'is-derived'],
                    text: 'derived'
                }, {
                    tag         : 'button',
                    type        : 'button',
                    cls         : ['fm-memories-card-open'],
                    'aria-label': `Open the turn records of session ${session}`,
                    text        : 'turns'
                }]
            }, {
                cls : ['fm-memories-card-meta'],
                text: metaBits.join(' · '),
                ...(iso ? {title: iso} : {})
            }];

        cardChildren.push({
            cls : ['fm-memories-card-body'],
            text: data.summary ?? 'Summary unavailable for this session.'
        });

        me.vdom.cn = [
            // the band SLOT renders on EVERY card (empty text off a band boundary): the cell is
            // height-normed for the grid's fixed row lattice, so the eyebrow may never add a
            // per-card line — only the first card of each viewer-calendar band carries the label
            // (a stamped display fact, so grouping is decided exactly once, at bag time)
            {cls: ['fm-memories-band'], text: band ?? ''},
            {cls: ['fm-memories-card'], cn: cardChildren}
        ];

        me.update()
    }
}

export default Neo.setupClass(SummaryRowComponent);
