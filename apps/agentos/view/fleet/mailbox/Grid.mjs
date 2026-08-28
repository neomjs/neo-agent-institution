import GridContainer from '../../../../../node_modules/neo.mjs/src/grid/Container.mjs';
import RowComponent  from './RowComponent.mjs';

/**
 * The mailbox surface as a real buffered grid — the #24 law-0 destination ("mailbox surfaces,
 * memories and catch-up → grid.Container") scored against the merged information-design sketch
 * (`apps/agentos/design/institution-mailbox-pane.html`, #36/#38).
 *
 * @summary A headerless, single-column `Neo.grid.Container`: one pooled
 * {@link AgentOS.view.fleet.mailbox.RowComponent} per rendered row (the component-column pool is
 * the buffering — `bufferRowRange` bounds and recycles mounted rows; it fetches nothing), fed from
 * the injected {@link AgentOS.store.AgentMailbox} store. No paging chrome exists on this surface
 * (operator direction 2026-08-28): the corpus scrolls, and its honest end is the only end — data
 * acquisition stays the owning controller's scroll-edge contract until neomjs/neo#17835 lands the
 * engine seam.
 *
 * **Threads are store truth + view-owned display state.** The thread map (head row, member count)
 * derives from store order per `partOfThread` — newest-first, so the newest message heads its
 * thread (the shipped pane's reading order, kept). Collapse state lives on the head record's
 * view-owned `threadCollapsed` field (the model's ONE display-state exception); collapsed members
 * hide via the grid's store filter, and the head's toggle — a native button inside the row cell —
 * is delegated HERE (one listener, the cell stays passive).
 *
 * The mirror's read-only MUST-NOT stands unchanged: nothing on this surface writes — selection,
 * expansion and scrolling never mark-read.
 *
 * @class AgentOS.view.fleet.mailbox.Grid
 * @extends Neo.grid.Container
 */
class Grid extends GridContainer {
    static config = {
        /**
         * @member {String} className='AgentOS.view.fleet.mailbox.Grid'
         * @protected
         */
        className: 'AgentOS.view.fleet.mailbox.Grid',
        /**
         * @member {String} ntype='fm-mailbox-grid'
         * @protected
         */
        ntype: 'fm-mailbox-grid',
        /**
         * Keeps the mailbox skin anchors on the grid root; the SCSS hides the header toolbar —
         * a headerless designed list, not a data table.
         * @member {String[]} baseCls=['fm-mailbox-grid','neo-grid-container']
         */
        baseCls: ['fm-mailbox-grid', 'neo-grid-container'],
        /**
         * The injected mailbox store is pane/controller-owned — a renderer never destroys it.
         * @member {Boolean} autoDestroyStore=false
         */
        autoDestroyStore: false
    }

    /**
     * The store-derived thread map: `partOfThread` → `{headId, count}`. Rebuilt on every store
     * load/change (cheap: one pass over the loaded window); read by the column factory to hand
     * each cell its display facts.
     * @member {Map|null} threadMap=null
     * @protected
     */
    threadMap = null

    /**
     * @summary One headerless component column: the designed row IS the cell. The factory hands the
     * pooled {@link AgentOS.view.fleet.mailbox.RowComponent} its record plus the thread display
     * facts a lone cell cannot derive (a cell sees one record; the thread's shape is store truth).
     */
    onConstructed() {
        let me = this;

        me.columns = [{
            dataField: 'subject',
            flex     : 1,
            component: ({record}) => ({
                module     : RowComponent,
                record,
                threadFacts: me.threadFactsFor(record)
            })
        }];

        super.onConstructed();

        me.addDomListeners({
            click   : me.onThreadToggleClick,
            delegate: '.fm-mail-thread-toggle',
            scope   : me
        })
    }

