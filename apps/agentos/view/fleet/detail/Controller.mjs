import ComponentController   from '../../../../../node_modules/neo.mjs/src/controller/Component.mjs';
import AddAgentFlow          from '../../../util/AddAgentFlow.mjs';
import ConfigIntentRoundTrip from '../../../util/ConfigIntentRoundTrip.mjs';
import SeatGitIdentity       from '../../../util/SeatGitIdentity.mjs';
import SeatModel             from '../../../util/SeatModel.mjs';

/**
 * @class AgentOS.view.fleet.detail.Controller
 * @extends Neo.controller.Component
 * @summary Owns the inspector's configuration and freshness lifecycle. The component renders
 * shared records; ConfigIntentRoundTrip retains cross-surface canonical write arbitration. The
 * commit-identity row is read once per shown seat, and its declaration rides the same runner.
 */
class Controller extends ComponentController {
    static config = {
        /**
         * @member {String} className='AgentOS.view.fleet.detail.Controller'
         * @protected
         */
        className: 'AgentOS.view.fleet.detail.Controller'
    }

    /**
     * The seat whose commit identity the row shows.
     * @member {String|null} identityAgentId=null
     * @protected
     */
    identityAgentId = null
    /**
     * The latest identity request, a read or a declaration. Only its answer may paint the row, so an
     * older reply, of the same seat or of a seat shown again since (A → B → A), paints nothing.
     * @member {Number} identityRequest=0
     * @protected
     */
    identityRequest = 0
    /**
     * The latest Memory-row request, a candidate read or a consent: only its answer may paint the row.
     * @member {Number} memoryRequest=0
     * @protected
     */
    memoryRequest = 0
    /**
     * The latest Seat-group request, a catalog read or a declaration: only its answer may paint the group.
     * @member {Number} seatRequest=0
     * @protected
     */
    seatRequest = 0

    /**
     * @summary Wire the completed inspector's config card, identity row and shared Store, then
     * start its existing freshness cadence. The component may have received its Store during
     * construction.
     */
    onComponentConstructed() {
        const
            me   = this,
            card = me.getReference('config-pane');

        card.on({configIntent: me.onConfigIntent, scope: me});
        me.getReference('identity-row').on({declareGitIdentity: me.onDeclareGitIdentity, readGitIdentity: me.readGitIdentity, scope: me});
        me.getReference('seat-model').on({declareSeatModel: me.onDeclareSeatModel, readSeatCatalog: me.readSeatCatalog, scope: me});
        me.getReference('seat-memory').on({declareSeatMemory: me.onDeclareSeatMemory, readSeatMemory: me.readSeatMemory, scope: me});
        // a roster refresh re-seats the same definition: only another seat is read again
        me.observeConfig(card, 'record', (value, oldValue) => {
            value?.id !== oldValue?.id && me.readGitIdentity()
        });
        me.onDefinitionsStoreChange(me.component.agentDefinitions, null);
        // a seat the card showed before this subscription existed is read once here
        (card.record?.id ?? null) !== me.identityAgentId && me.readGitIdentity();
        me.startFreshnessAging()
    }

    /**
     * @summary Detach intent and Store subscriptions before the inspector's children leave.
     * The inherited lifecycle cancels this controller's pending freshness timeout.
     * @param {...*} args
     */
    destroy(...args) {
        const me = this;

        me.component.agentDefinitions?.un(me.getDefinitionsStoreListeners());
        me.getReference('config-pane')?.un({configIntent: me.onConfigIntent, scope: me});
        me.getReference('identity-row')?.un({declareGitIdentity: me.onDeclareGitIdentity, readGitIdentity: me.readGitIdentity, scope: me});
        me.getReference('seat-model')?.un({declareSeatModel: me.onDeclareSeatModel, readSeatCatalog: me.readSeatCatalog, scope: me});
        me.getReference('seat-memory')?.un({declareSeatMemory: me.onDeclareSeatMemory, readSeatMemory: me.readSeatMemory, scope: me});
        // a reply still on its way finds no request of its own
        me.identityRequest++;
        me.memoryRequest++;
        me.seatRequest++;
        super.destroy(...args)
    }

    /**
     * @summary Read the shown seat's commit identity into the row, which says "not yet read" and
     * "Reading…" until the answer lands. No definition shown, no row.
     * @returns {Promise<void>}
     */
    async readGitIdentity() {
        const
            me      = this,
            row     = me.getReference('identity-row'),
            agentId = me.getReference('config-pane').record?.id ?? null,
            request = ++me.identityRequest;

        me.identityAgentId = agentId;
        row.set({hidden: !agentId, identity: null});

        if (agentId) {
            row.status = {state: 'pending', reason: 'Reading…'};

            const identity = await SeatGitIdentity.read(globalThis.AgentOS?.fleet?.registryBridge ?? null, agentId);

            if (request === me.identityRequest && !me.isDestroyed && !row.isDestroyed) {
                row.identity = identity
            }
        }
    }

