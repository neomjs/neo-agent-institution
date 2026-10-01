import AgentConfigCard       from '../fleet/detail/AgentConfigComponent.mjs';
import AgentReposCard        from '../fleet/detail/AgentReposContainer.mjs';
import AddAgentForm          from '../fleet/instances/AddAgentForm.mjs';
import AddAgentFlow          from '../../util/AddAgentFlow.mjs';
import ConfigIntentRoundTrip from '../../util/ConfigIntentRoundTrip.mjs';
import List                  from './List.mjs';
import Button                from '../../../../node_modules/neo.mjs/src/button/Base.mjs';
import DashboardPanel        from '../../../../node_modules/neo.mjs/src/dashboard/Panel.mjs';

/**
 * @class AgentOS.view.accounts.Panel
 * @extends Neo.dashboard.Panel
 *
 * @summary The **Accounts keeper-view**: set up the fleet's agent identities. A master-detail
 * layout: the definitions list (`AgentOS.view.accounts.List`, bound to the shared `agentDefinitions`
 * Store) beside the selected definition's configuration card, or the one add-agent form
 * (`AgentOS.view.fleet.instances.AddAgentForm`, the same component the cockpit rail mounts) while
 * the operator adds an agent. With no definitions yet, the view opens on the form and says so. This
 * view owns identity *setup*; the cockpit owns the live roster and lifecycle.
 *
 * Capability-security boundary: the form submits through the Brain-side Fleet Registry bridge and
 * ends at `agentDefinitionAccepted` with the registry's validated public definition. Only that
 * definition reaches the shared `AgentDefinitions` roster, never a credential byte (mirrors
 * `AgentOS.model.AgentDefinition`'s credential-free shape). This view re-fires the event; the
 * Viewport composition root owns the separate Fleet-cockpit refresh, so Accounts never maps or
 * writes a sibling `FleetAgent` surface. It reads one roster fact: the Repositories card shows the
 * last start's per-repository outcome from the provider's `fleetRoster` Store, as Home reads it.
 */
class Accounts extends DashboardPanel {
    static config = {
        /**
         * @member {String} className='AgentOS.view.accounts.Panel'
         * @protected
         */
        className: 'AgentOS.view.accounts.Panel',
        /**
         * True while the operator adds an agent: the detail shows the form instead of a card. A
         * roster change or an accepted add never moves the operator out of it; picking a row does.
         * @member {Boolean} adding_=false
         * @reactive
         */
        adding_: false,
        /**
         * The shared roster store, bound from the Viewport provider's `stores.agentDefinitions`
         * (see the `bind` config) — declarative and resolved once at construct. Pop-outs swap the
         * render target only, never the owning component/provider tree (components stay one live
         * object in the shared App-Worker heap), so the bound instance naturally stays valid.
         * Never a module-global singleton.
         * @member {Neo.data.Store|null} agentDefinitionsStore_=null
         * @reactive
         */
        agentDefinitionsStore_: null,
        /**
         * The provider-hosted fleet roster, handed to the Repositories card read-only for the last
         * start's per-repository outcome. The cockpit's liveness owner fills it.
         * @member {Neo.data.Store|null} fleetRosterStore_=null
         * @reactive
         */
        fleetRosterStore_: null,
        /**
         * The provider-hosted public tenant roster. The card consumes this exact Store instance;
         * tenant credentials never enter it.
         * @member {Neo.data.Store|null} fleetTenantsStore_=null
         * @reactive
         */
        fleetTenantsStore_: null,
        /**
         * @member {Object} bind
         */
        bind: {
            agentDefinitionsStore: 'stores.agentDefinitions',
            fleetRosterStore     : 'stores.fleetRoster',
            fleetTenantsStore    : 'stores.fleetTenants'
        },
        /**
         * @member {String[]} cls=['agent-panel-accounts']
         * @reactive
         */
        cls: ['agent-panel-accounts'],
        /**
         * The durable id of the agent whose configuration renders in the card — the fleet is
         * MULTIPLE agents; this view is scoped to one at a time via the definitions list.
         * @member {String|null} selectedAgentId_=null
         * @reactive
         */
        selectedAgentId_: null,
        /**
         * @member {Number} flex=1
         */
        flex: 1,
        /**
         * @member {Object[]} headers
         */
        headers: [{
            dock: 'top',
            cls : ['neo-draggable'],
            text: 'Accounts'
        }],
        /**
         * The panel's body: the master column beside the detail. (With headers, the panel's own
         * `layout` stacks header and body; the body takes this config.)
         * @member {Object} containerConfig={layout:{ntype:'hbox',align:'stretch'}}
         */
        containerConfig: {layout: {ntype: 'hbox', align: 'stretch'}},
        /**
         * @member {Function|String|null} popupUrl='apps/agentos/childapps/widget/index.html'
         */
        popupUrl: 'apps/agentos/childapps/widget/index.html',
        /**
         * Master: the add action, the empty state, the definitions list. Detail: the selected
         * definition's card, or the add-agent form.
         * @member {Object[]} items
         */
        items: [{
            ntype    : 'container',
            cls      : ['fm-accounts-master'],
            flex     : 'none',
            layout   : {ntype: 'vbox', align: 'stretch'},
            reference: 'accounts-master',

            items: [{
                module   : Button,
                cls      : ['fm-accounts-add'],
                flex     : 'none',
                handler  : 'up.onAddAgentClick',
                iconCls  : 'fa fa-plus',
                reference: 'add-agent-button',
                text     : 'New agent'   // opens the form; the form's own "Add agent" commits
            }, {
                ntype    : 'component',
                cls      : ['fm-accounts-empty'],
                flex     : 'none',
                reference: 'accounts-empty',
                text     : 'No agents yet. Add the first one with the form.'
            }, {
                module   : List,
                bind     : {store: 'stores.agentDefinitions'},
                flex     : 1,
                reference: 'agent-list'
            }]
        }, {
            ntype    : 'container',
            cls      : ['fm-accounts-detail'],
            flex     : 1,
            layout   : {ntype: 'vbox', align: 'stretch'},
            reference: 'accounts-detail',

            items: [{
                module   : AgentConfigCard,
                flex     : 'none',
                reference: 'agent-config-card'
            }, {
                module   : AgentReposCard,
                flex     : 'none',
                reference: 'agent-repos-card'
            }, {
                module   : AddAgentForm,
                flex     : 'none',
                reference: 'add-agent-form'
            }]
        }]
    }

