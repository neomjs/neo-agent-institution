import BaseList         from '../../../../../node_modules/neo.mjs/src/list/Base.mjs';
import SeatDependencies from '../../../util/SeatDependencies.mjs';

/**
 * @class AgentOS.view.fleet.detail.RepositoryList
 * @extends Neo.list.Base
 *
 * @summary A seat's repository rows, one per {@link AgentOS.model.SeatRepository}: the slug, the last
 * start's outcome in {@link AgentOS.util.SeatDependencies}'s words, and on the Accounts Repositories card
 * either the working repository's tag or a Remove button. Agent Detail's Repository pane reads the same rows
 * without the edit (`editable: false`).
 * The rows are affordances, not a selection. A Remove click fires `removeRepository` with the row's slug, and
 * the card turns it into the seat's new list; the list itself never changes a record.
 */
class RepositoryList extends BaseList {
    static config = {
        /**
         * @member {String} className='AgentOS.view.fleet.detail.RepositoryList'
         * @protected
         */
        className: 'AgentOS.view.fleet.detail.RepositoryList',
        /**
         * @member {String} ntype='fm-repository-list'
         * @protected
         */
        ntype: 'fm-repository-list',
        /**
         * @member {String[]} baseCls=['fm-repository-list','neo-list']
         */
        baseCls: ['fm-repository-list', 'neo-list'],
        /**
         * @member {Boolean} disableSelection=true
         */
        disableSelection: true,
        /**
         * Whether each row carries its edit: the working repository's tag or a Remove button. A surface that
         * only reads the outcomes sets it to `false`.
         * @member {Boolean} editable=true
         */
        editable: true
    }

    /**
     * @summary One delegated listener for every row's Remove button.
     * @param {Object} config
     */
    construct(config) {
        super.construct(config);

        this.addDomListeners({
            click   : this.onRemoveClick,
            delegate: 'fm-repo-remove',
            scope   : this
        })
    }

    /**
     * @summary The slug, the last start's outcome, then on an editable list the working repository's tag or a
     * Remove button, and the outcome's reason whole on its own line. The working repository is set when the
     * agent is added, so the card offers no way to drop it. An outcome this list does not know shows nothing.
     * @param {Object} record An {@link AgentOS.model.SeatRepository} record.
     * @returns {Object[]} vdom child nodes
     */
    createItemContent(record) {
        const outcome = SeatDependencies.label(record.state);

        return [
            {cls: ['fm-repo-slug'], text: record.repoSlug, title: record.cloneUrl},
            outcome && {cls: ['fm-repo-outcome', `is-${record.state}`], text: outcome, title: record.state === 'installing' ? 'This start' : 'At the last start'},
            this.editable && (record.working
                ? {cls: ['fm-repo-working'], text: 'Working'}
                : {
                    tag         : 'button',
                    type        : 'button',
                    cls         : ['fm-repo-remove'],
                    'aria-label': `Remove ${record.repoSlug}`,
                    text        : 'Remove'
                }),
            outcome && record.reason && {cls: ['fm-repo-reason', `is-${record.state}`], text: record.reason}
        ].filter(Boolean)
    }

    /**
     * @summary Resolve a Remove click to its row's record and fire `removeRepository`.
     * @param {Object} data DOM click event data.
     * @protected
     */
    onRemoveClick(data) {
        const
            me     = this,
            item   = data.path?.find(node => node.cls?.includes(me.itemCls)),
            record = item && me.store.get(me.getItemRecordId(item.id));

        record && !record.working && me.fire('removeRepository', {repoSlug: record.repoSlug})
    }
}

export default Neo.setupClass(RepositoryList);
