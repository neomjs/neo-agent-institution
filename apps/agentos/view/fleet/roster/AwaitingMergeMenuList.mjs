import MenuList from '../../../../../node_modules/neo.mjs/src/menu/List.mjs';

/**
 * @class AgentOS.view.fleet.roster.AwaitingMergeMenuList
 * @extends Neo.menu.List
 *
 * @summary The floating list behind the fleet head's awaiting-merge button: one row per pull request
 * the operator can merge, straight from the provider-owned {@link AgentOS.store.FleetAwaitingMerge}
 * Store. The rows inform; merging stays on the forge. A row's title carries the pull request's URL.
 * The provider Store is never destroyed with this view.
 */
class AwaitingMergeMenuList extends MenuList {
    static config = {
        /**
         * @member {String} className='AgentOS.view.fleet.roster.AwaitingMergeMenuList'
         * @protected
         */
        className: 'AgentOS.view.fleet.roster.AwaitingMergeMenuList',
        /**
         * @member {String[]} cls=['fm-awaiting-merge-menu']
         * @reactive
         */
        cls: ['fm-awaiting-merge-menu'],
        /**
         * The Store belongs to the Viewport state.Provider, not this transient menu.
         * @member {Boolean} autoDestroyStore=false
         */
        autoDestroyStore: false,
        /**
         * @member {Object} _vdom
         */
        _vdom: {
            tag         : 'ul',
            role        : 'menu',
            'aria-label': 'Pull requests awaiting your merge',
            cn          : []
        }
    }

    /**
     * @summary Preserve provider Store ownership when a binding replaces the Store instance: list.Base
     * destroys a replaced Store it assumes is its own, so this detaches the inherited listeners and
     * returns the new instance verbatim.
     * @param {Neo.data.Store} value
     * @param {Neo.data.Store|null} oldValue
     * @returns {Neo.data.Store}
     * @protected
     */
    beforeSetStore(value, oldValue) {
        let me = this;

        oldValue?.un({
            filter      : me.onStoreFilter,
            load        : me.onStoreLoad,
            recordChange: me.onStoreRecordChange,
            sort        : me.onStoreSort,
            scope       : me
        });

        return value
    }

    /**
     * @summary One row: the pull request's reference, and `stale` when the producer has not observed it
     * lately. Every row in the queue is approved on its head, green and mergeable, so the list's name says
     * that once. Every fragment is an inert `text` node: the repository name is remote data.
     * @param {AgentOS.model.OpenPullRequest} record
     * @returns {Object}
     */
    createItemContent(record) {
        return {
            cls  : ['fm-awaiting-merge-row', ...(record.stale ? ['is-stale'] : [])],
            role : 'menuitem',
            title: `https://github.com/${record.repo}/pull/${record.number}`,
            cn   : [
                {tag: 'span', cls: ['fm-awaiting-merge-ref'], text: `${record.repo} #${record.number}`},
                ...(record.stale ? [{tag: 'span', cls: ['fm-awaiting-merge-stale'], text: 'stale'}] : [])
            ]
        }
    }

    /**
     * @summary A row informs; activating it closes the list.
     * @param {Object} node
     * @param {Object} data
     */
    onItemClick(node, data) {
        this.unmount()
    }

    /**
     * @summary Gives the parent button the concrete menu instance after lazy construction.
     */
    onConstructed() {
        super.onConstructed();
        Object.assign(this.getVdomRoot(), {
            role        : 'menu',
            'aria-label': 'Pull requests awaiting your merge'
        });
        this.parentComponent?.onMergeMenuReady(this)
    }

    /**
     * @summary Keeps the button's expanded state in step with every dismissal path.
     */
    unmount() {
        this.parentComponent?.syncMenuExpanded(false);
        super.unmount()
    }
}

export default Neo.setupClass(AwaitingMergeMenuList);