    /**
     * Monotonic guard for canonical roster reads. An accepted configure response increments the
     * generation so an older listAgents response cannot overwrite newer persisted truth.
     * @member {Number} agentDefinitionsLoadGeneration=0
     * @private
     */
    agentDefinitionsLoadGeneration = 0

    /**
     * Monotonic guard for canonical tenant-roster reads. Only the newest successful, well-formed
     * `listTenants()` response may replace the provider Store; failures preserve last-known rows.
     * @member {Number} fleetTenantsLoadGeneration=0
     * @private
     */
    fleetTenantsLoadGeneration = 0

    /**
     * Ephemeral save status per agent. Selection changes re-project this state onto the card, so a
     * pending/accepted/rejected result never moves to or disappears behind another agent.
     * @member {Map<String,Object>} agentConfigSaveStatuses
     * @private
     */
    agentConfigSaveStatuses = new Map()

    /**
     * Ephemeral save status per agent for the Repositories card, kept apart from the configuration
     * card's: a refused repository list must not paint the configuration card's status line.
     * @member {Map<String,Object>} agentReposSaveStatuses
     * @private
     */
    agentReposSaveStatuses = new Map()

    /**
     * @summary Wire the children's events: each card's `configIntent` (this view owns the bridge
     * round-trip, see {@link #onAgentConfigIntent} and {@link #onAgentReposIntent}), the form's
     * `agentDefinitionAccepted` and the list's `select`.
     * @param {...*} args
     */
    onConstructed(...args) {
        super.onConstructed(...args);

        const
            me    = this,
            card  = me.getReference('agent-config-card'),
            repos = me.getReference('agent-repos-card');

        card?.on({configIntent: me.onAgentConfigIntent, scope: me});
        if (card) card.tenantStore = me.fleetTenantsStore;

        repos?.on({configIntent: me.onAgentReposIntent, scope: me});
        if (repos) repos.rosterStore = me.fleetRosterStore;

        me.getReference('add-agent-form')?.on({agentDefinitionAccepted: me.onAddAgentAccepted, scope: me});
        me.getReference('agent-list')?.on({select: me.onAgentListSelect, scope: me});

        me.syncDetail()
    }

    /**
     * Triggered after the adding config got changed.
     * @param {Boolean} value
     * @param {Boolean} oldValue
     * @protected
     */
    afterSetAdding(value, oldValue) {
        oldValue !== undefined && this.syncDetail()
    }

