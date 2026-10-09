import Container                   from '../../../../../node_modules/neo.mjs/src/container/Base.mjs';
import FleetLifecycleIntentAdapter from '../../../util/FleetLifecycleIntentAdapter.mjs';
import RepositoryList              from './RepositoryList.mjs';
import SeatDependencies            from '../../../util/SeatDependencies.mjs';
import SeatRepositories            from '../../../store/SeatRepositories.mjs';
import SeatSessionFolder           from '../../../util/SeatSessionFolder.mjs';

/**
 * The Fleet's answer to a Skip, worded by its `state` ({@link AgentOS.util.FleetLifecycleIntentAdapter#handleSkipIntent}).
 * @type {Readonly<Object<String, Function>>}
 */
const SKIP_WORDS = Object.freeze({
    none       : () => 'Nothing was left to skip: every install had finished.',
    requested  : () => 'Skip requested: the installs still running stop, and the seat launches.',
    unanswered : () => 'Skip sent; the Fleet has not answered yet.',
    unavailable: reason => `Skip unavailable: ${reason}.`
});

/**
 * @class AgentOS.view.fleet.detail.RepositoryBodyContainer
 * @extends Neo.container.Base
 *
 * @summary The body of Agent Detail's Repository pane: the seat's working repository, its whole clone path and
 * where a desktop session opened against it, then each checkout's preparation at the latest start. The checkouts
 * are {@link AgentOS.model.SeatRepository} records in the Accounts card's {@link AgentOS.view.fleet.detail.RepositoryList},
 * read-only here. While that Start still installs, its Skip follows with the consequence beside it. Every line reads
 * the roster record; only the Skip's answer is this body's own state, bound to the seat it was asked for. The owning
 * detail keeps the path's Copy action beside this body.
 */
class RepositoryBodyContainer extends Container {
    static config = {
        /**
         * @member {String} className='AgentOS.view.fleet.detail.RepositoryBodyContainer'
         * @protected
         */
        className: 'AgentOS.view.fleet.detail.RepositoryBodyContainer',
        /**
         * @member {String} ntype='fm-detail-repository-body'
         * @protected
         */
        ntype: 'fm-detail-repository-body',
        /**
         * The pane's vbox would give the body `flex: 1 1 0%`, and a container clips what overflows it: the body
         * takes its content's height instead, so every checkout's row and reason shows.
         * @member {String} flex='none'
         */
        flex: 'none',
        /**
         * The body stacks its lines as a grid, so its children take no flex box.
         * @member {Object} layout={ntype:'base'}
         */
        layout: {ntype: 'base'},
        /**
         * The drilled-in resident's roster record ({@link AgentOS.model.FleetAgent}) or a field bag with its keys.
         * @member {Object|null} record_=null
         * @reactive
         */
        record_: null,
        /**
         * The last Skip for the seat it was asked for: `{agentId, state, reason}`, `state` one of `pending`,
         * `requested`, `none`, `unavailable` or `unanswered`. Component state, never record data; another
         * seat's status renders nothing.
         * @member {Object|null} skipStatus_=null
         * @reactive
         */
        skipStatus_: null,
        /**
         * The facts read from the record, the checkouts' list while a start reported one, then the Skip while
         * one is offered.
         * @member {Object[]} items
         */
        items: [{
            ntype    : 'component',
            cls      : ['fm-detail-repo-facts'],
            reference: 'repo-facts'
        }, {
            module   : RepositoryList,
            editable : false,
            hidden   : true,
            reference: 'repo-checkouts',
            store    : {module: SeatRepositories}
        }, {
            ntype    : 'component',
            cls      : ['fm-detail-repo-skip-actions'],
            hidden   : true,
            reference: 'repo-skip'
        }]
    }

    /**
     * @summary The Skip is a node of a re-rendered item, so one delegated listener serves it.
     * @param {Object} config
     */
    construct(config) {
        super.construct(config);

        this.addDomListeners({click: this.onSkipClick, delegate: 'fm-detail-repo-skip', scope: this})
    }

