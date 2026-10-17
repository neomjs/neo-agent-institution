import BaseList         from '../../../../../node_modules/neo.mjs/src/list/Base.mjs';
import SeatDependencies from '../../../util/SeatDependencies.mjs';

/**
 * @class AgentOS.view.fleet.detail.RepositoryList
 * @extends Neo.list.Base
 *
 * @summary Render {@link AgentOS.model.SeatRepository} rows. Accounts supplies independent checkout
 * and dependency facts plus Remove or Delete checkout; Agent Detail retains its dependency-only
 * presentation (`editable: false`). Row actions emit intents and never modify records here.
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
         * Whether each row carries its edit: the working tag, Remove or Delete checkout. A surface that
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
        });
        this.addDomListeners({
            click   : this.onDeleteClick,
            delegate: 'fm-repo-delete',
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
        const facts   = [record.checkout, record.dependency].filter(Boolean);

        return [
            {cls: ['fm-repo-slug'], text: record.repoSlug, title: record.cloneUrl},
            !facts.length && outcome && {cls: ['fm-repo-outcome', `is-${record.state}`], text: outcome, title: record.state === 'installing' ? 'This start' : 'At the last start'},
            this.editable && (record.working
                ? {cls: ['fm-repo-working'], text: 'Working'}
                : (!record.retained || record.canDelete) && {
                    tag         : 'button',
                    type        : 'button',
                    cls         : [record.retained ? 'fm-repo-delete' : 'fm-repo-remove'],
                    'aria-label': `${record.retained ? 'Delete checkout' : 'Remove'} ${record.repoSlug}`,
                    text        : record.retained ? 'Delete checkout' : 'Remove'
                }),
            ...facts.map(fact => ({cls: ['fm-repo-fact', `is-${fact.state ?? 'unknown'}`],
                text: `${fact.text}${fact.reason ? ` · ${fact.reason}` : ''}`, title: fact.title})),
            !facts.length && outcome && record.reason && {cls: ['fm-repo-reason', `is-${record.state}`], text: record.reason}
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

        record && !record.working && !record.retained && me.fire('removeRepository', {repoSlug: record.repoSlug})
    }

    /** @summary Resolve the guarded delete affordance to its retained row. @param {Object} data @protected */
    onDeleteClick(data) {
        const item   = data.path?.find(node => node.cls?.includes(this.itemCls));
        const record = item && this.store.get(this.getItemRecordId(item.id));

        record?.retained && record.canDelete && this.fire('deleteCheckout', {repoSlug: record.repoSlug})
    }
}

export default Neo.setupClass(RepositoryList);