    /**
     * Triggered after the agentDefinitionsStore config got changed — the provider-bound roster
     * arrives post-construct. Listener discipline: per-call copies (on()/un() consume keys off the
     * object they receive), symmetric unbind of the old store.
     * @param {Neo.data.Store|null} value
     * @param {Neo.data.Store|null} oldValue
     * @protected
     */
    afterSetAgentDefinitionsStore(value, oldValue) {
        let me        = this,
            listeners = {
                load        : me.onAgentRosterChange,
                // membership changes fire `mutate`, not `load` — the Viewport's accepted-definition
                // upsert lands via `store.add()`, and the list and card must show the new resident
                mutate      : me.onAgentRosterChange,
                recordChange: me.onAgentRosterChange,
                scope       : me
            };

        value   ?.on({...listeners});
        oldValue?.un({...listeners});

        me.syncSelection();
        value && void me.loadAgentDefinitions?.()
    }

    /**
     * Triggered after the fleet roster binding changes. The Repositories card listens to the exact
     * Store instance for each roster read; Accounts neither loads nor writes it.
     * @param {Neo.data.Store|null} value
     * @param {Neo.data.Store|null} oldValue
     * @protected
     */
    afterSetFleetRosterStore(value, oldValue) {
        const card = this.getReference('agent-repos-card');

        if (card) card.rosterStore = value
    }

    /**
     * Triggered after the public tenant Store binding changes. The configuration card listens to
     * the exact Store instance for live availability changes; Accounts owns only canonical loading.
     * @param {Neo.data.Store|null} value
     * @param {Neo.data.Store|null} oldValue
     * @protected
     */
    afterSetFleetTenantsStore(value, oldValue) {
        const card = this.getReference('agent-config-card');

        if (card) card.tenantStore = value;
        value && void this.loadFleetTenants?.()
    }

    /**
     * Triggered after the selectedAgentId config got changed — scope the configuration card to the
     * selected agent's record and reflect the selection in the definitions list.
     * @param {String|null} value
     * @param {String|null} oldValue
     * @protected
     */
    afterSetSelectedAgentId(value, oldValue) {
        let me     = this,
            list   = me.getReference('agent-list'),
            record = value ? (me.agentDefinitionsStore?.get(value) ?? null) : null;

        [
            [me.getReference('agent-config-card'), me.agentConfigSaveStatuses],
            [me.getReference('agent-repos-card'),  me.agentReposSaveStatuses]
        ].forEach(([card, statuses]) => {
            if (card) {
                card.record = record;
                // a recordChange mutates fields WITHOUT changing record identity, and the reactive
                // config setter suppresses same-identity assignments — refresh() closes that gap
                card.refresh();

                const status = statuses.get(value) ?? {state: 'idle', reason: ''};
                value && card.setSaveStatus(value, status.state, status.reason)
            }
        });

        if (list?.selectionModel) {
            if (record) {
                list.selectionModel.isSelected(list.getItemId(record.id)) || list.selectionModel.select(record)
            } else {
                list.selectionModel.deselectAll()
            }
        }

        oldValue !== undefined && me.syncDetail()
    }

    /**
     * @summary The add action: the detail switches to the form, and no row stays selected.
     */
    onAddAgentClick() {
        this.set({adding: true, selectedAgentId: null})
    }

    /**
     * @summary The form's accepted definition: land it in the shared roster and re-fire
     * `agentDefinitionAccepted` so the Viewport refreshes the cockpit's roster. The detail stays on
     * the form: its status line carries the outcome, and an accepted add can still need the
     * operator ("its working repository is not set"). The new agent is one click away in the list.
     * The form's flow has already validated the readback; the check here keeps the roster write
     * fail-closed on its own.
     * @param {Object} data
     * @param {Object} data.agent The registry's public definition.
     */
    onAddAgentAccepted({agent}={}) {
        const me = this;

        // before the roster write: the first agent of an empty roster would otherwise take the
        // scope through the store listener and swap the form, with its outcome line, for a card
        me.adding = true;

        if (me.upsertPublicAgentDefinition(agent)) {
            me.fire('agentDefinitionAccepted', {agent})
        }
    }

    /**
     * @summary A list row picked: scope the card to it and leave the add form.
     * @param {Object} data
     * @param {Object[]} data.records
     */
    onAgentListSelect({records}={}) {
        const id = records?.[0]?.id;

        id && this.set({adding: false, selectedAgentId: id})
    }

