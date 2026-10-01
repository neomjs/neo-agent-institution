import AgentDefinitionModel from '../model/AgentDefinition.mjs';
import Store                from '../../../node_modules/neo.mjs/src/data/Store.mjs';

/**
 * @class AgentOS.store.AgentDefinitions
 * @extends Neo.data.Store
 *
 * @summary Redacted Fleet Manager agent definition list — the shared fleet roster. It starts empty:
 * only the Brain's registry readback fills it, so an empty store means no agent is defined yet, and
 * the Accounts view says so.
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
        model: AgentDefinitionModel
    }
}

export default Neo.setupClass(AgentDefinitions);
