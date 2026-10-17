import Base          from '../../../node_modules/neo.mjs/src/core/Base.mjs';
import TargetBinding from './TargetBinding.mjs';

/**
 * @summary The Fleet cockpit's recent-turns reader: the shown seat's newest public turn summaries — the Agent
 * Detail's Thought stream — from the fleet server's recency source through the `fleetRecentTurns` verb.
 *
 * It keeps the open-work read's laws: in-flight accounting the liveness cadence reads, a generation fence so
 * the latest read wins, a typed unavailable envelope when the verb is absent or the read throws (never an
 * empty stream), and target binding — a read through another profile's bridge first retires the held answer
 * ({@link AgentOS.util.TargetBinding#retireRecentTurns}). The seat is the second binding: the reader holds
 * the seat the detail shows, a read without one asks nothing, an answer lands only while that seat is still
 * the one asked for, and the envelope carries its `target`, so the pane shows nothing asked for another seat.
 *
 * The cockpit controller creates and destroys its one instance (the operator inbox's shape) and relays the
 * cadence's and the landing's calls; the reader holds the state and pushes every change of the held answer
 * to the live detail pane ({@link #project}).
 * @class AgentOS.util.RecentTurnsRead
 * @extends Neo.core.Base
 */
class RecentTurnsRead extends Base {
    /**
     * The page the cockpit asks for: the pane shows a seat's newest turns and never pages — drilling into a
     * session is the Memories pane's.
     * @type {Number}
     */
    static LIMIT = 20

    static config = {
        /**
         * @member {String} className='AgentOS.util.RecentTurnsRead'
         * @protected
         */
        className: 'AgentOS.util.RecentTurnsRead',
        /**
         * The cockpit controller creating and destroying this reader; the bridge and the live pane are
         * reached through it.
         * @member {Object|null} owner=null
         */
        owner: null
    }

    /**
     * The read fence: only the newest read admits.
     * @member {Number} generation=0
     * @protected
     */
    generation = 0
    /**
     * The profile whose bridge answered the held snapshot.
     * @member {String|null} profileId=null
     */
    profileId = null
    /**
     * Unsettled wire reads, the liveness cadence's in-flight count.
     * @member {Number} readInFlight=0
     */
    readInFlight = 0
    /**
     * The held answer, or `null` while none landed.
     * @member {Object|null} snapshot=null
     */
    snapshot = null
    /**
     * The seat the stream reads for, the shown resident's `@githubUsername`; `null` while no seat with a
     * mailbox identity is shown, and then the cadence asks nothing.
     * @member {String|null} target=null
     */
    target = null

    /**
     * @summary The envelope that stands for an answer the plane did not give, in the Brain's own shape.
     * @param {String} reason Why there is no answer.
     * @param {String} coverage `not-wired` when the bridge has no recent-turns verb (an expected absence the
     * pane names as what it awaits), `unanswered` when the read threw (the connection's story, which the
     * spine banner tells).
     * @param {String|null} target The seat the read was for.
     * @returns {Object} `{capability: {state: 'unavailable', reason, capturedAt}, coverage, viewer, target, page, turns, count, nextCursor, memorySharing}`.
     */
    static unavailable(reason, coverage, target) {
        return {
            capability   : {state: 'unavailable', reason, capturedAt: null},
            coverage,
            viewer       : null,
            target       : target ?? null,
            page         : {limit: RecentTurnsRead.LIMIT, before: null},
            turns        : [],
            count        : 0,
            nextCursor   : null,
            memorySharing: null
        }
    }

    /**
     * @summary Push the held answer to the live detail pane, whatever phase it is in (docked, vesseled, in
     * flight home); a pane not yet materialized reads the answer from its seeds instead.
     */
    project() {
        this.owner?.component?.getAgentDetailPane?.()?.set({recentTurns: this.snapshot})
    }

    /**
     * @summary Read the shown seat's recent turns through the owner's bridge and admit the answer if no
     * newer read started and the seat is still the one shown meanwhile. `agentIdentity` retargets the read
     * (a newly shown seat); without it the read re-asks for the seat held (the cadence), and with no seat
     * held it asks nothing.
     * @param {Object} [params] `{agentIdentity}`
     * @returns {Promise<Object|null>} The envelope, or `null` when no seat is shown.
     */
    async read(params = {}) {
        const
            me         = this,
            {owner}    = me,
            bridge     = owner?.bridge,
            profileId  = bridge?.profileId ?? null,
            generation = ++me.generation;

        TargetBinding.retireRecentTurns(me, {profileId}) && me.project();

        if (params.agentIdentity) {
            me.target = params.agentIdentity
        }

        const {target} = me;

        if (!target) {
            return null
        }

        let snapshot;

        me.readInFlight++;

        try {
            if (typeof bridge?.fleetRecentTurns !== 'function') {
                snapshot = RecentTurnsRead.unavailable('fleet recent-turns verb not wired', 'not-wired', target)
            } else {
                try {
                    snapshot = await bridge.fleetRecentTurns({agentIdentity: target, limit: RecentTurnsRead.LIMIT})
                } catch (error) {
                    snapshot = RecentTurnsRead.unavailable('fleet recent-turns read failed', 'unanswered', target)
                }
            }
        } finally {
            me.readInFlight--
        }

        if (generation === me.generation && !me.isDestroyed && !owner?.isDestroyed && me.target === target) {
            me.admit(snapshot, profileId)
        }

        return snapshot
    }

    /**
     * @summary Admit one answer as the held snapshot, with the profile that answered it. Advancing the fence
     * prevents a read already in flight from replacing it.
     * @param {Object|null} snapshot One `fleetRecentTurns` envelope or the unobserved state.
     * @param {String|null} profileId The profile the answering bridge is bound to.
     */
    admit(snapshot, profileId) {
        const me = this;

        me.generation++;
        me.snapshot  = snapshot;
        me.profileId = profileId;

        me.project()
    }

    /**
     * @summary Drop the held stream and its seat — TERMINAL for in-flight reads: the fence bump makes a read
     * landing after the clear unwanted, so no seat's turns wait under the next record. Nothing held and no
     * seat asked for is nothing to clear.
     * @returns {Boolean} whether anything was dropped
     */
    clear() {
        const me = this;

        if (!me.snapshot && !me.target) {
            return false
        }

        me.generation++;
        me.snapshot  = null;
        me.profileId = null;
        me.target    = null;

        me.project();

        return true
    }

    /**
     * @summary A reply still on its way finds no fence of its own.
     * @param {...*} args
     */
    destroy(...args) {
        this.generation++;
        super.destroy(...args)
    }
}

export default Neo.setupClass(RecentTurnsRead);
