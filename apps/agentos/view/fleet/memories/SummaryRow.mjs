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
 * @class AgentOS.view.fleet.memories.SummaryRow
 * @extends Neo.component.Base
 */
class SummaryRow extends Component {
    static config = {
        /**
         * @member {String} className='AgentOS.view.fleet.memories.SummaryRow'
         * @protected
         */
        className: 'AgentOS.view.fleet.memories.SummaryRow',
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
            metaBits = [
                stamp,
                `session ${session}`,
                data.category || null,
                Number.isFinite(data.memoryCount) ? `${data.memoryCount} memories` : null,
                Number.isFinite(data.quality) ? `quality ${data.quality}` : null
            ].filter(Boolean),
            coAuthors = (data.sourceAgentIdentities || []).filter(identity => identity !== data.target),
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

        if (coAuthors.length > 0) {
            cardChildren.push({
                cls : ['fm-memories-card-attribution'],
                text: `with ${coAuthors.join(', ')}`
            })
        }

        cardChildren.push({
            cls : ['fm-memories-card-body'],
            text: data.summary ?? 'Summary unavailable for this session.'
        });

        me.vdom.cn = [
            // the band eyebrow renders ONLY on the first card of each viewer-calendar band —
            // a stamped display fact, so the grid filter/cells can never disagree about grouping
            ...(band ? [{cls: ['fm-memories-band'], text: band}] : []),
            {cls: ['fm-memories-card'], cn: cardChildren}
        ];

        me.update()
    }
}

export default Neo.setupClass(SummaryRow);
