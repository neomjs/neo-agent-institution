import ComponentController   from '../../../../node_modules/neo.mjs/src/controller/Component.mjs';
import AddAgentFlow          from '../../util/AddAgentFlow.mjs';
import ConfigIntentRoundTrip from '../../util/ConfigIntentRoundTrip.mjs';

/**
 * @class AgentOS.view.accounts.Controller
 * @extends Neo.controller.Component
 * @summary Registry workflows for {@link AgentOS.view.accounts.Panel}. Reads and accepted writes
 * use the Viewport's existing Stores; the panel owns selection and transient status presentation.
 * ConfigIntentRoundTrip remains the authority for writes shared with other configuration surfaces.
 */
class Controller extends ComponentController {
    static config = {
        /**
         * @member {String} className='AgentOS.view.accounts.Controller'
         * @protected
         */
        className: 'AgentOS.view.accounts.Controller'
    }

    /**
     * Monotonic guard for overlapping definition reads, alongside the shared write generation.
     * @member {Number} agentDefinitionsLoadGeneration=0
     * @private
     */
    agentDefinitionsLoadGeneration = 0

    /**
     * Monotonic guard for overlapping tenant reads.
     * @member {Number} fleetTenantsLoadGeneration=0
     * @private
     */
    fleetTenantsLoadGeneration = 0

    /**
     * @summary Bind child intents after construction and hydrate the provider-bound Stores.
     * Initial binding setters can run before the controller and children are ready.
     */
    onComponentConstructed() {
        const me = this;

        me.getReference('agent-config-card').on({configIntent: me.onAgentConfigIntent, scope: me});
        me.getReference('agent-repos-card').on({configIntent: me.onAgentReposIntent, scope: me});
        me.getReference('add-agent-form').on({agentDefinitionAccepted: me.onAddAgentAccepted, scope: me});
        void me.loadAgentDefinitions();
        void me.loadFleetTenants()
    }

    /**
     * @summary Unbind child intents before the component destroys its children. Pending reads
     * and status sinks check this controller's lifetime; the provider retains its Stores.
     * @param {...*} args
     */
    destroy(...args) {
        const me = this;

        me.getReference('agent-config-card')?.un({configIntent: me.onAgentConfigIntent, scope: me});
        me.getReference('agent-repos-card')?.un({configIntent: me.onAgentReposIntent, scope: me});
        me.getReference('add-agent-form')?.un({agentDefinitionAccepted: me.onAddAgentAccepted, scope: me});
        super.destroy(...args)
    }

    /**
     * @summary Land a validated definition and notify the Viewport's separate roster-refresh
     * owner. Keep the form visible before the Store emits, preserving its accepted outcome.
     * @param {Object} data
     * @param {Object} data.agent The registry's public definition.
     */
    onAddAgentAccepted({agent}={}) {
        const {component} = this;

        component.adding = true;

        if (this.upsertPublicAgentDefinition(agent)) {
            component.fire('agentDefinitionAccepted', {agent})
        }
    }

    /**
     * @summary Persist a configuration intent and project the canonical readback through the
     * shared runner. The controller is this card's owner token.
     * @param {Object} intent `{id, harnessType?, mcpServers?, mcpTarget?}`.
     * @returns {Promise<void>}
     */
    onAgentConfigIntent(intent={}) {
        return this.runConfigIntent(intent, this, this.component.setAgentConfigSaveStatus.bind(this.component))
    }

    /**
     * @summary Persist a repository intent with a distinct owner token and status sink: an
     * overlapping config save may supersede this request without leaving its card pending.
     * @param {Object} intent `{id, repos}`.
     * @returns {Promise<void>}
     */
    onAgentReposIntent(intent={}) {
        return this.runConfigIntent(intent, this.getReference('agent-repos-card'),
            this.component.setAgentReposSaveStatus.bind(this.component))
    }

