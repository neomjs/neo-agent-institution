import Container        from '../../../../../node_modules/neo.mjs/src/container/Base.mjs';
import AgentRecentTurns from '../../../store/AgentRecentTurns.mjs';
import ThoughtStreamList from './ThoughtStreamList.mjs';

/**
 * The pane's sentences without rows and its pill's own words: a wired answer holding nothing, a plane
 * whose sharing policy clamps peer turns, a seat the roster names no identity for, and a read the bridge
 * did not answer (the connection's story, which the spine banner tells).
 * @type {Readonly<Object<String, String>>}
 */
const WORDS = Object.freeze({
    clamped   : 'this plane shares no peer turns',
    none      : 'no turns yet',
    noIdentity: 'the roster row names no identity whose turns to read',
    unanswered: 'recent-turns read unanswered'
});

/**
 * @summary The seat's mailbox identity, the key the cockpit's recent-turns read asks for — the roster
 * row's `githubUsername` in `@`-form, the same derivation as the cockpit's selection write.
 * @param {Object|null} record
 * @returns {String|null}
 * @private
 */
const seatIdentity = record => typeof record?.githubUsername === 'string' && record.githubUsername ? `@${record.githubUsername}` : null;

/**
 * @class AgentOS.view.fleet.detail.ThoughtStreamBodyContainer
 * @extends Neo.container.Base
 *
 * @summary The body of the Agent Detail's Thought stream pane: the shown seat's newest public turn
 * summaries as the cockpit's recent-turns read answered them, one list row per
 * {@link AgentOS.model.RecentTurn} newest first (the list joins on the first resident shown), or the
 * sentence a wired answer holding nothing earns. The body renders only an answer for the seat it shows —
 * the envelope's `target` is the seat it was asked for, so one that landed for another seat (a switch
 * mid-read) counts as no answer — and it tells the pane's pill what that answer is
 * ({@link #resolveSource}); the owning detail keeps the pill and the pane's clock.
 */
class ThoughtStreamBodyContainer extends Container {
    /**
     * The pane's words, for the specs that read them.
     * @type {Readonly<Object<String, String>>}
     */
    static WORDS = WORDS

    static config = {
        /**
         * @member {String} className='AgentOS.view.fleet.detail.ThoughtStreamBodyContainer'
         * @protected
         */
        className: 'AgentOS.view.fleet.detail.ThoughtStreamBodyContainer',
        /**
         * @member {String} ntype='fm-detail-thought-stream-body'
         * @protected
         */
        ntype: 'fm-detail-thought-stream-body',
        /**
         * The cockpit's recent-turns answer — one `fleetRecentTurns` envelope `{capability, coverage?,
         * target, turns, memorySharing, …}` — for whichever seat it was asked for, or `null` while none landed.
         * @member {Object|null} answer_=null
         * @reactive
         */
        answer_: null,
        /**
         * The clock (ms) the rows' ages are worded against; `null` reads the live `Date.now()`.
         * @member {Number|null} now_=null
         * @reactive
         */
        now_: null,
        /**
         * The drilled-in resident's roster record ({@link AgentOS.model.FleetAgent}) or a field bag with
         * its keys; `null` renders nothing, so an idle cockpit carries no list.
         * @member {Object|null} record_=null
         * @reactive
         */
        record_: null,
        /**
         * The sentence a wired answer holding nothing renders; the list joins before it on the first
         * resident shown.
         * @member {Object[]} items
         */
        items: [{
            ntype    : 'component',
            cls      : ['fm-detail-turns-none'],
            hidden   : true,
            reference: 'turns-none'
        }]
    }

    /**
     * @summary The answer, if it is for the seat shown. Without a mailbox identity the roster row cannot
     * be asked for at all.
     * @param {Object|null} record The drilled-in FleetAgent record.
     * @param {Object|null} answer The cockpit's recent-turns answer.
     * @returns {Object|null}
     */
    static answerFor(record, answer) {
        const identity = seatIdentity(record);

        return answer && identity && answer.target === identity ? answer : null
    }