    /**
     * @summary Declare the shown seat's commit identity through the shared runner, with the row as
     * its own owner token, like the Repositories card: a configuration change and a declaration on
     * the same seat never silence each other. An accepted declaration is read back, so the row shows
     * the Fleet's answer rather than the typed pair.
     * @param {Object} data
     * @param {String} data.gitEmail
     * @param {String} data.gitName
     * @returns {Promise<void>}
     */
    onDeclareGitIdentity(data={}) {
        const
            me      = this,
            row     = me.getReference('identity-row'),
            agentId = me.identityAgentId,
            pair    = SeatGitIdentity.pairOf(data);

        if (!agentId) {
            return Promise.resolve()
        }

        if (!pair) {
            row.status = {state: 'rejected', reason: SeatGitIdentity.PAIR_REQUIRED};
            return Promise.resolve()
        }

        // the declaration is the latest request now: a read still on its way paints nothing
        const request = ++me.identityRequest;

        return ConfigIntentRoundTrip.runConfigIntentRoundTrip({
            intent: {id: agentId, ...pair},
            owner : row,
            store : me.component.agentDefinitions,
            setSaveStatus: (id, state, reason) => {
                if (request !== me.identityRequest || me.isDestroyed || row.isDestroyed) {
                    return
                }

                // pending paints its own word; rejected and superseded keep the runner's reason
                state === 'accepted' ? me.readGitIdentity() : row.status = {state, reason: state === 'pending' ? '' : reason}
            }
        })
    }

    /**
     * @summary Fresh listener descriptors for the shared definitions Store. Observable consumes
     * descriptor keys, so attach and detach each receive their own map.
     * @returns {Object}
     * @private
     */
    getDefinitionsStoreListeners() {
        return {
            load        : this.onDefinitionsStoreMutation,
            mutate      : this.onDefinitionsStoreMutation,
            recordChange: this.onDefinitionRecordChange,
            scope       : this
        }
    }

    /**
     * @summary Move subscriptions between provider-owned Stores and re-seat the rendered join.
     * Neither this controller nor the inspector owns the Store's destruction.
     * @param {Neo.data.Store|null} value
     * @param {Neo.data.Store|null} oldValue
     */
    onDefinitionsStoreChange(value, oldValue) {
        const me = this;

        oldValue?.un(me.getDefinitionsStoreListeners());
        value?.on(me.getDefinitionsStoreListeners());

        // another Store is another binding: the Seat group's catalog and feedback belonged to the last one, even
        // where the new Store holds the same seat on the same harness
        if (oldValue && value !== oldValue) {
            me.memoryRequest++;
            me.seatRequest++;
            me.getReference('seat-model')?.set({catalog: null, editing: null, status: {state: 'idle', reason: ''}});
            me.getReference('seat-memory')?.set({closed: false, discovery: null, editing: false, status: {state: 'idle', reason: ''}})
        }

        me.component.applyConfigRecord()
    }

    /**
     * @summary A reload or membership change may add, replace or remove the displayed definition.
     * The view resolves the same registry-key join against the current shared Store.
     */
    onDefinitionsStoreMutation() {
        this.component.applyConfigRecord()
    }

    /**
     * @summary Refresh a same-identity record after a field readback; reactive record assignment
     * alone cannot observe an in-place change.
     * @param {Object} data The Store's recordChange event.
     */
    onDefinitionRecordChange(data) {
        const card = this.getReference('config-pane');

        if (card.record && data.record?.id === card.record.id) {
            card.refresh();
            this.component.applySeatModel()
        }
    }

    /**
     * @summary What the Seat group is bound to now: the shown definition's id and harness, and the Store it came from.
     * A catalog read or a declaration answers the group only while its binding still holds.
     * @returns {{id: String, harnessType: String|null, store: Object}|null}
     * @protected
     */
    seatBinding() {
        const seat = this.getReference('seat-model')?.seat;

        return seat?.id ? {id: seat.id, harnessType: seat.harnessType ?? null, store: this.component.agentDefinitions} : null
    }

    /**
     * @param {Object|null} binding A {@link seatBinding} taken when a read or a declaration started
     * @returns {Boolean} Whether the group still shows that seat, on that harness, from that Store
     * @protected
     */
    holdsSeatBinding(binding) {
        const current = this.seatBinding();

        return !!binding && !!current && binding.id === current.id && binding.harnessType === current.harnessType && binding.store === current.store
    }

    /**
     * @summary Read what the shown seat's harness offers into the Seat group, for its Change.
     * @returns {Promise<void>}
     */
    async readSeatCatalog() {
        const
            me      = this,
            row     = me.getReference('seat-model'),
            binding = me.seatBinding(),
            request = ++me.seatRequest;

        if (!binding) return;

        const catalog = await SeatModel.readCatalog(globalThis.AgentOS?.fleet?.registryBridge ?? null, binding.id);

        if (request === me.seatRequest && !me.isDestroyed && !row.isDestroyed && me.holdsSeatBinding(binding)) {
            row.catalog = catalog
        }
    }

