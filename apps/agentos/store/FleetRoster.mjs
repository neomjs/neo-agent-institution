import FleetAgentModel from '../model/FleetAgent.mjs';
import Store           from '../../../node_modules/neo.mjs/src/data/Store.mjs';

/**
 * @class AgentOS.store.FleetRoster
 * @extends Neo.data.Store
 *
 * @summary The cockpit fleet roster — ONE Store of {@link AgentOS.model.FleetAgent} records as the
 * single source of truth for every fleet surface (the ranked card grid, the health bar, the
 * lifecycle-control round-trip). **Not a singleton**: the sharing scope is the `state.Provider`
 * that hosts it (`FleetCockpit`'s provider `stores` block — "if used inside a state provider, we
 * get it anyway"), so views bind the shared instance via `bind: {store: 'stores.fleetRoster'}`
 * instead of importing module-global state (the `Portal.store.*` house pattern).
 *
 * The store starts EMPTY — no seed, no fetched JSON, no invented agents: the cockpit's liveness
 * owner lands the fleet's answer through `loadRoster()`, and a test lands rows through the same
 * admission. Until an answer lands the roster surface reads `cold`; an empty answer renders the
 * roster's own empty state.
 */
class FleetRoster extends Store {
    static config = {
        /**
         * @member {String} className='AgentOS.store.FleetRoster'
         * @protected
         */
        className: 'AgentOS.store.FleetRoster',
        /**
         * The durable identity key. Declared on the store as well as the model: the collection
         * layer defaults `keyProperty` to `'id'`, which always wins the store-level
         * `this.keyProperty || this.model.keyProperty` fallback — so the model's `agentId` must be
         * mirrored here to take effect.
         * @member {String} keyProperty='agentId'
         */
        keyProperty: 'agentId',
        /**
         * @member {Neo.data.Model} model=FleetAgentModel
         * @reactive
         */
        model: FleetAgentModel
    }
}

export default Neo.setupClass(FleetRoster);
