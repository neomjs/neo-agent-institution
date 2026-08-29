import GridContainer from '../../../../../node_modules/neo.mjs/src/grid/Container.mjs';

/**
 * The memories pane's shared grid base — #24 law 0 ("mailbox surfaces, memories and catch-up →
 * `grid.Container`") applied to both memories registers, carrying the ONE-data-path contract the
 * mailbox grid established (Institution #40/#41).
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
 * rows; it fetches nothing) — data acquisition stays the owning pane's drain contract until
 * neomjs/neo#17835 lands the engine's scroll-edge seam.
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
        autoDestroyStore: false
    }

    /**
     * Field names of view-derived display facts (stamped by {@link #stampFacts}), stripped by
     * {@link #extractBags} and re-stamped on the way back in — never round-tripped as data.
     * @member {String[]} derivedFields=[]
     */
    derivedFields = []

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
        const
            me         = this,
            fieldNames = me.store.model.fields
                .map(field => field.name)
                .filter(name => !me.derivedFields.includes(name));

        return (me.store.allItems?.items ?? me.store.items).map(record => {
            const bag = {};

            fieldNames.forEach(name => bag[name] = record[name]);

            return bag
        })
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