    /**
     * Triggered after the record config changed: a re-seat onto another resident re-renders.
     * @param {Object|null} value
     * @param {Object|null} oldValue
     * @protected
     */
    afterSetRecord(value, oldValue) {
        this.refresh()
    }

    /**
     * Triggered after the skipStatus config changed: the Fleet's answer reads under the Skip.
     * @param {Object|null} value
     * @param {Object|null} oldValue
     * @protected
     */
    afterSetSkipStatus(value, oldValue) {
        this.refresh()
    }

    /**
     * @summary Ask the Fleet to skip the shown seat's remaining installs. The answer binds to the seat it was
     * asked for, so a body already showing another seat ignores it.
     * @returns {Promise<void>}
     */
    async onSkipClick() {
        const
            me      = this,
            agentId = me.record?.agentId ?? null;

        if (!agentId || (me.skipStatus?.agentId === agentId && me.skipStatus.state === 'pending')) return;

        me.skipStatus = {agentId, reason: null, state: 'pending'};

        const answer = await FleetLifecycleIntentAdapter.handleSkipIntent({agentId});

        !me.isDestroyed && me.record?.agentId === agentId && (me.skipStatus = {agentId, ...answer})
    }

    /**
     * @summary Re-derive the body from the CURRENT record data. Public on purpose: a roster read changes the
     * record's fields without changing its identity, so the owning detail calls `refresh()` on every render.
     */
    refresh() {
        const
            me    = this,
            facts = me.getReference('repo-facts'),
            list  = me.getReference('repo-checkouts'),
            skip  = me.getReference('repo-skip');

        // the record config applies before the items exist
        if (!facts) return;

        const
            {record}  = me,
            repoPath  = typeof record?.repoPath === 'string' && record.repoPath ? record.repoPath : null,
            session   = record ? SeatSessionFolder.paneText(record.sessionFolder, repoPath) : null,
            checkouts = record ? SeatDependencies.checkouts(record.dependencyOutcomes, record.repoOutcomes) : [],
            // Skip is offered only while this Start installs, never once its cancel is sent, and only by a
            // Fleet whose wire has the verb
            skippable = Boolean(record && SeatDependencies.liveLine(record.dependencyOutcomes)) && record.pendingAction !== 'stop' &&
                FleetLifecycleIntentAdapter.canSkip(),
            status    = skippable && me.skipStatus?.agentId === record.agentId ? me.skipStatus : null;

        facts.vdom.cn = record ? [
            {tag: 'span', cls: ['fm-detail-repo-slug'], text: record.repoSlug || 'no repository declared'},
            ...(repoPath ? [{tag: 'span', cls: ['fm-detail-repo-path'], text: repoPath}] : []),
            ...(session  ? [{tag: 'span', cls: ['fm-detail-repo-session', `is-${record.sessionFolder.state}`], text: session}] : []),
            // an install still running belongs to the start pending now, every other row to the last one
            ...(checkouts.length ? [{
                tag : 'span',
                cls : ['fm-detail-repo-prep-head'],
                text: checkouts.some(row => row.state === 'installing') ? 'Preparation · this start' : 'Preparation · last start'
            }] : [])
        ] : [];
        facts.update();

        list.store.data = checkouts;
        list.hidden     = !checkouts.length;

        // the consequence reads before the click: the launch goes on without the unfinished installs
        skip.vdom.cn = skippable ? [{
            tag     : 'button',
            type    : 'button',
            cls     : ['fm-detail-repo-skip'],
            disabled: status?.state === 'pending',
            text    : status?.state === 'pending' ? 'Skipping…' : 'Skip remaining preparation'
        }, {
            tag : 'span',
            cls : ['fm-detail-repo-skip-note'],
            text: 'The seat launches without waiting. A checkout still installing reads Skipped, and while the working checkout is unfinished the seat\'s skills stay unverified.'
        }, ...(status && status.state !== 'pending' ? [{
            tag : 'span',
            cls : ['fm-detail-repo-skip-status', `is-${status.state}`],
            text: SKIP_WORDS[status.state]?.(status.reason) ?? ''
        }] : [])] : [];
        skip.update();
        skip.hidden = !skippable
    }
}

export default Neo.setupClass(RepositoryBodyContainer);
