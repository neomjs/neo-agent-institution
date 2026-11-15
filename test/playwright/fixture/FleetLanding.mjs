import Base           from '../../../node_modules/neo.mjs/src/core/Base.mjs';
import {isDescriptor} from '../../../node_modules/neo.mjs/src/core/ConfigSymbols.mjs';

/**
 * @summary The tests' fleet landing: loaded INTO the App worker through `Neo.worker.App.loadModule`,
 * it keeps one instance under a fixed id whose reactive configs a spec sets from the page through
 * `Neo.worker.App.setConfigs` — no remote of the App worker lands rows otherwise. A landed roster,
 * activity, or tasks envelope is handed to the cockpit owner's own admission. Roster and activity
 * follow the liveness admission used by their reads; tasks follow `Controller.admitTasks`, which
 * invalidates an older in-flight read, open work follows `Controller.admitOpenWork` the same way, and the shown
 * seat's recent turns `Controller.admitRecentTurns`. Every set lands — the configs compare nothing — so a spec
 * re-lands the same facts at will. Loading the module again (a fresh `t`) finds the instance. A set
 * mailbox is served as the bridge's `fleetActivity`, so the cockpit's own reads page it. Landed
 * definitions replace the Viewport provider's `agentDefinitions` Store, the Accounts view's source. A
 * landed Brain-health answer reaches the owner's `applyBrainHealth`, where the shell's lifecycle answer lands.
 *
 * @see apps/agentos/view/fleet/cockpit/LivenessController.mjs (`admitRoster`, `admitActivity`, `applyBrainHealth`)
 * @see apps/agentos/view/fleet/cockpit/Controller.mjs (`admitTasks`)
 */
class FleetLanding extends Base {
    static config = {
        /**
         * @member {String} className='AgentOS.test.FleetLanding'
         * @protected
         */
        className: 'AgentOS.test.FleetLanding',
        /**
         * The roster to land, `{rows}` shaped like the store's records.
         * @member {Object|null} roster_=null
         */
        roster_: {[isDescriptor]: true, value: null, isEqual: () => false},
        /**
         * The activity to land, `{events}` shaped like the stream's snapshot.
         * @member {Object|null} activity_=null
         */
        activity_: {[isDescriptor]: true, value: null, isEqual: () => false},
        /**
         * The shell's Brain-health answer to land, `{response}`: `{state, cause: {source, detail}}`.
         * @member {Object|null} brainHealth_=null
         */
        brainHealth_: {[isDescriptor]: true, value: null, isEqual: () => false},
        /**
         * One `fleetTasks` envelope to land as the owner's answer.
         * @member {Object|null} tasks_=null
         */
        tasks_: {[isDescriptor]: true, value: null, isEqual: () => false},
        /**
         * One `fleetOpenWork` envelope to land as the owner's answer, `{snapshot}`.
         * @member {Object|null} openWork_=null
         */
        openWork_: {[isDescriptor]: true, value: null, isEqual: () => false},
        /**
         * One `fleetRecentTurns` envelope to land as the owner's answer for the shown seat, `{snapshot}`.
         * @member {Object|null} recentTurns_=null
         */
        recentTurns_: {[isDescriptor]: true, value: null, isEqual: () => false},
        /**
         * A mailbox the cockpit reads, `{events, observers?}` newest first: set, it becomes the bridge's
         * `fleetActivity`. `observers` maps an observer scope to its population, which an observer read pages.
         * @member {Object|null} mailbox_=null
         */
        mailbox_: {[isDescriptor]: true, value: null, isEqual: () => false},
        /**
         * Agent definitions to land, `{rows}` shaped like the registry's public definitions.
         * @member {Object|null} definitions_=null
         */
        definitions_: {[isDescriptor]: true, value: null, isEqual: () => false},
        /**
         * One `/fleet/probe` plane-admission envelope to land as the owner's answer, `{snapshot}`.
         * @member {Object|null} planeAdmission_=null
         */
        planeAdmission_: {[isDescriptor]: true, value: null, isEqual: () => false}
    }

    /**
     * The params of every read the mailbox answered, in order; `null` for a read that passed none.
     * @member {Array<Object|null>} mailboxReads=[]
     */
    mailboxReads = []
    /**
     * The params of every message read the observed mailbox answered, in order.
     * @member {Object[]} messageReads=[]
     */
    messageReads = []

    /**
     * @summary The admission a served observer population answers under, shaped as the Brain's.
     * @param {String} scope
     * @returns {Object}
     */
    static observationOf(scope) {
        return {admissionKey: `e2e-${scope}`, clamped: false, planeId: 'plane-e2e', policy: 'team', scope, viewer: '@operator'}
    }

    /**
     * @summary One page of a served observer population, shaped as the Brain's composed answer: its rows, the
     * population's complete count, and the canonical continuation through the A2A slot.
     * @param {Object[]} population Newest first
     * @param {String} scope
     * @param {Object} page `{limit, offset}`
     * @returns {Object}
     */
    static observedPage(population, scope, {limit, offset}) {
        const
            rows = population.slice(offset, offset + limit),
            next = offset + rows.length < population.length ? offset + rows.length : null;

        return {
            capability: {state: 'wired'},
            counts    : [{source: 'memory-core:mailbox', scope: 'total', value: population.length, complete: true, capturedAt: new Date().toISOString()}],
            events    : rows,
            a2a       : {
                observation : FleetLanding.observationOf(scope),
                page        : {limit, nextOffset: next, offset, totalCount: population.length, truncated: next !== null},
                continuation: next === null ? null : {slots: ['a2a'], offset: next}
            }
        }
    }

