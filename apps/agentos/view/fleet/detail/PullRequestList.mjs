import BaseList     from '../../../../../node_modules/neo.mjs/src/list/Base.mjs';
import OpenWorkSeat from '../../../util/OpenWorkSeat.mjs';

/**
 * @class AgentOS.view.fleet.detail.PullRequestList
 * @extends Neo.list.Base
 *
 * @summary The rows of the Agent Detail's Pull requests pane, one per
 * {@link AgentOS.model.HeldPullRequest}: the reference as an anchor to the forge, the title when the
 * producer carries one, and one line in the roster chip's words ({@link AgentOS.util.OpenWorkSeat#describeRow}).
 * The rows inform, so nothing is selectable; the shell's window policy owns where an anchor opens.
 */
class PullRequestList extends BaseList {
    static config = {
        /**
         * @member {String} className='AgentOS.view.fleet.detail.PullRequestList'
         * @protected
         */
        className: 'AgentOS.view.fleet.detail.PullRequestList',
        /**
         * @member {String} ntype='fm-pull-request-list'
         * @protected
         */
        ntype: 'fm-pull-request-list',
        /**
         * @member {String[]} baseCls=['fm-detail-pr-list','neo-list']
         */
        baseCls: ['fm-detail-pr-list', 'neo-list'],
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
     * @summary The reference anchor, the title when present, and the row's line. Every fragment is an
     * inert `text` node: the repository name and the title are remote data.
     * @param {AgentOS.model.HeldPullRequest} record
     * @returns {Object} The item config, merged into the list item
     */
    createItemContent(record) {
        const {href, line, ref, title} = OpenWorkSeat.describeRow(record, this.now ?? Date.now());

        return {
            cls: ['fm-detail-pr'],
            cn : [
                {tag: 'a', cls: ['fm-detail-pr-ref'], href, rel: 'noopener', target: '_blank', text: ref},
                ...(title ? [{tag: 'span', cls: ['fm-detail-pr-title'], text: title}] : []),
                {tag: 'span', cls: ['fm-detail-pr-line'], text: line}
            ]
        }
    }
}

export default Neo.setupClass(PullRequestList);
