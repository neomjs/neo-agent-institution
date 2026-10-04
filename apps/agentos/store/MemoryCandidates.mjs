import MemoryCandidateModel from '../model/MemoryCandidate.mjs';
import Store                from '../../../node_modules/neo.mjs/src/data/Store.mjs';

/**
 * @class AgentOS.store.MemoryCandidates
 * @extends Neo.data.Store
 *
 * @summary The existing agents' memory the Add Agent form offers, one record per candidate the Fleet's
 * `fleetMemoryCandidates` read answered. The form replaces the records on every read; an answer that is not
 * a wired list leaves the store empty, and the form names that state instead.
 */
class MemoryCandidates extends Store {
    static config = {
        /**
         * @member {String} className='AgentOS.store.MemoryCandidates'
         * @protected
         */
        className: 'AgentOS.store.MemoryCandidates',
        /**
         * @member {String} keyProperty='source'
         */
        keyProperty: 'source',
        /**
         * @member {Neo.data.Model} model=MemoryCandidateModel
         * @reactive
         */
        model: MemoryCandidateModel
    }
}

export default Neo.setupClass(MemoryCandidates);
