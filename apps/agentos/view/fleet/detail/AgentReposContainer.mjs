import Button           from '../../../../../node_modules/neo.mjs/src/button/Base.mjs';
import Container        from '../../../../../node_modules/neo.mjs/src/container/Base.mjs';
import TextField        from '../../../../../node_modules/neo.mjs/src/form/field/Text.mjs';
import RepositoryList   from './RepositoryList.mjs';
import SeatDependencies from '../../../util/SeatDependencies.mjs';
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
 * Checkout provenance and dependency preparation are separate facts. A preparation response may
 * paint the checkout immediately; the next roster observation replaces that receipt. Unlisting
 * retains a known checkout with a separate guarded delete action. No deletion history is kept.
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
         * start's per-repository outcome on the seat's {@link AgentOS.model.FleetAgent} record, its
         * clones and its dependencies. The card listens to the Store directly, as the configuration
         * card does to the tenant roster, and never writes it.
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
            text     : 'Repositories'
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

    /** @member {Number} operationGeneration=0 Binding and operation fence. @private */
    operationGeneration = 0

    /** @member {Object[]|null} checkoutReceipt=null Checkout response until the next roster observation. @private */
    checkoutReceipt = null

    /** @member {Object|null} repositoryStatus=null Current operation feedback, scoped to the binding. @private */
    repositoryStatus = null

    /** @member {Boolean} deleteUnavailable=false The connected server refused the additive verb. @private */
    deleteUnavailable = false

    /**
     * @summary Listen for the rows' Remove clicks and render the first state.
     * @param {...*} args
     */
    onConstructed(...args) {
        super.onConstructed(...args);

        this.getReference('repo-list').on({removeRepository: this.onRemoveRepository, deleteCheckout: this.onDeleteCheckout, scope: this});
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

        me.operationGeneration++;
        me.deleteUnavailable = false;
        me.checkoutReceipt = me.repositoryStatus = null;
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
        this.operationGeneration++;
        this.deleteUnavailable = false;
        this.checkoutReceipt = this.repositoryStatus = null;
        oldValue?.un?.(this.getRosterStoreListeners());
        value?.on?.(this.getRosterStoreListeners());
        this.isConstructed && this.refresh()
    }

    /**
     * @summary The seat's other repositories as the registry holds them: `{repoSlug, cloneUrl}` each,
     * plus the `forge` the registry records for a GitLab repository. These are the exact entries a new
     * list must carry forward; an entry without its `forge` would read as GitHub.
     * @returns {Object[]}
     */
    getOtherRepos() {
        return (this.record?.['metadata.repos'] ?? []).map(({cloneUrl, forge, repoSlug}) => forge ? {cloneUrl, forge, repoSlug} : {cloneUrl, repoSlug})
    }

    /**
     * @summary The last start's outcome per repository slug, from the seat's roster record: its clone and
     * its dependency rows, folded by {@link AgentOS.util.SeatDependencies#checkouts}. A repository that
     * start did not cover has no entry and shows none until the next start. One removed and re-added since
     * keeps that start's entry: the outcome records the start, not the current list.
     * @returns {Map<String, {reason: String|null, state: String}>}
     */
    getRepoOutcomes() {
        const agent = this.record && this.rosterStore?.get(this.record.id);

        return new Map(SeatDependencies.checkouts(agent?.dependencyOutcomes, agent?.repoOutcomes).map(({repoSlug, ...outcome}) => [repoSlug, outcome]))
    }

    /**
     * @summary Capture this card's current binding. Leaving and returning to the same record, a
     * new operation, or a roster-Store replacement retires the old reply.
     * @returns {Function}
     */
    beginRepositoryOperation() {
        const me = this, generation = ++me.operationGeneration, record = me.record;

        me.repositoryStatus = null;
        return () => !me.isDestroying && !me.isDestroyed && me.record === record &&
            me.operationGeneration === generation
    }

    /** @summary Raw checkout facts; dependency history cannot create retained membership. @returns {Object[]} */
    getCheckoutRows() {
        return this.checkoutReceipt ?? this.rosterStore?.get(this.record?.id)?.repoOutcomes ?? []
    }

    /**
     * @summary Paint an operation response in the owned rows Store. The next roster observation
     * replaces the entire receipt, including successful removal; no tombstone survives it.
     * @param {Object} status `{action, state, reason?, repoSlug?}`.
     * @param {Object[]|null} [rows=null] Confirmed checkout rows, never inferred from save success.
     */
    setRepositoryStatus(status, rows=null) {
        this.repositoryStatus = status;
        if (rows) this.checkoutReceipt = rows;
        this.refresh()
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

        return (saveStatus?.agentId === record?.id && saveStatus?.state === 'pending') ||
            this.repositoryStatus?.state === 'pending'
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
        if (!record || record.agentId === this.record?.id) {
            this.checkoutReceipt = null;
            this.refresh()
        }
    }

    /** @summary Request guarded deletion only for an offered retained row. @param {Object} data */
    onDeleteCheckout({repoSlug}) {
        const row = this.getReference('repo-list').store.get(repoSlug);

        if (row?.retained && row.canDelete && !this.isPending()) {
            this.fire('deleteCheckout', {id: this.record.id, repoSlug})
        }
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
     * repository with its last start outcome, and the add field's slug shape for the seat's
     * forge. Public on purpose: a readback changes the
     * record's fields without changing its identity, so the owning view calls `refresh()` when the
     * roster changes.
     */
    refresh() {
        const
            me           = this,
            outcomes     = me.getRepoOutcomes(),
            clones       = new Map(me.getCheckoutRows().map(row => [row.repoSlug, row])),
            agent        = me.rosterStore?.get(me.record?.id),
            dependencies = new Map((agent?.dependencyOutcomes ?? []).map(row => [row.repoSlug, row])),
            workingRepo  = me.record?.['metadata.repo'],
            declared     = [
                ...(workingRepo && agent?.repoStatus?.state !== 'unconfigured' ? [{...workingRepo, working: true}] : []),
                ...me.getOtherRepos()
            ],
            listed      = new Set(declared.map(row => row.repoSlug)),
            canDelete   = !me.deleteUnavailable && typeof globalThis.AgentOS?.fleet?.registryBridge?.removeRepoCheckout === 'function',
            rows        = [
                ...declared,
                ...[...clones.values()].filter(row => row.state === 'prepared' && !listed.has(row.repoSlug))
                    .map(row => ({repoSlug: row.repoSlug, retained: true, canDelete}))
            ].map(repo => ({...repo, ...outcomes.get(repo.repoSlug),
                ...me.repositoryFacts(repo, clones.get(repo.repoSlug), dependencies.get(repo.repoSlug), agent?.repoStatus)}));

        me.getReference('repos-heading').text = 'Repositories';

        me.getReference('repo-list').store.data        = rows;
        me.getReference('repos-empty').hidden          = !me.record || rows.length > 0;
        me.getReference('field-repo').placeholderText = me.record?.forge === 'gitlab' ? 'group/project' : 'owner/repo';
        me.renderSaveStatus()
    }

    /**
     * @summary Word the independent checkout and dependency observations for one Accounts row.
     * @param {Object} repo Declared or retained row.
     * @param {Object} [clone] Raw clone outcome, including `via` and `at`.
     * @param {Object} [dependency] Last Start's dependency result.
     * @param {Object} [workingStatus] The working checkout's filesystem observation.
     * @returns {Object}
     */
    repositoryFacts(repo, clone, dependency, workingStatus) {
        const
            status   = this.repositoryStatus,
            applies  = status?.action === 'prepare' ? !repo.working && !repo.retained : status?.repoSlug === repo.repoSlug,
            checkout = repo.retained
                ? {text: 'checkout kept on disk'}
                : clone?.state === 'prepared'
                    ? {text: `checkout ready · ${clone.via === 'prepare' ? 'now' : 'last start'}`, title: clone.at, state: 'prepared'}
                    : clone?.state === 'failed'
                        ? {text: 'checkout failed', reason: clone.reason, state: 'failed'}
                        : {text: 'clones at the next Start'};

        if (repo.working) {
            const state = workingStatus?.repoSlug === repo.repoSlug ? workingStatus.state : null;

            checkout.text = state === 'checkout' ? 'checkout ready · observed'
                : state === 'absent' || state === 'empty' ? 'clones at the next Start'
                : state === 'occupied-non-checkout' ? 'checkout conflict'
                : 'checkout unobserved';
            checkout.state = state === 'checkout' ? 'prepared' : state === 'occupied-non-checkout' ? 'failed' : null;
            checkout.reason = state === 'occupied-non-checkout' ? 'a foreign folder occupies its path' : null
        }

        if (applies && status.state === 'pending') {
            checkout.text = status.action === 'prepare' ? 'preparing checkout…' : 'deleting checkout…'
        } else if (applies && status.reason) {
            checkout.reason = status.reason
        }

        const state  = SeatDependencies.paneRow(null, dependency).state;
        const labels = {
            prepared        : 'skills prepared', unverified: 'skills unverified',
            'not-applicable': 'skills not applicable', installing: 'installing…',
            failed          : 'skills failed', skipped: 'skipped', canceled: 'canceled'
        };
        const skills = dependency ? {
            text : labels[state], reason: dependency.reason, state,
            title: state === 'installing' ? SeatDependencies.liveLine(this.rosterStore?.get(this.record?.id)?.dependencyOutcomes)?.text : 'At the last Start'
        } : clone?.state === 'prepared' && clone.via !== 'prepare'
            ? {text: 'skills unverified', reason: 'no dependency install reported'}
            : {text: 'skills at the next Start'};

        return {checkout, dependency: skills}
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
            status   = me.repositoryStatus ?? (me.saveStatus?.agentId === me.record?.id ? me.saveStatus : null),
            state    = status?.state ?? 'idle',
            disabled = me.isPending() || !me.record?.['metadata.repo'];

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
