import Component     from '../../../../../node_modules/neo.mjs/src/component/Base.mjs';
import HarnessChoice from '../../../util/HarnessChoice.mjs';
import {
    mcpCatalogFor,
    normalizeMcpOverrides,
    resolveMcpMatrix,
    supportsTenantMcpTarget
} from '../../../../../node_modules/neo-agent-brain/src/fleet/contract/index.mjs';

/**
 * Who launches the seat, in chip order, each with what that owner means here: the fleet cannot see a
 * session it did not start, so the words carry the trust boundary. The operator's one act is adoption.
 * A seat's own harness is not offered back: the fleet starts a seat it has run from that run's record,
 * whatever the seat's owner reads.
 * @type {Readonly<Object<String,{text: String, title: String}>>}
 */
const LAUNCH_OWNERS = Object.freeze({
    fleet   : {text: 'This fleet',      title: 'This fleet is the seat\'s only launcher, so the cockpit starts it. The fleet cannot see a session started elsewhere: do not also run it by hand.'},
    external: {text: 'Its own harness', title: 'The seat runs in a harness this fleet does not start. Unless the fleet has run it before, the cockpit offers no Start: a start here could launch a second session of a live resident.'}
});

/**
 * @class AgentOS.view.fleet.detail.AgentConfigComponent
 * @extends Neo.component.Base
 *
 * @summary The per-agent configuration card — renders ONE selected agent's configuration from its
 * {@link AgentOS.model.AgentDefinition} record plus the shell's provider-owned destination state.
 * The registries (Brain's public Fleet contract) define the harness (offered as the add-agent form offers it — a
 * product, then App or Command line where the product ships both, via `HarnessChoice`; fail-closed
 * "Unknown harness" for unregistered types), the MCP-server matrix (catalog order, effective
 * enable-state via `resolveMcpMatrix` — null matrix = the bound forge's catalog defaults), and the operational
 * toggles with tri-state honesty (On / Off / "Not read back yet" — never an optimistic guess).
 * Every label is operator product language; transport vocabulary never renders.
 *
 * **Two authorities render here, and each section names which one it speaks with.** The registry
 * is a DECLARATION — what a seat is configured to run. The operational toggles are READ BACK — what
 * the fleet actually observed. Presenting both as a bare `On`/`Off` let a declaration masquerade as
 * a measurement: a seat that had filed four issues through its github-workflow server within the
 * hour rendered `GitHub workflow: Off`, because the registry said so and nothing on the row admitted
 * that the registry was all it knew. The operator read a stale declaration as a dead server.
 *
 * So declared rows say `Declared on` / `Declared off` and their sections are marked `· declared`,
 * while read-back rows keep the plain state words under `· read back`. The distinction lives in the
 * WORD rather than a colour, matching `CARD-CONTRACT.md`'s rule that the adjacent hue may carry
 * emphasis but the text is the colour-independent channel. A wrong declaration is now readable AS a
 * wrong declaration — and since these rows are toggles, the operator can correct the thing the row
 * actually reports.
 */