    /**
     * @summary Any roster change (seed load, add, remove, field readback) re-derives the selection
     * and refreshes the scoped card.
     * @protected
     */
    onAgentRosterChange() {
        this.syncSelection()
    }

    /**
     * @summary The card's `configIntent` → the `configureAgent` bridge round-trip: the registry
     * validates + persists, and the RESPONSE (the public definition — the readback) is written
     * onto the store record, which re-renders the card. Fail-closed: without a bridge nothing
     * mutates locally — a config that did not persist must never render as if it had.
     * @param {Object} intent The one wire shape:
     *     `{id, harnessType?, mcpServers?, mcpTarget?}`.
     * @returns {Promise<void>}
     */
    async onAgentConfigIntent(intent={}) {
        const me = this;

        return ConfigIntentRoundTrip.runConfigIntentRoundTrip({
            intent,
            owner        : me,
            setSaveStatus: me.setAgentConfigSaveStatus.bind(me),
            store        : me.agentDefinitionsStore
        })
    }

    /**
     * @summary The Repositories card's `configIntent` (`{id, repos}`) → the `setRepos` round-trip,
     * through the same runner as {@link #onAgentConfigIntent}. The card itself is the owner token:
     * the runner stays silent when a request is superseded by its own owner, which assumes one
     * status sink per owner, and the two cards are two sinks.
     * @param {Object} intent `{id, repos}`.
     * @returns {Promise<void>}
     */
    async onAgentReposIntent(intent={}) {
        const me = this;

        return ConfigIntentRoundTrip.runConfigIntentRoundTrip({
            intent,
            owner        : me.getReference('agent-repos-card'),
            setSaveStatus: me.setAgentReposSaveStatus.bind(me),
            store        : me.agentDefinitionsStore
        })
    }

    /**
     * @summary Store one agent's ephemeral save state and project it only when that agent is still
     * visible. The state survives selection changes without entering the durable roster model.
     * @param {String} agentId
     * @param {'idle'|'pending'|'accepted'|'rejected'} state
     * @param {String} [reason='']
     */
    setAgentConfigSaveStatus(agentId, state, reason='') {
        this.agentConfigSaveStatuses.set(agentId, {state, reason});
        this.getReference('agent-config-card')?.setSaveStatus(agentId, state, reason)
    }

    /**
     * @summary The Repositories card's twin of {@link #setAgentConfigSaveStatus}.
     * @param {String} agentId
     * @param {'idle'|'pending'|'accepted'|'rejected'|'superseded'} state
     * @param {String} [reason='']
     */
    setAgentReposSaveStatus(agentId, state, reason='') {
        this.agentReposSaveStatuses.set(agentId, {state, reason});
        this.getReference('agent-repos-card')?.setSaveStatus(agentId, state, reason)
    }

    /**
     * @summary Hydrate the provider-hosted AgentDefinitions store from the Brain's canonical public
     * roster. A failed or stale request preserves the last rendered state. A generation guard keeps
     * a slow boot read from overwriting a newer accepted configure response.
     * @returns {Promise<Boolean>} True only when canonical roster data replaced the local projection.
     */
    async loadAgentDefinitions() {
        const
            me         = this,
            store      = me.agentDefinitionsStore,
            bridge     = globalThis.AgentOS?.fleet?.registryBridge,
            generation = (me.agentDefinitionsLoadGeneration || 0) + 1;

        me.agentDefinitionsLoadGeneration = generation;

        if (!store || typeof bridge?.listAgents !== 'function') {
            return false
        }

        // the SHARED write recency: an accepted configure readback from ANY owner (this view's
        // card OR the AgentDetail tab) bumps the store's write generation — a list snapshot older
        // than that write must never regress the store
        const writeGeneration = ConfigIntentRoundTrip.getDefinitionsWriteGeneration(store);

        try {
            const agents = await bridge.listAgents();

            if (!Array.isArray(agents)) {
                return false
            }
            if (
                generation !== me.agentDefinitionsLoadGeneration ||
                store      !== me.agentDefinitionsStore          ||
                ConfigIntentRoundTrip.getDefinitionsWriteGeneration(store) !== writeGeneration
            ) {
                return false
            }

            store.data = agents;
            me.syncSelection();

            return true
        } catch (error) {
            return false
        }
    }

