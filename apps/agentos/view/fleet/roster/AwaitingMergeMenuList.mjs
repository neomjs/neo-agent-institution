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
     * @summary A replaced provider Store keeps living, so the list lets go of it first.
     * @param {Neo.data.Store} value
     * @param {Neo.data.Store|null} oldValue
     * @returns {Neo.data.Store}
     * @protected
     */
    beforeSetStore(value, oldValue) {
        this.detachStore(oldValue);
        return super.beforeSetStore(value, oldValue)
    }

    /**
     * @summary Releases the four subscriptions list.Base#afterSetStore registers. A list that does
     * not own its Store leaves them behind on swap and destroy, and a destroyed list keeps its id, so
     * the Store's next event would still call into it.
     * @param {Neo.data.Store|null} store
     * @protected
     */
    detachStore(store) {
        // by name, as list.Base registers them: un() matches a string handler only by the same string
        store?.un({
            filter      : 'onStoreFilter',
            load        : 'onStoreLoad',
            recordChange: 'onStoreRecordChange',
            sort        : 'onStoreSort',
            scope       : this
        })
    }

    /**
     * @summary One row: an anchor to the pull request, and `stale` when the producer has not observed it
     * lately. Every row in the queue is approved on its head, green and mergeable, so the list's name says
     * that once. The anchor's text is an inert `text` node (the repository name is remote data) and its
     * `href` is composed from the record's two fields, never taken from the wire; `target="_blank"` reaches
     * the shell's window policy, which hands an allowlisted `https://github.com` link to the system browser
     * and opens no window (the shell ADR's external hand-off).
     * @param {AgentOS.model.OpenPullRequest} record
     * @returns {Object}
     */
    createItemContent(record) {
        const href = `https://github.com/${record.repo}/pull/${record.number}`;

        return {
            cls  : ['fm-awaiting-merge-row', ...(record.stale ? ['is-stale'] : [])],
            role : 'menuitem',
            title: href,
            cn   : [
                {tag: 'a', cls: ['fm-awaiting-merge-ref'], href, rel: 'noopener', target: '_blank', text: `${record.repo} #${record.number}`},
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

    /**
     * @summary The provider Store outlives this menu: release its subscriptions, never the Store.
     * @param {...*} args
     */
    destroy(...args) {
        this.detachStore(this.store);
        super.destroy(...args)
    }
}

export default Neo.setupClass(AwaitingMergeMenuList);
