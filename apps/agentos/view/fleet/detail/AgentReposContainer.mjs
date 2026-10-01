import Button           from '../../../../../node_modules/neo.mjs/src/button/Base.mjs';
import Container        from '../../../../../node_modules/neo.mjs/src/container/Base.mjs';
import TextField        from '../../../../../node_modules/neo.mjs/src/form/field/Text.mjs';
import RepositoryList   from './RepositoryList.mjs';
import SeatRepositories from '../../../store/SeatRepositories.mjs';

/**
 * @class AgentOS.view.fleet.detail.AgentReposContainer
 * @extends Neo.container.Base
 *
 * @summary The per-agent Repositories card: the repositories a seat gets clones of, read from its
 * {@link AgentOS.model.AgentDefinition} record. The working repository comes first and stays, since
 * it is set when the agent is added; the others can be added and removed.
 *
 * Like the configuration card, it changes nothing itself. Each add or remove fires one
 * `configIntent` carrying the seat's whole new list (`{id, repos}`), the owning view runs the
 * `setRepos` round-trip, and the registry's readback re-renders the card. The Brain validates the
 * list, so a refusal's reason is the Brain's own and shows on the status line, while the rows keep
 * what the registry holds.
 *
 * Each of the other repositories also shows the last start's outcome, prepared or failed with the
 * Fleet's redacted reason. That outcome is runtime truth, so it comes from the seat's roster record
 * ({@link #rosterStore}), never from the definition.
 */
class AgentReposCard extends Container {
    static config = {
        /**
         * @member {String} className='AgentOS.view.fleet.detail.AgentReposContainer'
         * @protected
         */
        className: 'AgentOS.view.fleet.detail.AgentReposContainer',
        /**
         * @member {String} ntype='fm-agent-repos-card'
         * @protected
         */
        ntype: 'fm-agent-repos-card',
        /**
         * @member {String[]} baseCls=['fm-agent-repos-card']
         */
        baseCls: ['fm-agent-repos-card'],
        /**
         * @member {Object} layout={ntype:'vbox',align:'stretch'}
         * @reactive
         */
        layout: {ntype: 'vbox', align: 'stretch'},
        /**
         * The selected agent's record (an {@link AgentOS.model.AgentDefinition} row).
         * @member {Object|null} record_=null
         * @reactive
         */
        record_: null,
        /**
         * The provider-hosted fleet roster (`stores.fleetRoster`), read for one fact: the last
         * start's per-repository outcome on the seat's {@link AgentOS.model.FleetAgent} record. The
         * card listens to the Store directly, as the configuration card does to the tenant roster,
         * and never writes it.
         * @member {Neo.data.Store|null} rosterStore_=null
         * @reactive
         */
        rosterStore_: null,
        /**
         * Ephemeral save feedback for the shown record: `{agentId, state, reason}`. Component state,
         * never definition data.
         * @member {Object|null} saveStatus_=null
         * @reactive
         */
        saveStatus_: null,
        /**
         * Heading · rows · the empty line · the add row · status line. Every row keeps its natural
         * height (`flex: 'none'`). Skin in `AgentReposContainer.scss`.
         * @member {Object[]} items
         */
        items: [{
            ntype    : 'component',
            cls      : ['fm-repos-heading'],
            flex     : 'none',
            reference: 'repos-heading',
            text     : 'Repositories · declared'
        }, {
            module   : RepositoryList,
            flex     : 'none',
            reference: 'repo-list',
            store    : {module: SeatRepositories}
        }, {
            ntype    : 'component',
            cls      : ['fm-repos-empty'],
            flex     : 'none',
            reference: 'repos-empty',
            text     : 'No working repository is set, so this seat clones nothing yet.'
        }, {
            ntype : 'container',
            cls   : ['fm-repos-add'],
            flex  : 'none',
            layout: {ntype: 'hbox', align: 'end'},

            items: [{
                module         : TextField,
                flex           : 1,
                labelPosition  : 'inline',
                labelText      : 'Add a repository',
                name           : 'repoSlug',
                placeholderText: 'owner/repo',
                reference      : 'field-repo'
            }, {
                module   : Button,
                cls      : ['fm-repos-add-button'],
                flex     : 'none',
                handler  : 'up.onAddClick',
                reference: 'add-button',
                text     : 'Add'
            }]
        }, {
            ntype    : 'component',
            cls      : ['fm-repos-status', 'is-idle'],
            flex     : 'none',
            reference: 'repos-status'
        }]
    }

    /**
     * @summary Listen for the rows' Remove clicks and render the first state.
     * @param {...*} args
     */
    onConstructed(...args) {
        super.onConstructed(...args);

        this.getReference('repo-list').on({removeRepository: this.onRemoveRepository, scope: this});
        this.refresh()
    }

    /**
     * Triggered after the record config got changed: a new agent starts idle, with an empty add
     * field.
     * @param {Object|null} value
     * @param {Object|null} oldValue
     * @protected
     */
    afterSetRecord(value, oldValue) {
        const me = this;

        me.saveStatus = {agentId: value?.id ?? null, state: 'idle', reason: ''};

        if (me.isConstructed) {
            me.getReference('field-repo').value = '';
            me.refresh()
        }
    }

    /**
     * Triggered after the saveStatus config got changed: render the status line, and hold the add
     * row while a change is in flight.
     * @param {Object|null} value
     * @param {Object|null} oldValue
     * @protected
     */
    afterSetSaveStatus(value, oldValue) {
        this.isConstructed && this.renderSaveStatus()
    }