class AgentConfigCard extends Component {
    static config = {
        /**
         * @member {String} className='AgentOS.view.fleet.detail.AgentConfigComponent'
         * @protected
         */
        className: 'AgentOS.view.fleet.detail.AgentConfigComponent',
        /**
         * @member {String} ntype='fm-agent-config-card'
         * @protected
         */
        ntype: 'fm-agent-config-card',
        /**
         * @member {String[]} baseCls=['fm-agent-config-card']
         */
        baseCls: ['fm-agent-config-card'],
        /**
         * The selector-chip primitive's skin (fleet/mailbox/Chips.scss) has no view class of its
         * own — the harness-type and target chips this card renders load it via the shared-partial
         * mechanism, the same way the dockdemo workspaces pull 'Neo.dashboard.Container'.
         * @member {String[]} additionalThemeFiles=['AgentOS.view.fleet.mailbox.Chips']
         */
        additionalThemeFiles: ['AgentOS.view.fleet.mailbox.Chips'],
        /**
         * The empty-state line rendered when no record is seated. Owners override it to stay honest
         * in their own context: the keeper-view's "select an agent" differs from the detail tab's
         * "this agent has no stored definition".
         * @member {String} emptyText='Select an agent to see its configuration.'
         */
        emptyText: 'Select an agent to see its configuration.',
        /**
         * The selected agent's record (an {@link AgentOS.model.AgentDefinition} row) — null renders
         * the empty state ("Select an agent").
         * @member {Object|null} record_=null
         * @reactive
         */
        record_: null,
        /**
         * Whether the operator explicitly opened the secondary connection controls. The normal card
         * shows the current destination as one line and keeps target choices out of the ordinary path.
         * @member {Boolean} connectionEditing_=false
         * @reactive
         */
        connectionEditing_: false,
        /**
         * The shared public definitions Store. The card reads it only to prevent offering a saved
         * tenant credential already assigned to another seat; the Brain still enforces uniqueness.
         * @member {Neo.data.Store|null} agentDefinitionsStore_=null
         * @reactive
         */
        agentDefinitionsStore_: null,
        /**
         * The provider-hosted public tenant roster. This card listens to the Store directly so both
         * Accounts and a docked/popped-out AgentDetail refresh from the same availability truth.
         * @member {Neo.data.Store|null} tenantStore_=null
         * @reactive
        */
        tenantStore_: null,
        /** @member {String|null} boundProfileId_=null @reactive */
        boundProfileId_: null,
        /** @member {Neo.data.Store|null} instanceStore_=null @reactive */
        instanceStore_: null,
        /** @member {Boolean} shellCustody_=false @reactive */
        shellCustody_: false,
        /** @member {String|null} shellPlaneBase_=null @reactive */
        shellPlaneBase_: null,
        /**
         * Ephemeral save feedback for the currently rendered record. This is deliberately component
         * state, never AgentDefinition data: pending/rejected are transport facts, not durable fleet
         * configuration.
         * @member {Object|null} saveStatus_=null
         * @reactive
         */
        saveStatus_: null
    }

    /**
     * @summary One delegated click listener resolves every interactive row (see {@link #onCardClick}).
     */
    construct(config) {
        super.construct(config);
        this.addDomListeners({click: this.onCardClick, scope: this})
    }

    /**
     * Triggered after the record config got changed
     * @param {Object|null} value
     * @param {Object|null} oldValue
     * @protected
     */
    afterSetRecord(value, oldValue) {
        value?.id !== oldValue?.id && (this.connectionEditing = false);
        this.saveStatus = {agentId: value?.id ?? null, state: 'idle', reason: ''};
        this.refresh()
    }

    /**
     * Triggered after the public tenant Store changes. Listener maps are recreated for symmetric
     * `on`/`un` because Neo event registration consumes its input object.
     * @param {Neo.data.Store|null} value
     * @param {Neo.data.Store|null} oldValue
     * @protected
     */
    afterSetTenantStore(value, oldValue) {
        oldValue?.un?.(this.getTenantStoreListeners());
        value?.on?.(this.getTenantStoreListeners());
        this.isConstructed && this.refresh()
    }

    /**
     * @summary Track public definition changes because a different seat can claim or release a
     * tenant while this card remains mounted.
     * @param {Neo.data.Store|null} value
     * @param {Neo.data.Store|null} oldValue
     * @protected
     */
    afterSetAgentDefinitionsStore(value, oldValue) {
        oldValue?.un?.(this.getAgentDefinitionsStoreListeners());
        value?.on?.(this.getAgentDefinitionsStoreListeners());
        this.isConstructed && this.refresh()
    }

