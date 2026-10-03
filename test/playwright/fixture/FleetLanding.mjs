import Base           from '../../../node_modules/neo.mjs/src/core/Base.mjs';
import {isDescriptor} from '../../../node_modules/neo.mjs/src/core/ConfigSymbols.mjs';

/**
 * @summary The tests' fleet landing: loaded INTO the App worker through `Neo.worker.App.loadModule`,
 * it keeps one instance under a fixed id whose reactive configs a spec sets from the page through
 * `Neo.worker.App.setConfigs` — no remote of the App worker lands rows otherwise. A landed roster,
 * activity, or tasks envelope is handed to the cockpit owner's own admission. Roster and activity
 * follow the liveness admission used by their reads; tasks follow `Controller.admitTasks`, which
 * invalidates an older in-flight read. Every set lands — the configs compare nothing — so a spec
 * re-lands the same facts at will. Loading the module again (a fresh `t`) finds the instance. A set
 * mailbox is served as the bridge's `fleetActivity`, so the cockpit's own reads page it. Landed
 * definitions replace the Viewport provider's `agentDefinitions` Store, the Accounts view's source.
 *
 * @see apps/agentos/view/fleet/cockpit/LivenessController.mjs (`admitRoster`, `admitActivity`)
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
         * One `fleetTasks` envelope to land as the owner's answer.
         * @member {Object|null} tasks_=null
         */
        tasks_: {[isDescriptor]: true, value: null, isEqual: () => false},
        /**
         * A mailbox the cockpit reads, `{events}` newest first: set, it becomes the bridge's `fleetActivity`.
         * @member {Object|null} mailbox_=null
         */
        mailbox_: {[isDescriptor]: true, value: null, isEqual: () => false},
        /**
         * Agent definitions to land, `{rows}` shaped like the registry's public definitions.
         * @member {Object|null} definitions_=null
         */
        definitions_: {[isDescriptor]: true, value: null, isEqual: () => false}
    }

    /**
     * The params of every read the mailbox answered, in order; `null` for a read that passed none.
     * @member {Array<Object|null>} mailboxReads=[]
     */
    mailboxReads = []

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

        return provider ? Object.fromEntries(['decisions', 'manualActions', 'preset', 'runId'].map(key => [key, provider.getData(`setupRun.${key}`)])) : null
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
    afterSetDefinitions(value) {
        value && this.landDefinitions(value.rows)
    }

    /**
     * @param {Object|null} value
     */
    afterSetMailbox(value) {
        value && this.serveMailbox(value.events)
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
     * so the live read (no params) gets the newest page and an older-page read the rows below. The cockpit
     * guards every other verb, so they stay absent.
     * @param {Object[]} events Newest first.
     */
    serveMailbox(events) {
        const me = this;

        me.mailboxReads = [];

        (AgentOS.fleet ??= {}).registryBridge = {
            profileId    : me.owner.bridge?.profileId ?? null,
            fleetActivity: async params => {
                const {limit = 50, offset = 0} = params ?? {};

                me.mailboxReads.push(params ?? null);

                return {capability: {state: 'wired'}, counts: [], events: events.slice(offset, offset + limit)}
            }
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
