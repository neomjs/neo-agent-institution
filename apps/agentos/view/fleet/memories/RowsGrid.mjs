import GridContainer from '../../../../../node_modules/neo.mjs/src/grid/Container.mjs';
import RowModel      from '../../../../../node_modules/neo.mjs/src/selection/grid/RowModel.mjs';

/**
 * The memories pane's shared grid base — the view-layer conformance's law 0 ("mailbox surfaces,
 * memories and catch-up → `grid.Container`") applied to both memories registers, carrying the
 * ONE-data-path contract the mailbox grid established.
 *
 * @summary A headerless, single-component-column `Neo.grid.Container` whose every content
 * mutation flows through {@link #applyBags}: plain row bags get their derived display facts
 * stamped ({@link #stampFacts}) and become the store's data in a single set. The store's data
 * path renders the body exactly once per mutation from records that already carry their facts —
 * and every mutation produces NEW record identities, which is what re-seats the pooled cells
 * (the component column short-circuits on an unchanged record). No record mutation happens
 * anywhere above this path: mutating live records fires `recordChange` against a concurrent
 * re-render, and the two overlapping vdom transactions double-mount cell content (measured on
 * the mailbox surface — the architecture here is the fix, not a style).
 *
 * The component-column pool is the buffering (`bufferRowRange` bounds and recycles mounted
 * rows; it fetches nothing). Data acquisition is the owning pane's: the engine's body fires
 * `scrollEdge` when the visible window reaches the loaded end, this grid relays it as its own
 * event, and the pane requests the next window under its own gate.
 *
 * A row is read by selecting it: the engine's `RowModel` owns the click toggle and the ↑/↓ keys,
 * and this grid relays its `select` / `deselect` as `recordSelect` / `recordDeselect` for the
 * pane's reading surface. While the pane reads, the register collapses to its {@link #rail}: the
 * same cells at a smaller height norm, the clamped body hidden.
 *
 * @class AgentOS.view.fleet.memories.RowsGrid
 * @extends Neo.grid.Container
 */
class RowsGrid extends GridContainer {
    static config = {
        /**
         * @member {String} className='AgentOS.view.fleet.memories.RowsGrid'
         * @protected
         */
        className: 'AgentOS.view.fleet.memories.RowsGrid',
        /**
         * The injected store is pane-owned — a renderer never destroys it.
         * @member {Boolean} autoDestroyStore=false
         */
        autoDestroyStore: false,
        /**
         * The rail: the register shrinks to titles beside the pane's reading surface. Swaps the
         * fixed row lattice between {@link #cardRowHeight} and {@link #railRowHeight}; the SCSS
         * height-norms the cells under `.is-rail` to the same totals.
         * @member {Boolean} rail_=false
         * @reactive
         */
        rail_: false,
        /**
         * Selecting a row is how it is read: the engine's View owns the selection model (click
         * toggle, ↑/↓), and the grid relays its select / deselect to the pane.
         * @member {Object} viewConfig={selectionModel: {module: RowModel}}
         */
        viewConfig: {selectionModel: {module: RowModel}}
    }

    /**
     * The full cards' row height — each register sets it equal to its `rowHeight`.
     * @member {Number} cardRowHeight=32
     */
    cardRowHeight = 32
    /**
     * The rail's row height.
     * @member {Number} railRowHeight=32
     */
    railRowHeight = 32

    /**
     * Field names of view-derived display facts (stamped by {@link #stampFacts}), stripped by
     * {@link #extractBags} and re-stamped on the way back in — never round-tripped as data.
     * @member {String[]} derivedFields=[]
     */
    derivedFields = []

    /**
     * @summary Relay the engine body's `scrollEdge` as the grid's own event: the owning pane
     * listens on its register, never on the body.
     * @param {...*} args
     */
    onConstructed(...args) {
        super.onConstructed(...args);

        const me = this;

        me.body.on('scrollEdge', me.onBodyScrollEdge, me);
        me.view.on({
            deselect: me.onViewDeselect,
            select  : me.onViewSelect,
            scope   : me
        })
    }

    /**
     * @param {Boolean} value
     * @param {Boolean} oldValue
     */
    afterSetRail(value, oldValue) {
        const me = this;

        if (oldValue !== undefined) {
            me.toggleCls('is-rail', value);
            me.rowHeight = value ? me.railRowHeight : me.cardRowHeight
        }
    }

    /**
     * @summary Clear the row selection without relaying it: the pane decides what the reader shows.
     */
    clearSelection() {
        this.view.selectionModel?.deselectAllRows()
    }

    /**
     * @summary The View's `deselect` (a selected row clicked again), relayed.
     * @param {Object} data `{record}`
     * @protected
     */
    onViewDeselect(data) {
        this.fire('recordDeselect', {record: data.record})
    }

    /**
     * @summary The View's `select` (a click or ↑/↓), relayed.
     * @param {Object} data `{record}`
     * @protected
     */
    onViewSelect(data) {
        this.fire('recordSelect', {record: data.record})
    }

    /**
     * @summary The body's `scrollEdge`, payload unchanged.
     * @param {Object} data `{count, endIndex, startIndex}`
     * @protected
     */
    onBodyScrollEdge(data) {
        this.fire('scrollEdge', data)
    }

    /**
     * @summary THE one mutation entry: stamp derived display facts into the plain bags, then hand
     * them to the store as its full data set.
     * @param {Object[]} bags Plain row objects.
     */
    applyBags(bags) {
        this.stampFacts(bags);
        this.store.data = bags
    }

    /**
     * @summary The store's current corpus back as plain bags — the read half of the one data path
     * (a window extension re-projects held bags + the new window through {@link #applyBags}).
     * Strips the {@link #derivedFields} (re-stamped on the way back in).
     * @returns {Object[]}
     */
    extractBags() {
        const me = this;

        return (me.store.allItems?.items ?? me.store.items).map(record => me.recordBag(record))
    }

    /**
     * @summary One record back as a plain bag, without the {@link #derivedFields} — what the
     * pane's reading surface renders, never the live record.
     * @param {Neo.data.Model} record
     * @returns {Object}
     */
    recordBag(record) {
        const bag = {};

        this.store.model.fields.forEach(({name}) => {
            this.derivedFields.includes(name) || (bag[name] = record[name])
        });

        return bag
    }

    /**
     * @summary The derivation hook: mutate display facts into the plain bags before they become
     * records. The base grid derives nothing.
     * @param {Object[]} bags
     * @returns {Object[]} The same array.
     */
    stampFacts(bags) {
        return bags
    }
}

export default Neo.setupClass(RowsGrid);