    /**
     * Triggered after the rosterStore config got changed. Listener maps are recreated for symmetric
     * `on`/`un`, because Neo event registration consumes its input object.
     * @param {Neo.data.Store|null} value
     * @param {Neo.data.Store|null} oldValue
     * @protected
     */
    afterSetRosterStore(value, oldValue) {
        oldValue?.un?.(this.getRosterStoreListeners());
        value?.on?.(this.getRosterStoreListeners());
        this.isConstructed && this.refresh()
    }

    /**
     * @summary The seat's other repositories as the registry holds them: `{repoSlug, cloneUrl}`
     * each, the exact entries a new list must carry forward.
     * @returns {Object[]}
     */
    getOtherRepos() {
        return (this.record?.['metadata.repos'] ?? []).map(({cloneUrl, repoSlug}) => ({cloneUrl, repoSlug}))
    }

    /**
     * @summary The last start's outcome per repository slug, from the seat's roster record. A
     * repository added since that start has no entry, so it shows none until the next start.
     * @returns {Map<String, {reason: String|null, state: String}>}
     */
    getRepoOutcomes() {
        const outcomes = this.record && this.rosterStore?.get(this.record.id)?.repoOutcomes;

        return new Map((Array.isArray(outcomes) ? outcomes : []).map(({reason=null, repoSlug, state}) => [repoSlug, {reason, state}]))
    }

    /**
     * @returns {Object} The complete roster Store listener set.
     * @protected
     */
    getRosterStoreListeners() {
        return {
            load        : this.onRosterChange,
            mutate      : this.onRosterChange,
            recordChange: this.onRosterChange,
            scope       : this
        }
    }

    /**
     * @returns {Boolean} True while a change for the shown record is in flight.
     */
    isPending() {
        const {record, saveStatus} = this;

        return saveStatus?.agentId === record?.id && saveStatus?.state === 'pending'
    }

    /**
     * @summary The add action: the field's slug joins the seat's other repositories as one new
     * list. The slug is lowercased like the add form's working repository; the Brain judges the
     * rest.
     */
    onAddClick() {
        const
            me       = this,
            record   = me.record,
            repoSlug = String(me.getReference('field-repo').value ?? '').trim().toLowerCase();

        if (record && repoSlug && !me.isPending()) {
            me.fire('configIntent', {id: record.id, repos: [...me.getOtherRepos(), {repoSlug}]})
        }
    }

    /**
     * @summary A roster read: re-derive the rows, unless the change is another seat's record.
     * @param {Object} [data] The Store event's data; `recordChange` names its record.
     * @protected
     */
    onRosterChange({record}={}) {
        (!record || record.agentId === this.record?.id) && this.refresh()
    }

    /**
     * @summary A row's Remove: the seat's other repositories without that one, as one new list.
     * @param {Object} data
     * @param {String} data.repoSlug
     */
    onRemoveRepository({repoSlug}) {
        const me = this;

        if (me.record && !me.isPending()) {
            me.fire('configIntent', {id: me.record.id, repos: me.getOtherRepos().filter(repo => repo.repoSlug !== repoSlug)})
        }
    }

    /**
     * @summary Re-derive the rows from the CURRENT record data, the working repository first, each
     * other repository with its last start outcome. Public on purpose: a readback changes the
     * record's fields without changing its identity, so the owning view calls `refresh()` when the
     * roster changes.
     */
    refresh() {
        const
            me          = this,
            outcomes    = me.getRepoOutcomes(),
            workingRepo = me.record?.['metadata.repo'],
            rows        = [
                ...(workingRepo ? [{...workingRepo, working: true}] : []),
                ...me.getOtherRepos().map(repo => ({...repo, ...outcomes.get(repo.repoSlug)}))
            ];

        // an outcome is a fact of the last start, not a live observation: the heading names it
        me.getReference('repos-heading').text = rows.some(row => row.state)
            ? 'Repositories · declared · last start'
            : 'Repositories · declared';

        me.getReference('repo-list').store.data = rows;
        me.getReference('repos-empty').hidden   = !me.record || rows.length > 0;
        me.renderSaveStatus()
    }

    /**
     * @summary Paint the status line for the shown record, and disable the add row while a change
     * is in flight, or while the seat has no working repository: the Fleet refuses other
     * repositories until it has one, and the empty line says so.
     * @protected
     */
    renderSaveStatus() {
        const
            me       = this,
            status   = me.saveStatus?.agentId === me.record?.id ? me.saveStatus : null,
            state    = status?.state ?? 'idle',
            disabled = state === 'pending' || !me.record?.['metadata.repo'];

        me.getReference('repos-status').set({
            cls : ['fm-repos-status', `is-${state}`],
            text: status?.reason ?? ''
        });

        me.getReference('field-repo').disabled = disabled;
        me.getReference('add-button').disabled = disabled
    }

    /**
     * @summary Render one save-state transition only while the card still shows the originating
     * agent, as the configuration card does. An accepted change empties the add field; a refused one
     * keeps it, so the operator can correct the slug.
     * @param {String} agentId
     * @param {'idle'|'pending'|'accepted'|'rejected'|'superseded'} state
     * @param {String} [reason=''] Operator-facing status or rejection reason.
     * @returns {Boolean} True when the visible card accepted the state.
     */
    setSaveStatus(agentId, state, reason='') {
        const me = this;

        if (me.record?.id !== agentId) {
            return false
        }

        if (state === 'accepted') {
            me.getReference('field-repo').value = ''
        }

        me.saveStatus = {agentId, state, reason};

        return true
    }

    /**
     * @summary Detach the roster listeners before the card retires; the provider owns the Store.
     * @param {...*} args
     */
    destroy(...args) {
        this.rosterStore?.un?.(this.getRosterStoreListeners());
        super.destroy(...args)
    }
}

export default Neo.setupClass(AgentReposCard);