    /** @summary Re-render when the optional connection editor opens or closes. @protected */
    afterSetConnectionEditing() { this.isConstructed && this.refresh() }
    /** @summary Re-render when the shell's bound profile changes. @protected */
    afterSetBoundProfileId() { this.isConstructed && this.refresh() }
    /** @summary Refresh the endpoint from the current instance roster. @protected */
    afterSetInstanceStore(value, oldValue) {
        oldValue?.un?.(this.getInstanceStoreListeners());
        value?.on?.(this.getInstanceStoreListeners());
        this.isConstructed && this.refresh()
    }
    /** @summary Re-render when shell ownership changes. @protected */
    afterSetShellCustody() { this.isConstructed && this.refresh() }
    /** @summary Re-render when the shell's bound plane endpoint changes. @protected */
    afterSetShellPlaneBase() { this.isConstructed && this.refresh() }

    /**
     * @returns {Object} The complete public-tenant Store listener set.
     * @protected
     */
    getTenantStoreListeners() {
        return {
            load        : this.onTenantStoreChange,
            mutate      : this.onTenantStoreChange,
            recordChange: this.onTenantStoreChange,
            scope       : this
        }
    }

    /** @summary Create listeners for other seats claiming or releasing a saved tenant. @returns {Object} @protected */
    getAgentDefinitionsStoreListeners() {
        return {
            load        : this.onAgentDefinitionsStoreChange,
            mutate      : this.onAgentDefinitionsStoreChange,
            recordChange: this.onAgentDefinitionsStoreChange,
            scope       : this
        }
    }

    /** @summary Create the listener set for the bound instance roster. @returns {Object} @protected */
    getInstanceStoreListeners() {
        return {
            load        : this.onInstanceStoreChange,
            mutate      : this.onInstanceStoreChange,
            recordChange: this.onInstanceStoreChange,
            scope       : this
        }
    }

    /**
     * @summary Re-render target choices when tenant membership or availability changes.
     * @protected
     */
    onTenantStoreChange() {
        this.refresh()
    }

    /** @summary Re-derive target availability after another definition changes. @protected */
    onAgentDefinitionsStoreChange() {
        this.refresh()
    }

    /** @summary Refresh the destination when the instance roster changes. @protected */
    onInstanceStoreChange() {
        this.refresh()
    }

    /**
     * @summary Re-derive the card's vdom from the CURRENT record data. Public on purpose: a
     * `recordChange` mutates record fields without changing record identity, so the reactive
     * `record` config never re-fires — the owning view calls `refresh()` on roster changes to keep
     * the card live (the same-record propagation contract).
     */
    refresh() {
        this.vdom.cn = this.createCardContent(this.record);
        this.update()
    }

    /**
     * @summary Resolve a click on an interactive row into a `configIntent` event — the card never
     * mutates anything itself (the owning view drives the bridge round-trip and writes the record
     * from the RESPONSE). Rows encode their intent in DOM ids: `<cardId>__srv__<key>` toggles one
     * MCP server; `<cardId>__product__<product>` picks a product and `<cardId>__harness__<type>` a
     * run mode (see {@link #createHarnessChoices}); `<cardId>__launch__<owner>` hands the seat's
     * launches to this fleet; `<cardId>__connection__edit` opens the secondary saved-target editor;
     * `<cardId>__target__<id>` selects an available saved connection (see {@link #createTargetChoices}).
     * @param {Object} data DOM click event data.
     * @protected
     */
    onCardClick(data) {
        const
            me     = this,
            record = me.record,
            node   = data.path?.find(item => item.id?.startsWith(`${me.id}__`));

        if (!node || !record || (me.saveStatus?.agentId === record.id && me.saveStatus.state === 'pending')) {
            return
        }

        const [, kind, key] = node.id.replace(`${me.id}__`, '__').split('__');

        if (kind === 'srv') {
            const
                catalog = mcpCatalogFor(record.forge),
                matrix  = resolveMcpMatrix(record.mcpServers, catalog);
            matrix[key] = !matrix[key];

            me.fire('configIntent', {id: record.id, mcpServers: normalizeMcpOverrides(matrix, catalog)})
        } else if (kind === 'harness' && key !== record.harnessType) {
            me.fire('configIntent', {id: record.id, harnessType: key})
        } else if (kind === 'product') {
            // a product keeps the current run mode where it has one (Claude App → Codex lands on Codex's app)
            const harnessType = HarnessChoice.typeFor(key, HarnessChoice.choiceOf(record.harnessType)?.runsAs);

            harnessType && harnessType !== record.harnessType && me.fire('configIntent', {id: record.id, harnessType})
        } else if (kind === 'launch' && key === 'fleet' && record.launchOwner === 'external') {
            me.fire('configIntent', {id: record.id, launchOwner: key})
        } else if (kind === 'connection' && key === 'edit') {
            me.connectionEditing = !me.connectionEditing
        } else if (kind === 'target') {
            if (key === 'local') {
                if (!me.getBoundAgentOsEndpoint() && !me.shellCustody) {
                    return
                }

                record.mcpTarget?.kind === 'tenant' &&
                    me.fire('configIntent', {id: record.id, mcpTarget: null});
                return
            }

            let tenantId;

            try {
                tenantId = decodeURIComponent(key)
            } catch {
                return
            }

            const tenant = me.tenantStore?.get(tenantId);

            if (me.getTenantChoiceAvailability(record, tenant).available &&
                record.mcpTarget?.tenantId !== tenantId) {
                me.fire('configIntent', {
                    id       : record.id,
                    mcpTarget: {kind: 'tenant', tenantId}
                })
            }
        }
    }

