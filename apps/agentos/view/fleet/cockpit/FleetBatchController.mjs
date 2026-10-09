import ReadingSurfacesController   from './ReadingSurfacesController.mjs';
import FleetLifecycleIntentAdapter from '../../../util/FleetLifecycleIntentAdapter.mjs';
import FleetStartPlan              from '../../../util/FleetStartPlan.mjs';

/**
 * @summary The cockpit controller's fleet-batch layer: the one-click fleet start and the two-press
 * fleet stop, each N per-record honest round-trips through the C2 adapter — never one optimistic
 * fleet-wide spinner — planned by {@link AgentOS.util.FleetStartPlan} and summarized into the chrome's
 * summary slot with every reason reachable. The roster truth (`getRosterRecords`) and the lifecycle
 * request (`requestFleetLifecycle`) are the subclass's and the liveness layer's; this layer owns the
 * batches, their fencing token and the stop's armed state.
 * @class AgentOS.view.fleet.cockpit.FleetBatchController
 * @extends AgentOS.view.fleet.cockpit.ReadingSurfacesController
 */
class FleetBatchController extends ReadingSurfacesController {
    static config = {
        /**
         * @member {String} className='AgentOS.view.fleet.cockpit.FleetBatchController'
         * @protected
         */
        className: 'AgentOS.view.fleet.cockpit.FleetBatchController'
    }

    /**
     * The active fleet-start batch — repeated activations join it until its summary and one
     * roster reconciliation settled.
     * @member {Promise<Object>|null} startFleetPromise=null
     * @protected
     */
    startFleetPromise = null
    /** @member {Object|null} startFleetBatch=null Token fencing late summaries from older batches, in either direction. */
    startFleetBatch = null
    /**
     * The fleet-wide stop's two-press state: the plan the first press showed, `null` while not armed.
     * @member {Object|null} stopFleetArmed=null
     * @protected
     */
    stopFleetArmed = null
    /**
     * The active fleet-stop batch — repeated presses join it until its summary settled.
     * @member {Promise<Object>|null} stopFleetPromise=null
     * @protected
     */
    stopFleetPromise = null

    /**
     * @summary Join the active one-click fleet-start batch, or create exactly one new batch. A start
     * press takes a stop's first press back.
     * @returns {Promise<Object>} The one authoritative batch outcome summary.
     */
    onStartFleet() {
        const me = this;

        me.stopFleetArmed = null;

        if (!me.startFleetPromise) {
            me.startFleetPromise = me.executeStartFleetBatch().finally(() => {
                me.startFleetPromise = null
            })
        }

        return me.startFleetPromise
    }

    /**
     * @summary Start eligible records and re-poll once after their initial answers. Current late
     * answers update the batch summary; a newer batch retires that summary's writer.
     * @returns {Promise<Object>} The outcome summary.
     * @protected
     */
    async executeStartFleetBatch() {
        const
            me      = this,
            records = me.getRosterRecords(),
            plan    = FleetStartPlan.partitionFleetStart(records),
            batch   = me.startFleetBatch = {},
            profile = me.bridgeProfileId;

        me.renderStartSummary(null);

        const results = await Promise.all(plan.eligible.map(record =>
            me.requestFleetLifecycle({action: 'start', agentId: record.agentId}, record)
        ));

        const summary = FleetStartPlan.summarizeFleetStart(plan, results);

        if (!me.isDestroyed && me.startFleetBatch === batch && me.bridgeProfileId === profile) {
            me.renderStartSummary(summary)
        }

        results.forEach((result, index) => {
            result.settlement?.then(answer => {
                if (me.startFleetBatch === batch && answer.isCurrent()) {
                    results[index] = answer;
                    me.renderStartSummary(FleetStartPlan.summarizeFleetStart(plan, results))
                }
            })
        });

        await me.refreshRosterOnSettle(Promise.resolve(true), () => results.some(FleetLifecycleIntentAdapter.rosterMayRead));

        return summary
    }

    /**
     * @summary The fleet-wide stop is a two-press (#618). The first press arms it: the summary slot
     * shows the plan — the up, eligible fleet it would stop and every exclusion with its reason — and
     * nothing is sent; the second press, while armed, sends one stop intent per planned seat through
     * the card's own verb and the summary reads `N stopped · M excluded`. A fleet start takes the
     * first press back; a press during a running stop batch joins it.
     * @returns {Object|Promise<Object>} The plan on the first press, the batch summary on the second.
     */
    onStopFleet() {
        const me = this;

        if (me.stopFleetPromise) return me.stopFleetPromise;

        if (!me.stopFleetArmed) {
            const plan = FleetStartPlan.partitionFleetStop(me.getRosterRecords());

            me.stopFleetArmed = plan;
            me.renderStartSummary({...FleetStartPlan.summarizeFleetStart(plan, []), rejected: [], started: plan.eligible.length}, 'to stop — press Stop fleet again to send');

            return plan
        }

        const plan = me.stopFleetArmed;

        me.stopFleetArmed   = null;
        me.stopFleetPromise = me.executeStopFleetBatch(plan).finally(() => {
            me.stopFleetPromise = null
        });

        return me.stopFleetPromise
    }

    /**
     * @summary Stop the planned seats and re-poll once after their initial answers — the mirror of
     * {@link #executeStartFleetBatch}, sharing its batch token so a newer batch of either direction
     * retires an older summary's writer.
     * @param {{eligible: Object[], excluded: Object[]}} plan The armed plan
     * @returns {Promise<Object>} The outcome summary.
     * @protected
     */
    async executeStopFleetBatch(plan) {
        const
            me      = this,
            batch   = me.startFleetBatch = {},
            profile = me.bridgeProfileId;

        me.renderStartSummary(null);

        const results = await Promise.all(plan.eligible.map(record =>
            me.requestFleetLifecycle({action: 'stop', agentId: record.agentId}, record)
        ));

        const summary = FleetStartPlan.summarizeFleetStart(plan, results);

        if (!me.isDestroyed && me.startFleetBatch === batch && me.bridgeProfileId === profile) {
            me.renderStartSummary(summary, 'stopped')
        }

        results.forEach((result, index) => {
            result.settlement?.then(answer => {
                if (me.startFleetBatch === batch && answer.isCurrent()) {
                    results[index] = answer;
                    me.renderStartSummary(FleetStartPlan.summarizeFleetStart(plan, results), 'stopped')
                }
            })
        });

        await me.refreshRosterOnSettle(Promise.resolve(true), () => results.some(FleetLifecycleIntentAdapter.rosterMayRead));

        return summary
    }

    /**
     * @summary Write a fleet batch's outcome (or a stop's armed plan) into the chrome summary slot —
     * counts as text, per-member reasons on the title; hidden again when cleared.
     * @param {Object|null} summary
     * @param {String} [verb='started'] The direction's word: `started`, `stopped`, or the armed plan's instruction
     */
    renderStartSummary(summary, verb = 'started') {
        const slot = this.getReference('fleet-start-summary');

        if (!slot) return;

        if (!summary) {
            slot.set({hidden: true, text: ''});
            return
        }

        const {detail, text} = FleetStartPlan.renderFleetStartSummary(summary, verb);

        slot.vdom.title = detail;
        slot.set({hidden: false, text})
    }
}

export default Neo.setupClass(FleetBatchController);
