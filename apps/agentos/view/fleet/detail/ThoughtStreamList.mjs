import BaseList       from '../../../../../node_modules/neo.mjs/src/list/Base.mjs';
import AgentFreshness from '../../../util/AgentFreshness.mjs';

/**
 * The words a row's meta line carries beside its age for a summary weaker than a projected one, and the
 * line that stands in for a summary the wire did not carry.
 * @type {Object<String, String>}
 */
const ROW_WORDS = Object.freeze({
    fallback: 'cut from the raw turn',
    missing : 'no summary served',
    pending : 'summary pending',
    unplaced: 'time unknown'
});

/**
 * @class AgentOS.view.fleet.detail.ThoughtStreamList
 * @extends Neo.list.Base
 *
 * @summary The rows of the Agent Detail's Thought stream pane, one per {@link AgentOS.model.RecentTurn},
 * newest first as the Fleet serves them: a meta line with the turn's age at the pane's clock (the instant
 * itself on its title) and the word for a weaker summary, then the derived summary. The rows inform, so
 * nothing is selectable; drilling into a session is the Memories pane's.
 */
class ThoughtStreamList extends BaseList {
    /**
     * The rows' words, for the specs that read them.
     * @type {Object<String, String>}
     */
    static ROW_WORDS = ROW_WORDS

    static config = {
        /**
         * @member {String} className='AgentOS.view.fleet.detail.ThoughtStreamList'
         * @protected
         */
        className: 'AgentOS.view.fleet.detail.ThoughtStreamList',
        /**
         * @member {String} ntype='fm-thought-stream-list'
         * @protected
         */
        ntype: 'fm-thought-stream-list',
        /**
         * @member {String[]} baseCls=['fm-detail-turn-list','neo-list']
         */
        baseCls: ['fm-detail-turn-list', 'neo-list'],
        /**
         * @member {Boolean} disableSelection=true
         */
        disableSelection: true,
        /**
         * The clock (ms) each row's age is worded against; `null` reads the live `Date.now()`. The
         * owning detail sets it on every render, so a row ages with the pane's own freshness label.
         * @member {Number|null} now_=null
         * @reactive
         */
        now_: null
    }

    /**
     * @summary A new clock re-words the rows the Store already holds; a new answer renders through
     * the Store's own `load`.
     * @param {Number|null} value
     * @param {Number|null} oldValue
     * @protected
     */
    afterSetNow(value, oldValue) {
        oldValue !== undefined && this.store?.getCount() > 0 && this.createItems()
    }

    /**
     * @summary The meta line over the summary. Every fragment is an inert `text` node: the summary is
     * remote data, and the instant rides the meta line's title attribute.
     * @param {AgentOS.model.RecentTurn} record
     * @returns {Object} The item config, merged into the list item
     */
    createItemContent(record) {
        const {meta, summary, timestamp} = ThoughtStreamList.describeRow(record, this.now ?? Date.now());

        return {
            cls: ['fm-detail-turn'],
            cn : [
                {tag: 'span', cls: ['fm-detail-turn-meta'], text: meta, ...(timestamp ? {title: timestamp} : {})},
                {tag: 'span', cls: ['fm-detail-turn-summary'], text: summary}
            ]
        }
    }

    /**
     * @summary One row's words: the age from the turn's instant at the given clock (an instant the row
     * cannot place says so), the note for a pending or fallback summary beside it, and the summary line —
     * or, without one, the line that says none was served. A gap is always named, never a blank row.
     * @param {AgentOS.model.RecentTurn|Object} record
     * @param {Number} now Epoch ms.
     * @returns {{meta: String, summary: String, timestamp: String|null}}
     */
    static describeRow(record, now) {
        const
            timestamp = typeof record.timestamp === 'string' && record.timestamp ? record.timestamp : null,
            instant   = timestamp ? Date.parse(timestamp) : NaN,
            age       = Number.isFinite(instant) ? AgentFreshness.formatAge(now - instant) : ROW_WORDS.unplaced,
            note      = record.projectionPending ? ROW_WORDS.pending : record.summaryFallback ? ROW_WORDS.fallback : null,
            summary   = typeof record.summary === 'string' && record.summary ? record.summary : ROW_WORDS.missing;

        return {
            meta: note ? `${age} · ${note}` : age,
            summary,
            timestamp
        }
    }
}

export default Neo.setupClass(ThoughtStreamList);
