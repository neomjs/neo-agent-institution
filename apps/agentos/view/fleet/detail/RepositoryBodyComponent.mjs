import Component                   from '../../../../../node_modules/neo.mjs/src/component/Base.mjs';
import FleetLifecycleIntentAdapter from '../../../util/FleetLifecycleIntentAdapter.mjs';
import SeatDependencies            from '../../../util/SeatDependencies.mjs';
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
 * @class AgentOS.view.fleet.detail.RepositoryBodyComponent
 * @extends Neo.component.Base
 *
 * @summary The body of Agent Detail's Repository pane: the seat's working repository and its whole clone path,
 * where a desktop session opened against it, then each checkout's preparation at the latest start in
 * {@link AgentOS.util.SeatDependencies}'s words, and, while that Start still installs, its Skip with the
 * consequence beside it. Every line reads the roster record; only the Skip's answer is this pane's own state,
 * bound to the seat it was asked for. The owning detail keeps the path's Copy action beside this body.
 */
class RepositoryBodyComponent extends Component {
    static config = {
        /**
         * @member {String} className='AgentOS.view.fleet.detail.RepositoryBodyComponent'
         * @protected
         */
        className: 'AgentOS.view.fleet.detail.RepositoryBodyComponent',
        /**
         * @member {String} ntype='fm-detail-repository-body'
         * @protected
         */
        ntype: 'fm-detail-repository-body',
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
        skipStatus_: null
    }

    /**
     * @summary The Skip is a node of the re-rendered body, so one delegated listener serves it.
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
            me        = this,
            record    = me.record;

        if (!record) {
            me.vdom.cn = [];
            me.update();
            return
        }

        const
            repoPath  = typeof record.repoPath === 'string' && record.repoPath ? record.repoPath : null,
            session   = SeatSessionFolder.paneText(record.sessionFolder, repoPath),
            checkouts = SeatDependencies.checkouts(record.dependencyOutcomes, record.repoOutcomes),
            // Skip is offered only while this Start installs, never once its cancel is sent, and only by a
            // Fleet whose wire has the verb
            skippable = Boolean(SeatDependencies.liveLine(record.dependencyOutcomes)) && record.pendingAction !== 'stop' &&
                FleetLifecycleIntentAdapter.canSkip(),
            skip      = skippable && me.skipStatus?.agentId === record.agentId ? me.skipStatus : null;

        me.vdom.cn = [
            {tag: 'span', cls: ['fm-detail-repo-slug'], text: record.repoSlug || 'no repository declared'},
            ...(repoPath ? [{tag: 'span', cls: ['fm-detail-repo-path'], text: repoPath}] : []),
            ...(session  ? [{tag: 'span', cls: ['fm-detail-repo-session', `is-${record.sessionFolder.state}`], text: session}] : []),
            // an install still running belongs to the start pending now, every other row to the last one
            ...(checkouts.length ? [{
                tag : 'span',
                cls : ['fm-detail-repo-prep-head'],
                text: checkouts.some(row => row.state === 'installing') ? 'Preparation · this start' : 'Preparation · last start'
            }] : []),
            ...checkouts.flatMap(({reason, repoSlug, state}) => [
                {tag: 'span', cls: ['fm-detail-repo-prep', `is-${state}`], cn: [
                    {tag: 'span', cls: ['fm-detail-repo-prep-slug'],  text: repoSlug},
                    {tag: 'span', cls: ['fm-detail-repo-prep-state'], text: SeatDependencies.label(state)}
                ]},
                ...(reason ? [{tag: 'span', cls: ['fm-detail-repo-prep-reason', `is-${state}`], text: reason}] : [])
            ]),
            // the consequence reads before the click: the launch goes on without the unfinished installs
            ...(skippable ? [{
                tag     : 'button',
                type    : 'button',
                cls     : ['fm-detail-repo-skip'],
                disabled: skip?.state === 'pending',
                text    : skip?.state === 'pending' ? 'Skipping…' : 'Skip remaining preparation'
            }, {
                tag : 'span',
                cls : ['fm-detail-repo-skip-note'],
                text: 'The seat launches without waiting. A checkout still installing reads Skipped, and while the working checkout is unfinished the seat\'s skills stay unverified.'
            }] : []),
            ...(skip && skip.state !== 'pending' ? [{
                tag : 'span',
                cls : ['fm-detail-repo-skip-status', `is-${skip.state}`],
                text: SKIP_WORDS[skip.state]?.(skip.reason) ?? ''
            }] : [])
        ];

        me.update()
    }
}

export default Neo.setupClass(RepositoryBodyComponent);
