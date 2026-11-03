import AgentDefinitionModel from '../model/AgentDefinition.mjs';
import Store                from '../../../node_modules/neo.mjs/src/data/Store.mjs';

/**
 * Creates fresh sorter configs for case-insensitive alphabetical presentation by displayed agent name:
 * `displayName || githubUsername || id`, with stable identity (`id`) as the tie-breaker.
 * @returns {Object[]}
 */
const createAgentDefinitionSorters = () => [{
    direction: 'ASC',
    property : 'displayName',
    sortBy(a, b) {
        const
            nameA = (a?.displayName || a?.githubUsername || a?.id || '').toLowerCase(),
            nameB = (b?.displayName || b?.githubUsername || b?.id || '').toLowerCase(),
            diff  = nameA.localeCompare(nameB);

        if (diff !== 0) {
            return diff;
        }

        const
            idA = String(a?.id ?? ''),
            idB = String(b?.id ?? '');

        return idA.localeCompare(idB);
    }
}, {
    direction: 'ASC',
    property : 'id'
}];

/**
 * @class AgentOS.store.AgentDefinitions
 * @extends Neo.data.Store
 *
 * @summary Redacted Fleet Manager agent definition list — the shared fleet roster. It starts empty and
 * unloaded: only the Brain's registry readback fills it. Empty and loaded means no agent is defined yet;
 * unloaded means the registry has not answered (before the first read lands, or after a profile switch
 * retired another profile's rows), and the Accounts view says which.
 *
 * **Not a singleton**: the sharing scope is the `state.Provider` that hosts it — the Viewport-level
 * provider `stores` block, the shared ancestor of every consumer ("if used inside a state provider,
 * we get it anyway"). `AgentOS.view.accounts.Panel` lists it and writes the add-agent form's
 * accepted definitions into it, and the cockpit's detail configuration tab resolves the same
 * instance through its composition. No credential bytes ever enter this Body-side store.
 */
class AgentDefinitions extends Store {
    static config = {
        /**
         * @member {String} className='AgentOS.store.AgentDefinitions'
         * @protected
         */
        className: 'AgentOS.store.AgentDefinitions',
        /**
         * @member {Neo.data.Model} model=AgentDefinitionModel
         * @reactive
         */
        model: AgentDefinitionModel,
        /**
         * Alphabetical order A–Z by displayed agent name (displayName || githubUsername || id),
         * case-insensitive, with stable identity as the tie-breaker.
         * @member {Object[]} sorters
         */
        sorters: createAgentDefinitionSorters()
    }

    /**
     * @summary Returns fresh sorter configs for alphabetical presentation by displayed agent name.
     * @returns {Object[]}
     */
    static sortersOf() {
        return createAgentDefinitionSorters()
    }

    /**
     * @summary Re-sort when a record's fields change so accepted definition edits keep the order.
     * @param {Object} data
     */
    onRecordChange(data) {
        super.onRecordChange(data);

        if (this.autoSort && (this.sorters?.length ?? 0) > 0) {
            this.doSort();
        }
    }
}

export default Neo.setupClass(AgentDefinitions);