    /**
     * @summary Declare the shown seat's model or effort through the shared runner, with the group as its own owner
     * token, so a configuration change and a declaration on the same seat never silence each other. The accepted
     * readback lands on the definition, and the group re-seats from it.
     * @param {Object}      data
     * @param {String}      data.field `model` or `reasoningEffort`
     * @param {String|null} data.value `null` hands the field back to the harness
     * @returns {Promise<void>}
     */
    onDeclareSeatModel({field, value} = {}) {
        const
            me      = this,
            row     = me.getReference('seat-model'),
            binding = me.seatBinding();

        if (!binding || (field !== 'model' && field !== 'reasoningEffort')) {
            return Promise.resolve()
        }

        const request = ++me.seatRequest;

        // the write lands on its Store whatever is shown by then; only its feedback is bound to the group
        return ConfigIntentRoundTrip.runConfigIntentRoundTrip({
            intent: {id: binding.id, [field]: value},
            owner : row,
            store : binding.store,
            setSaveStatus: (id, state, reason) => {
                if (request !== me.seatRequest || me.isDestroyed || row.isDestroyed || !me.holdsSeatBinding(binding)) {
                    return
                }

                state === 'accepted'
                    ? row.set({editing: null, status: {state: 'idle', reason: ''}})
                    : row.status = {state, reason: state === 'pending' ? '' : reason}
            }
        })
    }

    /**
     * @summary Ask the Fleet which agents' memory the shown seat could continue, into the Memory row, for its choice.
     * @returns {Promise<void>}
     */
    async readSeatMemory() {
        const
            me      = this,
            row     = me.getReference('seat-memory'),
            binding = me.seatBinding(),
            request = ++me.memoryRequest;

        if (!binding) return;

        row.discovery = {state: 'reading'};

        const discovery = await AddAgentFlow.readMemoryCandidates();

        if (request === me.memoryRequest && !me.isDestroyed && !row.isDestroyed && me.holdsSeatBinding(binding)) {
            row.discovery = discovery
        }
    }

    /**
     * @summary Record the shown seat's memory consent through the shared runner, with the row as its own owner token.
     * The accepted readback lands on the definition, and the row re-seats from it. Every refusal stays on the row in the
     * Fleet's words. Only the Fleet's code for a closed choice ({@link AgentOS.util.AddAgentFlow#MEMORY_IMPORT_CLOSED},
     * a seat that runs or already holds its memory) withdraws the offer. Any other refusal, and an unreachable or
     * invalid answer, leaves the choice open to correct and try again. Nothing reaches the definition but readback.
     * @param {Object} data
     * @param {String} data.memoryImport A candidate's `source`, or `'none'`
     * @returns {Promise<void>}
     */
    onDeclareSeatMemory({memoryImport} = {}) {
        const
            me      = this,
            row     = me.getReference('seat-memory'),
            binding = me.seatBinding();

        if (!binding || !memoryImport) {
            return Promise.resolve()
        }

        const request = ++me.memoryRequest;

        return ConfigIntentRoundTrip.runConfigIntentRoundTrip({
            intent: {id: binding.id, memoryImport},
            owner : row,
            store : binding.store,
            setSaveStatus: (id, state, reason, detail) => {
                if (request !== me.memoryRequest || me.isDestroyed || row.isDestroyed || !me.holdsSeatBinding(binding)) {
                    return
                }

                if (state === 'accepted') {
                    row.set({discovery: null, editing: false, status: {state: 'idle', reason: ''}})
                } else if (detail?.code === AddAgentFlow.MEMORY_IMPORT_CLOSED) {
                    row.set({closed: true, discovery: null, editing: false, status: {state, reason}})
                } else {
                    row.status = {state, reason: state === 'pending' ? '' : reason}
                }
            }
        })
    }

    /**
     * @summary Submit the config card's intent to the shared round-trip owner. A late response
     * can still update its surviving provider Store, but cannot paint a dead or rebound inspector.
     * The card itself keeps statuses scoped to its currently displayed agent.
     * @param {Object} intent `{id, harnessType?, mcpServers?, mcpTarget?}` plus the event envelope.
     * @returns {Promise<void>}
     */
    onConfigIntent(intent={}) {
        const
            me          = this,
            {component} = me,
            store       = component.agentDefinitions;

        return ConfigIntentRoundTrip.runConfigIntentRoundTrip({
            intent,
            owner: me,
            store,
            setSaveStatus: (agentId, state, reason) => {
                if (!me.isDestroyed && !component.isDestroying && !component.isDestroyed &&
                    store === component.agentDefinitions) {
                    me.getReference('config-pane').setSaveStatus(agentId, state, reason)
                }
            }
        })
    }

    /**
     * @summary Re-age the inspector without requiring a new roster row. Preserve its cadence and
     * injected-clock behavior: an empty inspector skips rendering and keeps the loop alive.
     * @returns {Promise<void>} This wait's completion, including normal destruction cancellation.
     */
    startFreshnessAging() {
        const
            me          = this,
            {component} = me;

        return me.timeout(component.freshnessRefreshMs).then(() => {
            if (!me.isDestroyed && !component.isDestroying && !component.isDestroyed) {
                component.record && component.applyPaneFreshness();
                me.startFreshnessAging()
            }
        }).catch(error => {
            if (error !== Neo.isDestroyed) throw error
        })
    }
}

export default Neo.setupClass(Controller);