    /**
     * @summary Hydrate the provider-hosted FleetTenants Store from the Brain's public descriptor
     * list. The projection is curated field-by-field so a malformed bridge response cannot smuggle
     * credential-shaped data into Body state. Failed, malformed, or stale reads preserve the last
     * known tenant choices.
     * @returns {Promise<Boolean>} True only when canonical public rows replaced the Store.
     */
    async loadFleetTenants() {
        const
            me         = this,
            store      = me.fleetTenantsStore,
            bridge     = globalThis.AgentOS?.fleet?.registryBridge,
            generation = (me.fleetTenantsLoadGeneration || 0) + 1;

        me.fleetTenantsLoadGeneration = generation;

        if (!store || typeof bridge?.listTenants !== 'function') {
            return false
        }

        try {
            const tenants = await bridge.listTenants();

            if (!Array.isArray(tenants) || tenants.some(tenant =>
                !tenant ||
                typeof tenant !== 'object' ||
                Array.isArray(tenant) ||
                typeof tenant.id !== 'string' ||
                !tenant.id ||
                typeof tenant.endpoint !== 'string' ||
                !tenant.endpoint ||
                typeof tenant.status !== 'string' ||
                !tenant.status
            )) {
                return false
            }
            if (generation !== me.fleetTenantsLoadGeneration || store !== me.fleetTenantsStore) {
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
     * @summary Show the card or the form in the detail, the empty state under an empty list, and
     * the add action as pressed while the form is up. The form shows while adding, and whenever no
     * definition is selected.
     * @protected
     */
    syncDetail() {
        const
            me       = this,
            showForm = me.adding || !me.selectedAgentId,
            card     = me.getReference('agent-config-card'),
            repos    = me.getReference('agent-repos-card'),
            form     = me.getReference('add-agent-form'),
            empty    = me.getReference('accounts-empty'),
            add      = me.getReference('add-agent-button');

        if (card)  card.hidden  = showForm;
        if (repos) repos.hidden = showForm;
        if (form)  form.hidden  = !showForm;
        if (empty) empty.hidden = (me.agentDefinitionsStore?.count ?? 0) > 0;
        if (add)   add.pressed  = showForm
    }

    /**
     * @summary Keep the selection valid against the roster: a vanished agent is deselected, and
     * outside the add form the first definition is selected when none is. The same selection with
     * new record data refreshes the card.
     * @protected
     */
    syncSelection() {
        let me    = this,
            store = me.agentDefinitionsStore,
            valid = me.selectedAgentId && store?.get(me.selectedAgentId);

        if (!valid) {
            me.selectedAgentId = me.adding ? null : (store?.getAt(0)?.id ?? null)
        } else {
            // same selection, possibly new record data (readback) — refresh the card
            me.afterSetSelectedAgentId(me.selectedAgentId, me.selectedAgentId)
        }

        me.syncDetail()
    }

    /**
     * @summary Detach the roster and child listeners; the provider owns the store's own teardown.
     * @param {...*} args
     */
    destroy(...args) {
        let me        = this,
            listeners = {
                load        : me.onAgentRosterChange,
                mutate      : me.onAgentRosterChange,
                recordChange: me.onAgentRosterChange,
                scope       : me
            };

        me.agentDefinitionsStore?.un({...listeners});
        me.getReference('agent-config-card')?.un({configIntent: me.onAgentConfigIntent, scope: me});
        me.getReference('agent-repos-card')?.un({configIntent: me.onAgentReposIntent, scope: me});
        me.getReference('add-agent-form')?.un({agentDefinitionAccepted: me.onAddAgentAccepted, scope: me});
        me.getReference('agent-list')?.un({select: me.onAgentListSelect, scope: me});
        super.destroy(...args)
    }

    /**
     * @summary Write the registry's public definition into the Viewport-owned `AgentDefinitions`
     * store: an existing record updates in place, a new one is added. A definition the flow's
     * readback guard refuses is not written. This is the configuration projection only — the
     * separate FleetAgent roster refreshes through the Viewport-owned `agentDefinitionAccepted`
     * composition seam.
     * @param {Object} definition The public definition from the add-agent form.
     * @returns {Boolean} True when the store holds the definition.
     */
    upsertPublicAgentDefinition(definition) {
        const store = this.agentDefinitionsStore;

        if (!store || !AddAgentFlow.validateReadback(definition).valid) {
            return false
        }

        const record = store.get(definition.id);

        record ? record.set(definition) : store.add(definition);

        return true
    }
}

export default Neo.setupClass(Accounts);