    /**
     * @summary Keep late status paints within the original live view and Store binding. The
     * shared runner still admits valid canonical writes to a surviving provider Store.
     * @param {Object} intent
     * @param {Object} owner The status channel's supersession token.
     * @param {Function} setSaveStatus The panel's presentation sink.
     * @returns {Promise<void>}
     * @private
     */
    runConfigIntent(intent, owner, setSaveStatus) {
        const
            me          = this,
            {component} = me,
            store       = component.agentDefinitionsStore;

        return ConfigIntentRoundTrip.runConfigIntentRoundTrip({
            intent,
            owner,
            store,
            setSaveStatus: (...args) => {
                if (!me.isDestroyed && !component.isDestroying && !component.isDestroyed &&
                    store === component.agentDefinitionsStore) {
                    setSaveStatus(...args)
                }
            }
        })
    }

    /**
     * @summary Hydrate the provider's definitions from the canonical public roster. Failed,
     * superseded, replaced-Store or post-destroy reads preserve the prior projection. An accepted
     * write from any owner invalidates an older read through the shared write generation.
     * @returns {Promise<Boolean>} Whether this read replaced the Store's rows.
     */
    async loadAgentDefinitions() {
        const
            me          = this,
            {component} = me,
            store       = component.agentDefinitionsStore,
            bridge      = globalThis.AgentOS?.fleet?.registryBridge,
            generation  = ++me.agentDefinitionsLoadGeneration;

        if (!store || typeof bridge?.listAgents !== 'function' || me.isDestroyed) {
            return false
        }

        const writeGeneration = ConfigIntentRoundTrip.getDefinitionsWriteGeneration(store);

        try {
            const agents = await bridge.listAgents();

            if (!Array.isArray(agents) || me.isDestroyed || component.isDestroying || component.isDestroyed ||
                generation !== me.agentDefinitionsLoadGeneration || store !== component.agentDefinitionsStore ||
                ConfigIntentRoundTrip.getDefinitionsWriteGeneration(store) !== writeGeneration) {
                return false
            }

            store.data = agents;
            return true
        } catch {
            return false
        }
    }

    /**
     * @summary Hydrate public tenant choices on the same provider Store. Curated fields keep
     * credentials out of Body state; invalid, stale and post-destroy responses retain prior rows.
     * @returns {Promise<Boolean>} Whether this read replaced the Store's rows.
     */
    async loadFleetTenants() {
        const
            me          = this,
            {component} = me,
            store       = component.fleetTenantsStore,
            bridge      = globalThis.AgentOS?.fleet?.registryBridge,
            generation  = ++me.fleetTenantsLoadGeneration;

        if (!store || typeof bridge?.listTenants !== 'function' || me.isDestroyed) {
            return false
        }

        try {
            const tenants = await bridge.listTenants();

            if (!Array.isArray(tenants) || tenants.some(tenant =>
                !tenant || typeof tenant !== 'object' || Array.isArray(tenant) ||
                typeof tenant.id !== 'string' || !tenant.id ||
                typeof tenant.endpoint !== 'string' || !tenant.endpoint ||
                typeof tenant.status !== 'string' || !tenant.status
            ) || me.isDestroyed || component.isDestroying || component.isDestroyed ||
                generation !== me.fleetTenantsLoadGeneration || store !== component.fleetTenantsStore) {
                return false
            }

            store.data = tenants.map(tenant => ({
                id             : tenant.id,
                endpoint       : tenant.endpoint,
                status         : tenant.status,
                deploymentClass: typeof tenant.deploymentClass === 'string' ? tenant.deploymentClass : null,
                connectedAt    : typeof tenant.connectedAt === 'string' ? tenant.connectedAt : null
            }));

            return true
        } catch {
            return false
        }
    }

    /**
     * @summary Upsert a validated public definition into the existing provider Store, preserving
     * record identity for an existing agent. The FleetAgent roster belongs to the Viewport.
     * @param {Object} definition The registry's public readback.
     * @returns {Boolean} Whether the definition was admitted.
     */
    upsertPublicAgentDefinition(definition) {
        const store = this.component.agentDefinitionsStore;

        if (!store || !AddAgentFlow.validateReadback(definition).valid) {
            return false
        }

        const record = store.get(definition.id);

        record ? record.set(definition) : store.add(definition);
        return true
    }
}

export default Neo.setupClass(Controller);
