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
     * How many seats one fleet start sends at a time. The next wave leaves once the previous wave's
     * intents have answered — settled, refused, or timed out on the adapter's honesty bound — so the
     * Fleet prepares, the plane proves and the host boots a bounded number of seats at once. `1` is
     * one by one.
     * @member {Number} startFleetWaveSize=2
     */
    startFleetWaveSize = 2
    /**
     * The fleet-wide stop's two-press state: the plan the first press showed, bound to the Fleet it
     * was shown for — `{plan, profileId, store}` — and `null` while not armed. The second press
     * sends only while that binding and the plan still hold ({@link #isStopArmCurrent}).
     * @member {Object|null} stopFleetArmed=null
     * @protected
     */
    stopFleetArmed = null
    /**
     * How long the first press stays armed: the bounded window after which the button reads its plan
     * again with nothing sent — a slow operator is never punished, a changed fleet never stopped on a
     * stale plan.
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

        if (me.stopFleetArmed && !me.isStopArmCurrent(me.stopFleetArmed, FleetStartPlan.partitionFleetStop(me.getRosterRecords()))) {
            me.disarmStopFleet()
        }

        me.renderFleetButton()
    }

    /**
     * @summary The roster was retired for another target (a replaced bridge or profile): an armed
     * stop was shown for the old Fleet and goes with it, nothing sent; a running batch loses its
     * token, so it sends no further wave and writes no further line — even if the same profile id
     * comes back later, the batch was the retired roster's.
     * @protected
     */
    onRosterRetired() {
        this.startFleetBatch = null;
        this.disarmStopFleet()
    }

    /**
     * @summary Whether an armed stop may still send: the bridge's profile and the roster store are
     * the ones the first press bound, and the fresh partition's eligible set is the plan the operator
     * saw. A card's own pending action, a settled roster that differs, or a replaced target all fail it.
     * @param {{plan: Object, profileId: String|null, store: Object|null}} armed
     * @param {{eligible: Object[], excluded: Object[]}} fresh The partition of the current roster.
     * @returns {Boolean}
     * @protected
     */
    isStopArmCurrent(armed, fresh) {
        const me = this;

        return armed.profileId === me.bridgeProfileId
            && armed.store === me.resolveFleetRosterStore()
            && FleetStartPlan.stopPlanKey(fresh) === FleetStartPlan.stopPlanKey(armed.plan)
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
     * @summary Start eligible records in waves ({@link FleetStartPlan.waves}, {@link #startFleetWaveSize})
     * and re-poll once after their answers: one wave's intents leave together, the next wave once they
     * have answered (settled, refused, or timed out on the adapter's bound), and between waves the
     * chrome line counts the unsent seats as pending. Each wave reads its seats again as they are when
     * it leaves: a seat whose own Start left meanwhile, or that came up, is not sent twice — its result
     * reads `superseded` with the partition's reason. A newer batch, a retired roster, a replaced Fleet
     * or a destroyed controller retires the batch between waves: no further intent leaves, and the line
     * it still owned is its last. An earlier wave's late answer updates the line as soon as it lands,
     * while this batch owns the slot; a newer batch retires that writer.
     * @returns {Promise<Object>} The outcome summary.
     * @protected
     */
    async executeStartFleetBatch() {
        const
            me      = this,
            records = me.getRosterRecords(),
            plan    = FleetStartPlan.partitionFleetStart(records),
            batch   = me.startFleetBatch = {},
            profile = me.bridgeProfileId,
            current = () => !me.isDestroyed && me.startFleetBatch === batch && me.bridgeProfileId === profile,
            results = [],
            // an earlier wave's late answer updates the line while later waves are still leaving — only
            // while this batch owns the slot
            watch   = (result, index) => result.settlement?.then(answer => {
                if (me.startFleetBatch === batch && answer.isCurrent()) {
                    results[index] = answer;
                    me.renderStartSummary(FleetStartPlan.summarizeFleetStart(plan, results))
                }
            });

        me.renderStartSummary(null);

        for (const wave of FleetStartPlan.waves(plan.eligible, me.startFleetWaveSize)) {
            if (results.length > 0 && !current()) break;

            // the wave's seats are read again as they are now: one whose own Start left meanwhile, or
            // that came up, is not sent twice — the batch's intent for it is superseded by what happened
            const superseded = new Map(FleetStartPlan.partitionFleetStart(wave).excluded.map(({record, reason}) => [record, reason]));

            const answers = await Promise.all(wave.map(record => superseded.has(record)
                ? {accepted: false, action: 'start', method: null, ok: false, status: 'superseded', controlReason: FleetLifecycleIntentAdapter.createControlReason('start', 'superseded', superseded.get(record))}
                : me.requestFleetLifecycle({action: 'start', agentId: record.agentId}, record)
            ));

            answers.forEach((answer, offset) => watch(answer, results.length + offset));
            results.push(...answers);

            if (results.length < plan.eligible.length && current()) {
                me.renderStartSummary(FleetStartPlan.summarizeFleetStart(plan, results))
            }
        }

        const summary = FleetStartPlan.summarizeFleetStart(plan, results);

        if (current()) {
            me.renderStartSummary(summary)
        }

        await me.refreshRosterOnSettle(Promise.resolve(true), () => results.some(FleetLifecycleIntentAdapter.rosterMayRead));

        return summary
    }

    /**
     * @summary The fleet-wide stop is a two-press. The first press arms it: the summary slot
     * shows the plan — the up, eligible fleet by name and every exclusion with its reason — the chip
     * becomes the second press, and nothing is sent; the second press, inside the armed window, sends
     * one stop intent per planned seat through the card's own verb and the summary reads
     * `N stopped · M excluded`. The second press sends only for the Fleet and the plan the first press
     * showed: a replaced target, a retired roster, a settled roster whose plan differs, a seat whose
     * own action is pending, the window's end or a fleet start take the first press back with nothing
     * sent; a press during a running stop batch joins it.
     * @returns {Object|Promise<Object>|null} The plan on the first press, the batch summary on the
     * second, `null` when the second press found its confirmation stale and withdrew it.
     */
    onStopFleet() {
        const me = this;

        if (me.stopFleetPromise) return me.stopFleetPromise;

        if (!me.stopFleetArmed) {
            const plan = FleetStartPlan.partitionFleetStop(me.getRosterRecords());

            me.stopFleetArmed    = {plan, profileId: me.bridgeProfileId, store: me.resolveFleetRosterStore()};
            me.stopFleetArmTimer = setTimeout(() => me.disarmStopFleet(), me.stopFleetArmMs);
            me.renderSummarySlot(FleetStartPlan.renderFleetStopPlan(plan));
            me.renderFleetButton();

            return plan
        }

        // the confirmation is re-read against the Fleet as it is now, before anything is sent
        const fresh = FleetStartPlan.partitionFleetStop(me.getRosterRecords());

        if (!me.isStopArmCurrent(me.stopFleetArmed, fresh)) {
            me.disarmStopFleet();
            return null
        }

        clearTimeout(me.stopFleetArmTimer);
        me.stopFleetArmTimer = null;
        me.stopFleetArmed    = null;
        me.stopFleetPromise  = me.executeStopFleetBatch(fresh).finally(() => {
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