    /**
     * @summary What the pane's pill speaks for. No answer for the seat shown resolves to nothing: the
     * honest unobserved with what the pane awaits on the title — the cockpit's own fallback for a bridge
     * without the verb keeps that same pill (a gap named, not a failure). A read the bridge did not answer
     * says so in the pane's words; the producer's own `unavailable` names its reason in words, the detail
     * beside it. A wired answer observes at its `capturedAt`, aged against the pane's TTL like the sibling
     * panes. A seat the roster names no identity for cannot be read, and the pill says that instead of
     * waiting for a verb.
     * @param {Object} record The drilled-in FleetAgent record (never null here).
     * @param {Object|null} answer The cockpit's recent-turns answer.
     * @returns {{descriptor: (Object|null), ledger: (Object|null)}}
     */
    static resolveSource(record, answer) {
        if (!seatIdentity(record)) {
            return {descriptor: {state: 'not observed', reason: WORDS.noIdentity}, ledger: null}
        }

        const own = ThoughtStreamBodyContainer.answerFor(record, answer);

        if (!own || own.coverage === 'not-wired') {
            return {descriptor: null, ledger: null}
        }

        const {capability} = own;

        if (capability?.state === 'wired') {
            return {descriptor: null, ledger: {observedAt: capability.capturedAt ?? null}}
        }

        if (own.coverage === 'unanswered') {
            return {descriptor: {state: 'not observed', reason: WORDS.unanswered}, ledger: null}
        }

        const
            reason = typeof capability?.reason === 'string' && capability.reason ? capability.reason.replace(/-/g, ' ') : 'no reason given',
            detail = typeof capability?.detail === 'string' && capability.detail ? ` · ${capability.detail}` : '';

        return {descriptor: {state: capability?.state ?? 'unavailable', reason: `${reason}${detail}`}, ledger: null}
    }

    /**
     * Triggered after the answer config changed: the rows and the sentence re-render in place.
     * @param {Object|null} value
     * @param {Object|null} oldValue
     * @protected
     */
    afterSetAnswer(value, oldValue) {
        this.isConstructed && this.refresh()
    }

    /**
     * Triggered after the clock changed: the rows re-word their ages.
     * @param {Number|null} value
     * @param {Number|null} oldValue
     * @protected
     */
    afterSetNow(value, oldValue) {
        this.isConstructed && this.refresh()
    }

    /**
     * Triggered after the record config changed: a re-seat onto another resident re-renders.
     * @param {Object|null} value
     * @param {Object|null} oldValue
     * @protected
     */
    afterSetRecord(value, oldValue) {
        this.isConstructed && this.refresh()
    }

    /**
     * @summary Load the seat's newest turns into the list's Store, or say a wired answer holds none — in
     * the plane's words where its policy clamps peer turns; without an answer for the seat shown render
     * nothing, since the pill names the gap, and a body line repeating it would tell the same fact twice
     * per section. No record renders nothing at all.
     */
    refresh() {
        const
            me     = this,
            record = me.record;

        if (!record) {
            return
        }

        const
            answer = ThoughtStreamBodyContainer.answerFor(record, me.answer),
            wired  = answer?.capability?.state === 'wired',
            turns  = wired && Array.isArray(answer.turns) ? answer.turns : [],
            holds  = turns.length > 0,
            none   = me.getReference('turns-none'),
            // built for the first resident shown, so an idle cockpit carries no list
            list   = me.getReference('turn-list') ?? me.insert(0, {
                module   : ThoughtStreamList,
                hidden   : !holds,
                reference: 'turn-list',
                store    : {module: AgentRecentTurns}
            });

        list.store.data = turns;
        list.now        = me.now ?? Date.now();
        list.hidden     = !holds;

        none.hidden = !wired || holds;
        wired && !holds && (none.text = answer.memorySharing?.clamped ? WORDS.clamped : WORDS.none)
    }
}

export default Neo.setupClass(ThoughtStreamBodyContainer);