    /**
     * @summary Resolve the currently bound Agent OS endpoint from the shell's declared authorities.
     * @returns {String|null}
     */
    getBoundAgentOsEndpoint() {
        if (this.shellCustody) {
            return this.shellPlaneBase || null
        }

        return (this.boundProfileId && this.instanceStore?.get(this.boundProfileId)?.canonicalEndpoint) || null
    }

    /**
     * @summary Find a different seat that already owns this saved tenant target.
     * @param {String} tenantId
     * @param {String} currentAgentId
     * @returns {Object|null}
     */
    findTenantAssignee(tenantId, currentAgentId) {
        return this.agentDefinitionsStore?.items?.find(agent =>
            agent.id !== currentAgentId &&
            agent.mcpTarget?.kind === 'tenant' &&
            agent.mcpTarget.tenantId === tenantId
        ) || null
    }

    /**
     * @summary Fail closed until the public definitions Store confirms an otherwise usable target
     * is not assigned to another seat. The Brain remains the final uniqueness authority.
     * @param {Object} record
     * @param {Object|null} tenant
     * @returns {{available: Boolean, reason: String, assignee: Object|null}}
     */
    getTenantChoiceAvailability(record, tenant) {
        const
            me        = this,
            assignee  = tenant ? me.findTenantAssignee(tenant.id, record.id) : null,
            connected = tenant?.status === 'connected' && typeof tenant.endpoint === 'string' && !!tenant.endpoint;

        if (!supportsTenantMcpTarget(record.harnessType)) {
            return {available: false, assignee, reason: 'Unavailable for this harness'}
        }

        if (!connected) {
            return {available: false, assignee, reason: 'Unavailable'}
        }

        if (!Array.isArray(me.agentDefinitionsStore?.data)) {
            return {available: false, assignee, reason: 'Assignment not read back'}
        }

        if (assignee) {
            const owner = assignee.displayName || assignee.githubUsername || assignee.id;

            return {available: false, assignee, reason: `In use by ${owner}`}
        }

        return {available: true, assignee: null, reason: ''}
    }

    /**
     * @summary One honest destination sentence: the bound Agent OS for resident services, or the
     * explicit saved connection when this definition already targets one.
     * @param {Object} record
     * @returns {String}
     */
    getDestinationText(record) {
        if (record.mcpTarget?.kind === 'tenant') {
            const
                tenant     = this.tenantStore?.get(record.mcpTarget.tenantId),
                endpoint   = tenant?.endpoint,
                availability = this.getTenantChoiceAvailability(record, tenant);

            if (!endpoint) {
                return `Saved connection unavailable · ${record.mcpTarget.tenantId}`
            }

            return `Saved connection · ${endpoint}${availability.available ? '' : ` · ${availability.reason}`}`
        }

        const endpoint = this.getBoundAgentOsEndpoint();

        if (endpoint) {
            return `Agent OS · ${endpoint}`
        }

        return this.shellCustody
            ? 'Agent OS · this machine'
            : 'Agent OS destination not reported'
    }