    /**
     * Triggered after the store config got changed: rebuild the thread map and arm the collapse
     * filter over the new store.
     * @param {Neo.data.Store|null} value
     * @param {Neo.data.Store|null} oldValue
     * @protected
     */
    afterSetStore(value, oldValue) {
        super.afterSetStore?.(value, oldValue);

        let me = this;

        if (value) {
            me.buildThreadMap();

            // collapsed thread members hide at the store view layer — the one filter this surface
            // owns; heads and standalone rows always pass. `filterBy` follows the collection
            // Filter contract: returning TRUE filters the item OUT. NOTE: the grid body reacts to
            // the store's `filter` / `load` / `recordChange` events ONLY — a wholesale projection
            // (`applySnapshotRows` → the data setter → clear+add) fires none of them, so the
            // OWNING PANE drives {@link #onStoreMutation} after every projection; `store.filter()`
            // inside it is what re-renders the body deterministically.
            value.filters = [...(value.filters || []), {
                filterBy({item}) {
                    const facts = me.threadFactsFor(item);

                    return !!(facts && !facts.isHead && facts.collapsed)
                }
            }]
        }
    }

    /**
     * @summary One pass over the loaded window: first record seen per `partOfThread` is the head
     * (store order is newest-first — the newest message heads its thread), every further one counts.
     * @protected
     */
    buildThreadMap() {
        const
            me  = this,
            map = new Map(),
            // the map derives from the UNFILTERED corpus: once the collapse filter has run, a
            // hidden member is gone from `items`, and a map built over the filtered view would
            // undercount threads (the collection exposes the unfiltered source as `allItems`
            // after its first filter run)
            source = me.store?.allItems?.items ?? me.store?.items;

        source?.forEach(record => {
            const threadId = record.partOfThread;

            if (!threadId) {
                return
            }

            if (!map.has(threadId)) {
                map.set(threadId, {headId: record[me.store.keyProperty], count: 0})
            } else {
                map.get(threadId).count++
            }
        });

        me.threadMap = map
    }

    /**
     * @summary The display facts for one record — `null` for standalone rows. Collapse truth reads
     * from the HEAD record's view-owned `threadCollapsed` field, so a member knows to hide without
     * carrying its own copy of the state.
     * @param {Object} record
     * @returns {Object|null}
     */
    threadFactsFor(record) {
        const
            me       = this,
            threadId = record?.partOfThread,
            entry    = threadId ? me.threadMap?.get(threadId) : null;

        if (!entry) {
            return null
        }

        const
            isHead    = record[me.store.keyProperty] === entry.headId,
            head      = isHead ? record : me.store.get(entry.headId),
            collapsed = head ? head.threadCollapsed !== false : true;

        return {
            collapsed,
            isHead,
            hiddenCount: entry.count,
            inThread   : !isHead
        }
    }

    /**
     * @summary Store content changed: the thread shape may have too — rebuild the map, re-run the
     * collapse filter, and let the buffered rows re-seat.
     * @protected
     */
    onStoreMutation() {
        this.buildThreadMap();
        this.store.filter()
    }

    /**
     * @summary The one interaction this surface owns: toggling a thread head's view-owned
     * `threadCollapsed` display state. Pure navigation — expanding a thread reads nothing and
     * writes nothing beyond the display field (the read-only MUST-NOT stands).
     *
     * Record resolution walks the delegated click path up to the `.neo-grid-row` node, which the
     * grid body stamps with `data.recordId` — the engine's own event→record contract, no index math.
     * @param {Object} data The delegated click; the toggle button sits inside its row cell.
     */
    onThreadToggleClick(data) {
        const
            me       = this,
            rowNode  = (data.path || []).find(node => node.cls?.includes('neo-grid-row')),
            recordId = rowNode?.data?.recordId,
            record   = recordId != null ? me.store.get(recordId) : null;

        if (record?.partOfThread) {
            record.threadCollapsed = record.threadCollapsed === false;
            me.onStoreMutation()
        }
    }
}

export default Neo.setupClass(Grid);
