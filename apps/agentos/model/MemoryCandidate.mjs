import Model from '../../../node_modules/neo.mjs/src/data/Model.mjs';

/**
 * @class AgentOS.model.MemoryCandidate
 * @extends Neo.data.Model
 *
 * @summary One row of an added seat's memory choice. Usually an existing agent's memory, as the Fleet's
 * `fleetMemoryCandidates` read names it: the family that wrote it, the `source` a `memoryImport` consent
 * names, the agent's name, its note count and its newest change. Never a file's contents. The last row
 * is *Start with empty memory*, whose `source` is `'none'`.
 */
class MemoryCandidate extends Model {
    static config = {
        /**
         * @member {String} className='AgentOS.model.MemoryCandidate'
         * @protected
         */
        className: 'AgentOS.model.MemoryCandidate',
        /**
         * @member {String} keyProperty='source'
         * @reactive
         */
        keyProperty: 'source',
        /**
         * @member {Object[]} fields
         */
        fields: [{
            // the memory folder a consent names, passed back unchanged as `memoryImport`
            name: 'source',
            type: 'String'
        }, {
            name        : 'family',
            type        : 'String',
            defaultValue: null
        }, {
            name        : 'name',
            type        : 'String',
            defaultValue: null
        }, {
            name        : 'notes',
            type        : 'Integer',
            defaultValue: 0
        }, {
            // the newest note's change, an ISO date
            name        : 'lastChanged',
            type        : 'String',
            defaultValue: null
        }]
    }
}

export default Neo.setupClass(MemoryCandidate);