    /**
     * @summary Render one save-state transition only when the card still shows the originating
     * agent. A slow response after selection changed must never paint the next agent's card.
     * `pending` is the ONLY latching state (see {@link #onCardClick}); `superseded` — another
     * surface's newer change outran this card's request — is informational and non-latching, so
     * the losing surface stays correctable.
     * @param {String} agentId
     * @param {'idle'|'pending'|'accepted'|'rejected'|'superseded'} state
     * @param {String} [reason=''] Operator-facing status or rejection reason.
     * @returns {Boolean} True when the visible card accepted the state.
     */
    setSaveStatus(agentId, state, reason='') {
        if (this.record?.id !== agentId) {
            return false
        }

        this.saveStatus = {agentId, state, reason};
        this.refresh();

        return true
    }

    /**
     * @summary Build the card's vdom from the current record, shared Stores, and bound destination.
     * The declaration never drifts from its public registries; status and destination stay explicit.
     * Server rows and harness chips are interactive (see {@link #onCardClick}); operational rows
     * are read-only observations.
     * @param {Object|null} record
     * @returns {Object[]} vdom child nodes
     */
    createCardContent(record) {
        if (!record) {
            return [{cls: ['fm-config-empty'], text: this.emptyText}]
        }

        const
            me            = this,
            catalog       = mcpCatalogFor(record.forge),
            matrix        = resolveMcpMatrix(record.mcpServers, catalog),
            targetChoices = me.connectionEditing ? me.createTargetChoices(record) : [],
            saveStatus    = me.saveStatus?.agentId === record.id
                ? me.saveStatus
                : {state: 'idle', reason: ''};

        return [{
            cls: ['fm-config-identity'],
            cn : [
                {tag: 'strong', cls: ['fm-config-name'], text: record.displayName || record.githubUsername},
                {cls: ['fm-config-status'], text: record.statusText || ''}
            ]
        }, {
            cls: ['fm-config-row'],
            cn : [
                {cls: ['fm-config-label'], text: 'Harness'},
                {cls: ['fm-config-value'], text: HarnessChoice.describe(record.harnessType) ?? 'Unknown harness'}
            ]
        }, ...me.createHarnessChoices(record), {
            cls: ['fm-config-section'],
            cn : [
                {tag: 'strong', cls: ['fm-config-heading'], text: 'Launched by · declared'},
                {cls: ['fm-config-chips', 'fm-config-launch'], cn: me.createLaunchOwnerChoices(record)}
            ]
        }, {
            cls: ['fm-config-section'],
            cn : [
                {tag: 'strong', cls: ['fm-config-heading'], text: 'Memory & knowledge'},
                {cls: ['fm-config-destination'], text: me.getDestinationText(record)},
                {
                    id             : `${me.id}__connection__edit`,
                    tag            : 'button',
                    type           : 'button',
                    cls            : ['fm-chip', 'fm-config-connection-edit'],
                    text           : me.connectionEditing ? 'Close connection options' : 'Edit connection',
                    'aria-expanded': String(me.connectionEditing),
                    ...me.getButtonAccessibilityAttrs(false)
                },
                ...(me.connectionEditing ? [{
                    id         : `${me.id}__target-list`,
                    role       : 'group',
                    'aria-label': 'Memory and knowledge connection options',
                    cls        : ['fm-config-chips', 'fm-config-targets'],
                    cn         : targetChoices
                }] : [])
            ]
        }, {
            cls: ['fm-config-section'],
            cn : [
                {tag: 'strong', cls: ['fm-config-heading'], text: 'Servers · declared'},
                ...catalog.map(server => ({
                    id   : `${me.id}__srv__${server.key}`,
                    tag  : 'button',
                    type : 'button',
                    cls  : ['fm-config-row', 'fm-config-toggle', 'is-declared', matrix[server.key] ? 'is-enabled' : 'is-disabled'],
                    ...me.getButtonAccessibilityAttrs(matrix[server.key]),
                    cn : [
                        {tag: 'span', cls: ['fm-config-label'], text: server.label},
                        // `Declared` is load-bearing, not decoration: the fleet cannot observe an
                        // external harness's live server set, so this row only ever knows what the
                        // registry says. A bare `Off` here claimed an observation nobody made.
                        {tag: 'span', cls: ['fm-config-value'], text: matrix[server.key] ? 'Declared on' : 'Declared off'}
                    ]
                }))
            ]
        }, {
            cls: ['fm-config-section'],
            cn : [
                {tag: 'strong', cls: ['fm-config-heading'], text: 'Operations · read back'},
                this.createToggleRow('Hooks',              record.hooksActive),
                this.createToggleRow('Wake subscriptions', record.wakeSubscriptionsActive)
            ]
        }, {
            cls : ['fm-config-save-status', `is-${saveStatus.state}`],
            text: saveStatus.reason
        }]
    }

