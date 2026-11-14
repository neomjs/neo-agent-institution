import Base       from '../../../node_modules/neo.mjs/src/core/Base.mjs';
import ViewerTime from './ViewerTime.mjs';

/**
 * Each cockpit owner's rotation read ({@link AgentOS.util.SessionRotation#load}): its fence and its last answer.
 * @type {WeakMap<Object, {generation: Number, snapshot: Object|null}>}
 */
const reads = new WeakMap();

/**
 * @summary The words of a seat's session rotation: one formatter for the roster card and the journal.
 *
 * A rotation is the Fleet's decision on the seat's newest sunset receipt, `fleetWakeRoutes`
 * `seats[].rotation` or a `session-rotation` event's payload (the same fields), read as the producer
 * answered it. Only the four decision states earn words. `none`, `unobserved` and `unknown` earn none:
 * a seat that never rotated is quiet, and the Wake pane names the axis's health.
 * @class AgentOS.util.SessionRotation
 * @extends Neo.core.Base
 */
class SessionRotation extends Base {
    static config = {
        /**
         * @member {String} className='AgentOS.util.SessionRotation'
         * @protected
         */
        className: 'AgentOS.util.SessionRotation'
    }

    /**
     * @summary Writes each seat's rotation from a `fleetWakeRoutes` answer onto its roster record, as the Fleet
     * answered it, so the card reads it with the rest of the row. A seat the answer omits keeps its record's
     * rotation, and so does every seat of an older Fleet whose seats carry no `rotation`. An unreadable answer
     * writes nothing.
     * @param {Neo.data.Store|null} store The roster store (`FleetAgent` records keyed by `agentId`)
     * @param {Object|null} snapshot The `fleetWakeRoutes` answer `{capability, seats}`
     */
    static apply(store, snapshot) {
        if (!store || snapshot?.capability?.state === 'unavailable' || !Array.isArray(snapshot?.seats)) return;

        snapshot.seats.forEach(({agentId, rotation}) => {
            const record = agentId ? store.get(agentId) ?? store.allItems?.get(agentId) : null;

            record && rotation !== undefined && record.set({rotation})
        })
    }

    /**
     * @summary The cards' own wake-routes read: the seats' rotations land on their roster records
     * ({@link #apply}). It never fills the Wake pane, where reading the routes stays the operator's explicit
     * first act. An unwired verb or a failed read changes nothing, and an older read landing after a newer
     * one is dropped.
     * @param {AgentOS.view.fleet.cockpit.Controller} owner The cockpit owner: its `bridge` and its roster store.
     * @returns {Promise<void>}
     */
    static async load(owner) {
        const
            state      = reads.get(owner) ?? {generation: 0, snapshot: null},
            {bridge}   = owner,
            generation = ++state.generation;

        reads.set(owner, state);

        if (typeof bridge?.fleetWakeRoutes !== 'function') return;

        let snapshot;

        try {
            snapshot = await bridge.fleetWakeRoutes({})
        } catch (error) {
            return
        }

        if (generation === state.generation && !owner.isDestroyed) {
            state.snapshot = snapshot;
            SessionRotation.apply(owner.resolveFleetRosterStore?.(), snapshot)
        }
    }

    /**
     * @summary Re-applies the owner's last rotation answer, if one landed: for roster records that arrived after it.
     * @param {AgentOS.view.fleet.cockpit.Controller} owner
     */
    static reapply(owner) {
        const snapshot = reads.get(owner)?.snapshot;

        snapshot && SessionRotation.apply(owner.resolveFleetRosterStore?.(), snapshot)
    }

    /**
     * @summary Words for one rotation decision, or `null` when it earns none.
     *
     * - `completed`: the fresh session registered its wake route, so the old one is retired. The words
     *   name both sessions and raise nothing: "rotated 21:17 · from 1a2b3c4d to 5e6f7a8b".
     * - `requested`: in flight; the old session still owns the seat: "rotating since 21:15".
     * - `refused`: the plane's reason and when the seat may rotate again:
     *   "rotation refused · minimum-interval · next 22:30".
     * - `incomplete`: no fresh session arrived. It is reported, and nothing is stopped:
     *   "rotation incomplete · no-fresh-session".
     *
     * Times are viewer time. The title keeps the full session ids and the receipt.
     * @param {Object|null} rotation `{state, reason, receiptId, decidedAt, oldSessionId, newSessionId, nextEligibleAt}`
     * @param {Object} [options={}] {@link AgentOS.util.ViewerTime#formatViewerTime} options (`now`, `locale`, `timeZone`)
     * @returns {{state: String, text: String, title: String}|null}
     */
    static describe(rotation, options = {}) {
        const
            state   = rotation?.state,
            decided = ViewerTime.formatViewerTime(rotation?.decidedAt, options),
            short   = sessionId => typeof sessionId === 'string' && sessionId ? sessionId.slice(0, 8) : 'unknown';

        let text;

        switch (state) {
            case 'completed':
                text = `rotated${decided ? ` ${decided.text}` : ''} · from ${short(rotation.oldSessionId)} to ${short(rotation.newSessionId)}`;
                break
            case 'requested':
                text = decided ? `rotating since ${decided.text}` : 'rotating';
                break
            case 'refused': {
                const next = ViewerTime.formatViewerTime(rotation.nextEligibleAt, options);

                text = ['rotation refused', rotation.reason, next && `next ${next.text}`].filter(Boolean).join(' · ');
                break
            }
            case 'incomplete':
                text = `rotation incomplete · ${rotation.reason || 'no fresh session'}`;
                break
            default:
                return null
        }

        return {
            state,
            text,
            title: [text, decided?.title, rotation.oldSessionId && `from ${rotation.oldSessionId}`,
                rotation.newSessionId && `to ${rotation.newSessionId}`, rotation.receiptId && `receipt ${rotation.receiptId}`]
                .filter(Boolean).join(' · ')
        }
    }
}

export default Neo.setupClass(SessionRotation);
