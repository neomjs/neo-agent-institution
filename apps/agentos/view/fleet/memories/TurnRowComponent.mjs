import Component  from '../../../../../node_modules/neo.mjs/src/component/Base.mjs';
import ViewerTime from '../../../util/ViewerTime.mjs';

/**
 * One authored turn record as a pooled grid cell — the drill register's row anatomy from the
 * merged memories sketch (#37/#38): the meta line (T5 viewer-local stamp with ISO on `title`,
 * authoring identity, tool-call count), the turn's TITLE line, and the prompt as bounded
 * secondary context.
 *
 * @summary The title line follows the sketch's measured law: the tweet-size per-turn
 * `miniSummary` IS the title once the wire carries it (producer exposure:
 * neomjs/neo-agent-brain#210 — until then the field arrives null), and the bounded `response`
 * head stands in meanwhile; when a miniSummary is present the bounded response renders as the
 * prose line beneath it. Bounds are PRESENTATION only — the record keeps the full text, and the
 * cut says so with an ellipsis. Flat pure-vdom cell rendering from a fresh {@link #rowData} bag
 * per factory call (the pooled-cell contract — see
 * {@link AgentOS.view.fleet.memories.SummaryRow}); all content is escaped `text`, and
 * guarded-null prose is NAMED, never coerced.
 *
 * @class AgentOS.view.fleet.memories.TurnRowComponent
 * @extends Neo.component.Base
 */
class TurnRowComponent extends Component {
    static config = {
        /**
         * @member {String} className='AgentOS.view.fleet.memories.TurnRowComponent'
         * @protected
         */
        className: 'AgentOS.view.fleet.memories.TurnRowComponent',
        /**
         * @member {String} ntype='fm-memories-turn-row'
         * @protected
         */
        ntype: 'fm-memories-turn-row',
        /**
         * @member {String[]} baseCls=['fm-memories-turn-cell']
         */
        baseCls: ['fm-memories-turn-cell'],
        /**
         * The plain render bag: `{agentIdentity, amountToolCalls, miniSummary, prompt, response,
         * timestamp}`. A fresh object per factory call.
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
     * @summary Presentation bound for authored prose: whitespace-collapsed and ellipsis-cut.
     * Bounds the ROW, never the data.
     * @param {String|null} value
     * @param {Number} max=600
     * @returns {String|null}
     */
    static boundProse(value, max = 600) {
        if (typeof value !== 'string') return null;

        const text = value.replace(/\s+/g, ' ').trim();

        return text ? (text.length > max ? `${text.slice(0, max)}…` : text) : null
    }

    /**
     * @summary Rebuild the turn row's full vdom from the current bag — one pass, no incremental
     * child mutation (the flat-cell contract).
     */
    buildRow() {
        const
            me       = this,
            data     = me.rowData,
            bound    = TurnRowComponent.boundProse(data.response),
            mini     = typeof data.miniSummary === 'string' && data.miniSummary.trim() ? data.miniSummary.trim() : null,
            iso      = ViewerTime.viewerTimeTitle(data.timestamp),
            prompt   = TurnRowComponent.boundProse(data.prompt, 240),
            metaBits = [
                ViewerTime.formatViewerTime(data.timestamp)?.text ?? 'unknown time',
                data.agentIdentity || null,
                Number.isFinite(data.amountToolCalls) ? `${data.amountToolCalls} tool calls` : null
            ].filter(Boolean),
            children = [{
                cls : ['fm-memories-turn-meta'],
                text: metaBits.join(' · '),
                ...(iso ? {title: iso} : {})
            }];

        if (mini) {
            children.push({cls: ['fm-memories-turn-title'], text: mini});
            bound && children.push({cls: ['fm-memories-turn-response'], text: bound})
        } else {
            children.push({
                cls : ['fm-memories-turn-response'],
                text: bound ?? 'Response unavailable for this turn.'
            })
        }

        prompt && children.push({
            cls : ['fm-memories-turn-prompt'],
            text: `prompt · ${prompt}`
        });

        me.vdom.cn = [{cls: ['fm-memories-turn'], cn: children}];
        me.update()
    }
}

export default Neo.setupClass(TurnRowComponent);