    /**
     * @summary Keep native buttons focusable during bridge updates while exposing pending and
     * unavailable states to assistive technology.
     * @param {Boolean} pressed
     * @param {Boolean} unavailable
     * @returns {Object}
     */
    getButtonAccessibilityAttrs(pressed=false, unavailable=false) {
        const pending = this.saveStatus?.agentId === this.record?.id && this.saveStatus.state === 'pending';

        return {
            'aria-disabled': String(pending || unavailable),
            'aria-pressed' : String(pressed)
        }
    }

    /**
     * @summary The launch-owner choices: the recorded owner selected, and adoption offered to a seat in its
     * own harness. An owner the Brain did not report renders no choice, so nothing can be flipped from a guess.
     * @param {Object} record
     * @returns {Object[]}
     */
    createLaunchOwnerChoices(record) {
        const {launchOwner} = record;

        if (!Object.hasOwn(LAUNCH_OWNERS, launchOwner)) {
            return [{cls: ['fm-chip', 'is-unavailable'], text: 'Not reported'}]
        }

        return Object.entries(LAUNCH_OWNERS)
            .filter(([owner]) => owner === launchOwner || owner === 'fleet')
            .map(([owner, {text, title}]) => ({
                id   : `${this.id}__launch__${owner}`,
                tag  : 'button',
                type : 'button',
                cls  : ['fm-chip', owner === launchOwner ? 'is-selected' : 'is-selectable'],
                text,
                title,
                ...this.getButtonAccessibilityAttrs(owner === launchOwner)
            }))
    }

    /**
     * @summary The harness choice rows: one chip per product (`<cardId>__product__<product>`), then
     * App / Command line when the record's product ships both (`<cardId>__harness__<type>`). The two
     * id kinds stay distinct: a product chip and its run-mode chip would otherwise name the same type.
     * @param {Object} record
     * @returns {Object[]} vdom nodes, one or two rows
     */
    createHarnessChoices(record) {
        const
            me       = this,
            choice   = HarnessChoice.choiceOf(record.harnessType),
            products = HarnessChoice.products(),
            current  = products.find(item => item.product === choice?.product),
            rows     = [{
                cls: ['fm-config-chips', 'fm-config-harness'],
                cn : products.map(entry => ({
                    id   : `${me.id}__product__${entry.product}`,
                    tag  : 'button',
                    type : 'button',
                    cls  : ['fm-chip', entry.product === choice?.product ? 'is-selected' : 'is-selectable'],
                    text : entry.label,
                    ...me.getButtonAccessibilityAttrs(entry.product === choice?.product)
                }))
            }];

        if (current?.runsAs.length) {
            rows.push({
                cls: ['fm-config-chips', 'fm-config-runs-as'],
                cn : current.runsAs.map(entry => ({
                    id   : `${me.id}__harness__${entry.type}`,
                    tag  : 'button',
                    type : 'button',
                    cls  : ['fm-chip', entry.type === record.harnessType ? 'is-selected' : 'is-selectable'],
                    text : entry.label,
                    ...me.getButtonAccessibilityAttrs(entry.type === record.harnessType)
                }))
            })
        }

        return rows
    }

