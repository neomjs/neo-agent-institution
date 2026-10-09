import ReadingSurfacesController   from './ReadingSurfacesController.mjs';
import FleetLifecycleIntentAdapter from '../../../util/FleetLifecycleIntentAdapter.mjs';
import FleetStartPlan              from '../../../util/FleetStartPlan.mjs';

/**
 * @summary The cockpit controller's fleet-batch layer: the fleet button that reads the plan it would
 * run (`Start fleet · n` · `Stop fleet · n` · the plain `Start fleet` with its reason), the one-click
 * fleet start and the two-press fleet stop, each N per-record honest round-trips through the C2
 * adapter — never one optimistic fleet-wide spinner — planned by {@link AgentOS.util.FleetStartPlan}
 * and summarized into the chrome's summary slot with every reason reachable. The roster truth
 * (`getRosterRecords`) and the lifecycle request (`requestFleetLifecycle`) are the subclass's and the
 * liveness layer's; this layer owns the batches, their fencing token, the stop's armed window and the
 * button's words, read on settled rosters only ({@link #onRosterSettled}).
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
     * How long the first press stays armed: the bounded window after which the button reads its plan
     * again with nothing sent — a slow operator is never punished, a changed fleet never stopped on a
     * stale plan (#618, the design read's rule 3).
     * @member {Number} stopFleetArmMs=10000
     */
    stopFleetArmMs = 10000
    /**
     * The armed window's timer, `null` while not armed.
     * @member {Number|null} stopFleetArmTimer=null
     * @protected
     */
    stopFleetArmTimer = null
    /**
     * The active fleet-stop batch — repeated presses join it until its summary settled.
     * @member {Promise<Object>|null} stopFleetPromise=null
     * @protected
     */
    stopFleetPromise = null

    /**
     * @summary The fleet button's press, routed by the plan it shows: an armed stop's second press
     * sends; a `Stop fleet · n` label arms the stop; any `Start fleet` label starts — the plain one
     * too, whose press reports in the summary why nothing started.
     * @returns {Object|Promise<Object>} The armed plan, or the batch outcome summary.
     */
    onFleetButton() {
        const me = this;

        if (me.stopFleetArmed) return me.onStopFleet();

        return FleetStartPlan.describeFleetButton(me.getRosterRecords()).action === 'stop' ? me.onStopFleet() : me.onStartFleet()
    }

    /**
     * @summary Write the fleet button's words. During a batch the last settled label stays and the
     * button is disabled — a press mid-cascade is impossible, not ignored. While the stop is armed the
     * chip reads `Stop fleet · press again`. Otherwise the plan's own label, the icon following the
     * verb, and a plain label's reason on the title. Read it on settled rosters only.
     * @protected
     */
    renderFleetButton() {
        const
            me     = this,
            button = me.getReference('fleet-button');

        if (!button) return;

        if (me.startFleetPromise || me.stopFleetPromise) {
            button.disabled = true;
            return
        }

        const label = me.stopFleetArmed
            ? {action: 'stop', text: 'Stop fleet · press again', title: null}
            : FleetStartPlan.describeFleetButton(me.getRosterRecords());

        if (label.title) {
            button.vdom.title = label.title
        } else {
            delete button.vdom.title
        }

        button.set({
            disabled: false,
            iconCls : label.action === 'stop' ? 'fa-solid fa-stop' : 'fa-solid fa-play',
            text    : label.text
        });
        button.update()
    }

    /**
     * @summary The roster settled — the liveness layer's one admit path. An armed stop whose plan the
     * fresh roster no longer matches is taken back, nothing sent; then the button reads its plan.
     * @protected
     */
    onRosterSettled() {
        const me = this;

        if (me.stopFleetArmed && FleetStartPlan.stopPlanKey(FleetStartPlan.partitionFleetStop(me.getRosterRecords())) !== FleetStartPlan.stopPlanKey(me.stopFleetArmed)) {
            me.disarmStopFleet()
        }

        me.renderFleetButton()
    }

    /**
     * @summary Take the first press back: the armed plan and its window go, the summary slot clears,
     * the button reads its plan again.
     * @protected
     */
    disarmStopFleet() {
        const me = this;

        clearTimeout(me.stopFleetArmTimer);
        me.stopFleetArmTimer = null;

        if (!me.stopFleetArmed || me.isDestroyed) return;

        me.stopFleetArmed = null;
        me.renderSummarySlot(null);
        me.renderFleetButton()
    }

    /**
     * @summary Join the active one-click fleet-start batch, or create exactly one new batch. A start
     * press takes a stop's first press back.
     * @returns {Promise<Object>} The one authoritative batch outcome summary.
     */
    onStartFleet() {
        const me = this;

        me.disarmStopFleet();

        if (!me.startFleetPromise) {
            me.startFleetPromise = me.executeStartFleetBatch().finally(() => {
                me.startFleetPromise = null;
                me.renderFleetButton()
            });
            me.renderFleetButton()
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
     * shows the plan — the up, eligible fleet by name and every exclusion with its reason — the chip
     * becomes the second press, and nothing is sent; the second press, inside the armed window, sends
     * one stop intent per planned seat through the card's own verb and the summary reads
     * `N stopped · M excluded`. A roster whose plan differs, the window's end or a fleet start take the
     * first press back; a press during a running stop batch joins it.
     * @returns {Object|Promise<Object>} The plan on the first press, the batch summary on the second.
     */
    onStopFleet() {
        const me = this;

        if (me.stopFleetPromise) return me.stopFleetPromise;

        if (!me.stopFleetArmed) {
            const plan = FleetStartPlan.partitionFleetStop(me.getRosterRecords());

            me.stopFleetArmed    = plan;
            me.stopFleetArmTimer = setTimeout(() => me.disarmStopFleet(), me.stopFleetArmMs);
            me.renderSummarySlot(FleetStartPlan.renderFleetStopPlan(plan));
            me.renderFleetButton();

            return plan
        }

        const plan = me.stopFleetArmed;

        clearTimeout(me.stopFleetArmTimer);
        me.stopFleetArmTimer = null;
        me.stopFleetArmed    = null;
        me.stopFleetPromise  = me.executeStopFleetBatch(plan).finally(() => {
            me.stopFleetPromise = null;
            me.renderFleetButton()
        });
        me.renderFleetButton();

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
     * @summary Write a fleet batch's outcome into the chrome summary slot — counts as text, per-member
     * reasons on the title; hidden again when cleared.
     * @param {Object|null} summary
     * @param {String} [verb='started'] The direction's word: `started` or `stopped`
     */
    renderStartSummary(summary, verb = 'started') {
        this.renderSummarySlot(summary && FleetStartPlan.renderFleetStartSummary(summary, verb))
    }

    /**
     * @summary Write one line into the chrome summary slot — its text as the element's text, the
     * per-member reasons on its title — or hide the slot again. The batch outcomes and the armed stop's
     * plan share it.
     * @param {{text: String, detail: String}|null} line
     * @protected
     */
    renderSummarySlot(line) {
        const slot = this.getReference('fleet-start-summary');

        if (!slot) return;

        if (!line) {
            slot.set({hidden: true, text: ''});
            return
        }

        slot.vdom.title = line.detail;
        slot.set({hidden: false, text: line.text})
    }

    /**
     * @summary The armed window dies with the controller.
     * @param {...*} args
     */
    destroy(...args) {
        clearTimeout(this.stopFleetArmTimer);
        super.destroy(...args)
    }
}

export default Neo.setupClass(FleetBatchController);
