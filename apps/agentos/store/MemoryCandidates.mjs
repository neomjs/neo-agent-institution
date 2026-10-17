import MemoryCandidateModel from '../model/MemoryCandidate.mjs';
import Store                from '../../../node_modules/neo.mjs/src/data/Store.mjs';

/**
 * @class AgentOS.store.MemoryCandidates
 * @extends Neo.data.Store
 *
 * @summary The memory choice the Add Agent form offers: one record per candidate the Fleet's
 * `fleetMemoryCandidates` read answered, then the empty-memory row (`AddAgentFlow.memoryChoices`). The
 * form replaces the records on every answer.
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