    /**
     * @summary Build secondary connection choices for this Fleet versus saved connections. A saved
     * tenant already assigned to another seat stays visible with its owner and cannot emit an intent.
     * @param {Object} record
     * @returns {Object[]}
     */
    createTargetChoices(record) {
        const
            me               = this,
            selectedTenantId = record.mcpTarget?.kind === 'tenant'
                ? record.mcpTarget.tenantId
                : null,
            records          = me.tenantStore?.items || [],
            choices          = [{
                id   : `${me.id}__target__local`,
                tag  : 'button',
                type : 'button',
                cls  : ['fm-chip', 'fm-target-choice', selectedTenantId ? 'is-selectable' : 'is-selected'],
                text : `This fleet · ${me.getBoundAgentOsEndpoint() || (me.shellCustody ? 'this machine' : 'destination not reported')}`,
                ...me.getButtonAccessibilityAttrs(!selectedTenantId, !me.getBoundAgentOsEndpoint() && !me.shellCustody)
            }];

        for (const tenant of records) {
            const
                selected           = tenant.id === selectedTenantId,
                {available, reason} = me.getTenantChoiceAvailability(record, tenant),
                state              = selected
                    ? ['is-selected', ...(available ? [] : ['is-unavailable'])]
                    : [available ? 'is-selectable' : 'is-unavailable'],
                suffix             = available ? '' : ` · ${reason}`;

            choices.push({
                id    : `${me.id}__target__${encodeURIComponent(tenant.id)}`,
                tag   : 'button',
                type  : 'button',
                cls   : ['fm-chip', 'fm-target-choice', ...state],
                text  : `Saved connection · ${tenant.endpoint}${suffix}`,
                title : available ? tenant.endpoint : reason,
                ...me.getButtonAccessibilityAttrs(selected, !available)
            })
        }

        if (selectedTenantId && !records.some(tenant => tenant.id === selectedTenantId)) {
            choices.push({
                id              : `${me.id}__target__${encodeURIComponent(selectedTenantId)}`,
                tag             : 'button',
                type            : 'button',
                cls             : ['fm-chip', 'fm-target-choice', 'is-selected', 'is-unavailable'],
                text            : `Saved connection unavailable · ${selectedTenantId}`,
                'aria-disabled' : 'true',
                'aria-pressed'  : 'true'
            })
        }

        return choices
    }

    /**
     * @summary One operational-toggle row with tri-state honesty: a boolean renders On/Off; null
     * renders "Not read back yet" — the surface never invents a state it has not observed.
     * @param {String} label Product-language row label.
     * @param {Boolean|null} state
     * @returns {Object} vdom node
     */
    createToggleRow(label, state) {
        const known = state === true || state === false;

        return {
            cls: ['fm-config-row', known ? (state ? 'is-enabled' : 'is-disabled') : 'is-unknown'],
            cn : [
                {cls: ['fm-config-label'], text: label},
                {cls: ['fm-config-value'], text: known ? (state ? 'On' : 'Off') : 'Not read back yet'}
            ]
        }
    }

    /**
     * @summary Detach both provider Store listeners before the component retires.
     * @param {...*} args
     */
    destroy(...args) {
        this.tenantStore?.un?.(this.getTenantStoreListeners());
        this.agentDefinitionsStore?.un?.(this.getAgentDefinitionsStoreListeners());
        this.instanceStore?.un?.(this.getInstanceStoreListeners());
        super.destroy(...args)
    }
}

export default Neo.setupClass(AgentConfigCard);