    /**
     * The mounted cockpit's liveness owner.
     * @member {AgentOS.view.fleet.cockpit.LivenessController} owner
     */
    get owner() {
        const owner = Neo.manager.Component.findFirst('ntype', 'fm-fleet-cockpit')?.getController();

        if (!owner) {
            throw new Error('FleetLanding: no fm-fleet-cockpit with its controller is mounted')
        }

        return owner
    }

    /**
     * The Viewport provider's `setupRun` as plain leaves, for a spec to read from the page through
     * `Neo.worker.App.getConfigs`; `null` while no Viewport holds a provider.
     * @member {Object|null} setupRun
     */
    get setupRun() {
        const provider = Neo.manager.Component.findFirst('className', 'AgentOS.view.Viewport')?.getStateProvider();

        return provider ? Object.fromEntries(['dataRoot', 'decisions', 'manualActions', 'planeId', 'preset', 'runId'].map(key => [key, provider.getData(`setupRun.${key}`)])) : null
    }

    /**
     * @param {Object|null} value
     */
    afterSetActivity(value) {
        value && this.landActivity(value.events)
    }

    /**
     * @param {Object|null} value
     */
    afterSetBrainHealth(value) {
        value && this.owner.applyBrainHealth(value.response)
    }

    /**
     * @param {Object|null} value
     */
    afterSetDefinitions(value) {
        value && this.landDefinitions(value.rows)
    }

    /**
     * @param {Object|null} value
     */
    afterSetMailbox(value) {
        value && this.serveMailbox(value.events, value.observers)
    }

    /**
     * @param {Object|null} value
     */
    afterSetOpenWork(value) {
        value && this.owner.admitOpenWork(value.snapshot)
    }

    /**
     * @param {Object|null} value
     */
    afterSetPlaneAdmission(value) {
        value && this.owner.applyPlaneAdmission(value.snapshot)
    }

    /**
     * @param {Object|null} value
     */
    afterSetRecentTurns(value) {
        value && this.owner.admitRecentTurns(value.snapshot)
    }

    /**
     * @param {Object|null} value
     */
    afterSetRoster(value) {
        value && this.landRoster(value.rows)
    }

    /**
     * @param {Object|null} value
     */
    afterSetTasks(value) {
        value && this.landTasks(value.snapshot)
    }

    /**
     * The events, admitted as a wired answer of the bridge in hand.
     * @param {Object[]} events
     */
    landActivity(events) {
        const {owner} = this;

        owner.admitActivity({events, profileId: owner.bridge?.profileId ?? null})
    }

    /**
     * @summary The definitions, as the registry's answer: they replace the provider's
     * `agentDefinitions` Store, which the Accounts list and card read.
     * @param {Object[]} rows
     */
    landDefinitions(rows) {
        const store = Neo.manager.Component.findFirst('className', 'AgentOS.view.Viewport')?.getStateProvider()?.getStore('agentDefinitions');

        if (!store) {
            throw new Error('FleetLanding: no Viewport with an agentDefinitions store is mounted')
        }

        store.data = rows
    }

    /**
     * The rows, admitted as an answer of the bridge in hand.
     * @param {Object[]} rows
     */
    landRoster(rows) {
        const {owner} = this;

        owner.admitRoster({profileId: owner.bridge?.profileId ?? null, rows})
    }

    /**
     * @summary Land a task envelope or an explicit unobserved state through the cockpit owner.
     * @param {Object|null} snapshot
     */
    landTasks(snapshot) {
        this.owner.admitTasks(snapshot)
    }

    /**
     * @summary Serves the events as the bridge's one verb: each read answers, wired, the page at its `offset`,
     * so the live read (no params) gets the newest page and an older-page read the rows below. With
     * `observers`, an observer read pages its scope's population instead ({@link #observedPage}), and the
     * bridge answers its message reads in full under the same admission. The cockpit guards every other verb,
     * so they stay absent.
     * @param {Object[]} events Newest first.
     * @param {Object|null} [observers=null] Observer scope → population, newest first
     */
    serveMailbox(events, observers = null) {
        const me = this;

        me.mailboxReads = [];
        me.messageReads = [];

        (AgentOS.fleet ??= {}).registryBridge = {
            profileId    : me.owner.bridge?.profileId ?? null,
            fleetActivity: async params => {
                const {limit = 50, observer, offset = 0} = params ?? {};

                me.mailboxReads.push(params ?? null);

                return observer && observers
                    ? FleetLanding.observedPage(observers[observer.scope] ?? [], observer.scope, {limit, offset})
                    : {capability: {state: 'wired'}, counts: [], events: events.slice(offset, offset + limit)}
            },
            ...(observers && {
                fleetOwnMessage: async params => {
                    const row = Object.values(observers).flat().find(event => event.payload?.messageId === params.messageId);

                    me.messageReads.push(params);

                    return row
                        ? {...row.payload, body: `the words of ${row.payload.subject}`, observation: FleetLanding.observationOf(params.observer?.scope)}
                        : {reason: 'no such message', status: 'rejected'}
                }
            })
        }
    }

    /**
     * @summary The reads the mailbox answered, for a spec to read over the Neural Link.
     * @returns {Array<Object|null>}
     */
    readMailboxReads() {
        return this.mailboxReads
    }
}

export default Neo.setupClass(FleetLanding);

Neo.get('fm-fleet-landing') || Neo.create(FleetLanding, {id: 'fm-fleet-landing'});
