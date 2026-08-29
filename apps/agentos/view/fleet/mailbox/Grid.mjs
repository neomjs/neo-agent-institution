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
 * **ONE data path.** Every mutation of this surface — wholesale projection, window append, thread
 * toggle — flows through {@link #applyBags}: plain row bags get their thread facts stamped
 * ({@link #stampThreadFacts}) and become the store's data in a single set. The grid body renders
 * once per mutation from records that already carry their facts, and every mutation produces NEW
 * record identities (which is what re-seats the pooled cells — no version choreography, no
 * recordChange/filter event overlap; two overlapping vdom transactions double-mounted cell content
 * into its own row, measured, not theorized).
 *
 * **Threads are store truth + view-owned display state.** The first row seen per `partOfThread` is
 * the head (newest-first store order — the newest message heads its thread, the shipped pane's
 * reading order). Collapse state lives on the head's view-owned `threadCollapsed` field (the
 * model's ONE display-state exception); collapsed members hide via the grid's store filter, and
 * the head's toggle — a native button inside the row cell — is delegated HERE (one listener, the
 * cell stays passive).
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
         * The engine grid positions rows on a FIXED row lattice — variable row heights overlap
         * cell content onto itself (measured in the mounted browser: 39–84px designed rows on
         * the 32px default lattice). The row is height-NORMED to the tallest designed case
         * (sender + 2-line subject clamp + exception strip) in `mailbox/Grid.scss`
         * (`.fm-mail-row`), and THIS value carries the same total: change one, change both.
         * @member {Number} rowHeight=84
         * @reactive
         */
        rowHeight: 84,
        /**
         * The injected mailbox store is pane/controller-owned — a renderer never destroys it.
         * @member {Boolean} autoDestroyStore=false
         */
        autoDestroyStore: false
    }

    /**
     * @summary One headerless component column: the designed row IS the cell. The factory builds a
     * FRESH `rowData` bag per call — the engine's component-column contract in both directions:
     * the pool short-circuits on an unchanged record (every {@link #applyBags} run creates new
     * record identities, so re-seats always fire), and a re-seat applies configs via `set()` (so
     * the render surface must be a new-reference value, never the same record instance, or
     * afterSet never re-fires).
     */
    onConstructed() {
        let me = this;

        me.columns = [{
            dataField: 'subject',
            flex     : 1,
            component: ({record}) => ({
                module : RowComponent,
                rowData: {
                    from          : record.from,
                    priority      : record.priority,
                    recipientClass: record.recipientClass,
                    relatedTickets: record.relatedTickets,
                    sentAt        : record.sentAt,
                    status        : record.status,
                    subject       : record.subject,
                    taskState     : record.taskState,
                    threadFacts   : record.threadFacts
                }
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
     * Triggered after the store config got changed: arm the collapse filter over the new store.
     * @param {Neo.data.Store|null} value
     * @param {Neo.data.Store|null} oldValue
     * @protected
     */
    afterSetStore(value, oldValue) {
        super.afterSetStore?.(value, oldValue);

        if (value) {
            // collapsed thread members hide at the store view layer — the one filter this surface
            // owns; heads and standalone rows always pass. `filterBy` follows the collection
            // Filter contract: returning TRUE filters the item OUT. It reads the facts stamped at
            // bag time ({@link #applyBags}), never a live re-derivation, so the filter and the
            // rendered cells can never disagree — and the facts exist BEFORE the data path's
            // filter-during-add renders the first cells.
            value.filters = [...(value.filters || []), {
                filterBy({item}) {
                    const facts = item.threadFacts;

                    return !!(facts && !facts.isHead && facts.collapsed)
                }
            }]
        }
    }

    /**
     * @summary THE one mutation entry: stamp thread facts into the plain bags, then hand them to
     * the store as its full data set. The data path (clear + add) re-runs the collapse filter and
     * renders the body exactly once, from records that already carry their facts as fields — and
     * because every run creates new record identities, the pooled cells re-seat without any
     * version choreography.
     * @param {Object[]} bags Plain row objects (already carrying `threadCollapsed` view state).
     */
    applyBags(bags) {
        this.stampThreadFacts(bags);
        this.store.data = bags
    }

    /**
     * @summary The store's current corpus back as plain bags — the read half of the one data path
     * (mutations re-project through {@link #applyBags}). Reads the UNFILTERED source (`allItems`
     * once the collapse filter has run — hidden members must survive a re-projection) and strips
     * the derived `threadFacts` (re-stamped on the way back in).
     * @returns {Object[]}
     */
    extractBags() {
        const
            me         = this,
            fieldNames = me.store.model.fields.map(field => field.name).filter(name => name !== 'threadFacts');

        return (me.store.allItems?.items ?? me.store.items).map(record => {
            const bag = {};

            fieldNames.forEach(name => bag[name] = record[name]);

            return bag
        })
    }

    /**
     * @summary Stamp thread display facts into PLAIN projection bags BEFORE they become records —
     * facts that arrive only after the store set would miss the data path's immediate
     * filter-during-add render (measured: cells seated with `facts: null`). Bags are mutated
     * in place; the first bag seen per `partOfThread` is the head (newest-first order), and
     * collapse truth reads from the head's view-owned `threadCollapsed` field, so a member knows
     * to hide without carrying its own copy of the state.
     * @param {Object[]} bags The projection rows (already carrying `threadCollapsed`).
     * @returns {Object[]} The same array, facts stamped.
     */
    stampThreadFacts(bags) {
        const map = new Map();

        bags.forEach(bag => {
            const threadId = bag.partOfThread;

            if (!threadId) {
                return
            }

            if (!map.has(threadId)) {
                map.set(threadId, {head: bag, count: 0})
            } else {
                map.get(threadId).count++
            }
        });

        bags.forEach(bag => {
            const entry = bag.partOfThread ? map.get(bag.partOfThread) : null;

            if (entry) {
                const isHead = entry.head === bag;

                bag.threadFacts = {
                    collapsed  : entry.head.threadCollapsed !== false,
                    isHead,
                    hiddenCount: entry.count,
                    inThread   : !isHead
                }
            }
        });

        return bags
    }

    /**
     * @summary The one interaction this surface owns: toggling a thread head's view-owned
     * `threadCollapsed` display state. Pure navigation — expanding a thread reads nothing and
     * writes nothing beyond the display field (the read-only MUST-NOT stands). The flip rides the
     * one data path: extract the corpus, flip the head's bag, re-apply — never a record mutation
     * (mutating live records fires recordChange against the filter re-render, and the two
     * overlapping vdom transactions double-mount the head cell's content).
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
            const
                bags = me.extractBags(),
                head = bags.find(bag => bag[me.store.keyProperty] === record[me.store.keyProperty]);

            head.threadCollapsed = head.threadCollapsed === false;
            me.applyBags(bags)
        }
    }
}

export default Neo.setupClass(Grid);
