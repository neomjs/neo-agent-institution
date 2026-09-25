import GoldenPathItemModel from '../model/GoldenPathItem.mjs';
import Store               from '../../../node_modules/neo.mjs/src/data/Store.mjs';

/**
 * @class AgentOS.store.GoldenPathItems
 * @extends Neo.data.Store
 *
 * @summary Pane-local projection store for the items of the computed Golden Path route. It has no
 * sorters, so records keep the producer's order. Each GoldenPathPane owns its store and destroys it with
 * the pane; the route itself stays the producer's, and no record outlives the view.
 */
class GoldenPathItems extends Store {
    static config = {
        /**
         * @member {String} className='AgentOS.store.GoldenPathItems'
         * @protected
         */
        className: 'AgentOS.store.GoldenPathItems',
        /**
         * @member {String} keyProperty='position'
         */
        keyProperty: 'position',
        /**
         * @member {Neo.data.Model} model=GoldenPathItemModel
         * @reactive
         */
        model: GoldenPathItemModel
    }
}

export default Neo.setupClass(GoldenPathItems);
