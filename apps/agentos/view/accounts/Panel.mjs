import AgentConfigCard       from '../fleet/detail/AgentConfigComponent.mjs';
import AgentReposCard        from '../fleet/detail/AgentReposContainer.mjs';
import AddAgentForm          from '../fleet/instances/AddAgentForm.mjs';
import {boundAgentOsBind}    from '../fleet/instances/MenuList.mjs';
import Controller            from './Controller.mjs';
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
         * The bound Agent OS facts (`boundProfileId`, `instanceStore`, `shellCustody`,
         * `shellPlaneBase`) follow the root provider and pass on to the mounted card and form,
         * which name the destination from them. This Panel only forwards them.
         * @member {String|null} boundProfileId_=null
         * @reactive
         */
        boundProfileId_: null,
        /**
         * The provider-hosted instance roster; see `boundProfileId_`.
         * @member {Neo.data.Store|null} instanceStore_=null
         * @reactive
         */
        instanceStore_: null,
        /**
         * True while the installed shell holds the plane binding; see `boundProfileId_`.
         * @member {Boolean} shellCustody_=false
         * @reactive
         */
        shellCustody_: false,
        /**
         * The shell's attached plane, or `null` for this machine; see `boundProfileId_`.
         * @member {String|null} shellPlaneBase_=null
         * @reactive
         */
        shellPlaneBase_: null,
        /**
         * @member {Object} bind
         */
        bind: {
            ...boundAgentOsBind,
            agentDefinitionsStore: 'stores.agentDefinitions',
            fleetRosterStore     : 'stores.fleetRoster',
            fleetTenantsStore    : 'stores.fleetTenants',
            instanceStore        : 'stores.fleetInstances'
        },
        /**
         * @member {String[]} cls=['agent-panel-accounts']
         * @reactive
         */
        cls: ['agent-panel-accounts'],
        /**
         * @member {Neo.controller.Component} controller
         */
        controller: Controller,
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
         * The header is the pane's only drag handle; body gestures remain native.
         * @member {Object[]} headers
         */
        headers: [{
            dock: 'top',
            cls : ['neo-draggable', 'fm-accounts-drag-handle'],
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
     * @summary Bind child presentation to the provider Stores and wire local list selection.
     * The controller handles registry intents after the component is constructed.
     * @param {...*} args
     */
    onConstructed(...args) {
        super.onConstructed(...args);

        const
            me    = this,
            card  = me.getReference('agent-config-card'),
            form  = me.getReference('add-agent-form'),
            repos = me.getReference('agent-repos-card'),
            destination = {
                boundProfileId: me.boundProfileId,
                instanceStore : me.instanceStore,
                shellCustody  : me.shellCustody,
                shellPlaneBase: me.shellPlaneBase
            };

        card?.set({
            agentDefinitionsStore: me.agentDefinitionsStore,
            tenantStore          : me.fleetTenantsStore,
            ...destination
        });
        form?.set(destination);

        if (repos) repos.rosterStore = me.fleetRosterStore;

        me.getReference('agent-list')?.on({select: me.onAgentListSelect, scope: me});

        me.syncSelection()
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

        const card = me.getReference('agent-config-card');

        card?.set({
            agentDefinitionsStore: value,
            tenantStore          : me.fleetTenantsStore,
            boundProfileId       : me.boundProfileId,
            instanceStore        : me.instanceStore,
            shellCustody         : me.shellCustody,
            shellPlaneBase       : me.shellPlaneBase
        });

        if (oldValue && oldValue !== value) {
            me.agentConfigSaveStatuses.clear();
            me.agentReposSaveStatuses.clear()
        }

        me.syncSelection();
        value && me.isConstructed && void me.controller.loadAgentDefinitions()
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
        this.getReference('agent-config-card')?.set({tenantStore: value});
        value && this.isConstructed && void this.controller.loadFleetTenants()
    }

    /** @summary Forward the bound profile change to both setup surfaces. @protected */
    afterSetBoundProfileId(value) {
        this.getReference('agent-config-card')?.set({boundProfileId: value});
        this.getReference('add-agent-form')?.set({boundProfileId: value})
    }

    /** @summary Forward the instance roster change to both setup surfaces. @protected */
    afterSetInstanceStore(value) {
        this.getReference('agent-config-card')?.set({instanceStore: value});
        this.getReference('add-agent-form')?.set({instanceStore: value})
    }

    /** @summary Forward shell custody changes to both setup surfaces. @protected */
    afterSetShellCustody(value) {
        this.getReference('agent-config-card')?.set({shellCustody: value});
        this.getReference('add-agent-form')?.set({shellCustody: value})
    }

    /** @summary Forward the bound plane endpoint change to both setup surfaces. @protected */
    afterSetShellPlaneBase(value) {
        this.getReference('agent-config-card')?.set({shellPlaneBase: value});
        this.getReference('add-agent-form')?.set({shellPlaneBase: value})
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
     * @summary Public Neural Link entrypoint for a canonical definitions refresh. The controller
     * owns the read and its stale-response fences.
     * @returns {Promise<Boolean>} Whether the controller accepted new rows.
     */
    loadAgentDefinitions() {
        return this.controller.loadAgentDefinitions()
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
        me.getReference('agent-list')?.un({select: me.onAgentListSelect, scope: me});
        super.destroy(...args)
    }

}

export default Neo.setupClass(Accounts);
