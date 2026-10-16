import Base          from '../../../node_modules/neo.mjs/src/core/Base.mjs';
import TargetBinding from './TargetBinding.mjs';

/**
 * @summary The Fleet cockpit's recent-turns read: the shown seat's newest public turn summaries — the Agent
 * Detail's Thought stream — from the fleet server's recency source through the `fleetRecentTurns` verb.
 *
 * It keeps the open-work read's laws: in-flight accounting the liveness cadence reads, a generation fence so
 * the latest read wins, a typed unavailable envelope when the verb is absent or the read throws (never an
 * empty stream), and target binding — a read through another profile's bridge first retires the held answer
 * ({@link AgentOS.util.TargetBinding#retireRecentTurns}). The seat is the second binding: the owner holds
 * the seat the detail shows, a read without one asks nothing, an answer lands only while that seat is still
 * the one asked for, and the envelope carries its `target`, so the pane shows nothing asked for another seat.
 *
 * The cockpit controller owns the state (`recentTurnsReadGeneration`, `recentTurnsReadInFlight`,
 * `recentTurnsSnapshot`, `recentTurnsProfileId`, `recentTurnsTarget`); this class reads and writes it, and
 * pushes every change of the held answer to the live detail pane ({@link #project}).
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
        className: 'AgentOS.util.RecentTurnsRead'
    }

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
     * @param {AgentOS.view.fleet.cockpit.Controller} owner The cockpit controller.
     */
    static project(owner) {
        owner.component?.getAgentDetailPane?.()?.set({recentTurns: owner.recentTurnsSnapshot})
    }

    /**
     * @summary Read the shown seat's recent turns through the owner's bridge and admit the answer if no
     * newer read started and the seat is still the one shown meanwhile. `agentIdentity` retargets the read
     * (a newly shown seat); without it the read re-asks for the seat held (the cadence), and with no seat
     * held it asks nothing.
     * @param {AgentOS.view.fleet.cockpit.Controller} owner The cockpit controller.
     * @param {Object} [params] `{agentIdentity}`
     * @returns {Promise<Object|null>} The envelope, or `null` when no seat is shown.
     */
    static async load(owner, params = {}) {
        const
            {bridge}   = owner,
            profileId  = bridge?.profileId ?? null,
            generation = ++owner.recentTurnsReadGeneration;

        TargetBinding.retireRecentTurns(owner, {profileId}) && RecentTurnsRead.project(owner);

        if (params.agentIdentity) {
            owner.recentTurnsTarget = params.agentIdentity
        }

        const target = owner.recentTurnsTarget;

        if (!target) {
            return null
        }

        let snapshot;

        owner.recentTurnsReadInFlight++;

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
            owner.recentTurnsReadInFlight--
        }

        if (generation === owner.recentTurnsReadGeneration && !owner.isDestroyed && owner.recentTurnsTarget === target) {
            RecentTurnsRead.admit(owner, snapshot, profileId)
        }

        return snapshot
    }

    /**
     * @summary Admit one answer as the owner-held snapshot, with the profile that answered it. Advancing the
     * read generation prevents a read already in flight from replacing it.
     * @param {AgentOS.view.fleet.cockpit.Controller} owner The cockpit controller.
     * @param {Object|null} snapshot One `fleetRecentTurns` envelope or the unobserved state.
     * @param {String|null} profileId The profile the answering bridge is bound to.
     */
    static admit(owner, snapshot, profileId) {
        owner.recentTurnsReadGeneration++;
        owner.recentTurnsSnapshot  = snapshot;
        owner.recentTurnsProfileId = profileId;

        RecentTurnsRead.project(owner)
    }

    /**
     * @summary Drop the held stream and its seat — TERMINAL for in-flight reads: the fence bump makes a read
     * landing after the clear unwanted, so no seat's turns wait under the next record. Nothing held and no
     * seat asked for is nothing to clear.
     * @param {AgentOS.view.fleet.cockpit.Controller} owner The cockpit controller.
     * @returns {Boolean} whether anything was dropped
     */
    static clear(owner) {
        if (!owner.recentTurnsSnapshot && !owner.recentTurnsTarget) {
            return false
        }

        owner.recentTurnsReadGeneration++;
        owner.recentTurnsSnapshot  = null;
        owner.recentTurnsProfileId = null;
        owner.recentTurnsTarget    = null;

        RecentTurnsRead.project(owner);

        return true
    }
}

export default Neo.setupClass(RecentTurnsRead);
