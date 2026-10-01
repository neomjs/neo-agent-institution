import BaseList from '../../../../../node_modules/neo.mjs/src/list/Base.mjs';

/**
 * @class AgentOS.view.fleet.detail.RepositoryList
 * @extends Neo.list.Base
 *
 * @summary The rows of the Accounts Repositories card, one per {@link AgentOS.model.SeatRepository}:
 * the slug, then either the working repository's tag or a Remove button. The rows are
 * affordances, not a selection. A Remove click fires `removeRepository` with the row's slug, and
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
        disableSelection: true
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
     * @summary The slug, then the working repository's tag or a Remove button. The working
     * repository is set when the agent is added, so this card offers no way to drop it.
     * @param {Object} record An {@link AgentOS.model.SeatRepository} record.
     * @returns {Object[]} vdom child nodes
     */
    createItemContent(record) {
        return [
            {cls: ['fm-repo-slug'], text: record.repoSlug, title: record.cloneUrl},
            record.working
                ? {cls: ['fm-repo-working'], text: 'Working'}
                : {
                    tag         : 'button',
                    type        : 'button',
                    cls         : ['fm-repo-remove'],
                    'aria-label': `Remove ${record.repoSlug}`,
                    text        : 'Remove'
                }
        ]
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
