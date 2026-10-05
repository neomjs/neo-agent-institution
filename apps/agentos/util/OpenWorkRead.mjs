import Base          from '../../../node_modules/neo.mjs/src/core/Base.mjs';
import OpenWorkSeat  from './OpenWorkSeat.mjs';
import TargetBinding from './TargetBinding.mjs';

/**
 * @summary The Fleet cockpit's open-work read: each seat's open pull requests and the ones awaiting the
 * operator's merge, from the fleet server's open-work producer through the `fleetOpenWork` verb.
 *
 * It keeps the tasks read's laws: in-flight accounting the liveness cadence reads, a generation fence so
 * the latest read wins, and a typed unavailable envelope when the verb is absent or the read throws,
 * never an empty answer. It adds target binding: a read through another profile's bridge first retires
 * the held answer ({@link AgentOS.util.TargetBinding#retireOpenWork}), so one instance's open work never
 * stands under another's name.
 *
 * The cockpit controller owns the state (`openWorkReadGeneration`, `openWorkReadInFlight`,
 * `openWorkSnapshot`, `openWorkProfileId`); this class reads and writes it. Every change of the held
 * answer is projected onto the surfaces that show it ({@link #project}).
 * @class AgentOS.util.OpenWorkRead
 * @extends Neo.core.Base
 */
class OpenWorkRead extends Base {
    static config = {
        /**
         * @member {String} className='AgentOS.util.OpenWorkRead'
         * @protected
         */
        className: 'AgentOS.util.OpenWorkRead'
    }

    /**
     * @summary The envelope that stands for an answer the plane did not give.
     * @param {String} reason Why there is no answer.
     * @param {String} [coverage='unavailable'] `not-wired` when the bridge has no open-work verb (an
     * expected absence), `unanswered` when the read threw (the connection's story, which the spine
     * banner tells): the surfaces stay silent about both, and name only a producer's own `unavailable`.
     * @returns {Object} `{state: 'unavailable', observedAt, coverage, reason, seats, awaitingMerge}`.
     */
    static unavailable(reason, coverage = 'unavailable') {
        return {state: 'unavailable', observedAt: null, coverage, reason, seats: {}, awaitingMerge: []}
    }

    /**
     * @summary The merge queue's rows from one answer, keyed `<repo>#<number>`, each with its producer's
     * title when the row carries one. An unavailable answer has none.
     * @param {Object|null} snapshot One `fleetOpenWork` envelope, or `null` while unanswered.
     * @returns {Object[]} Data for {@link AgentOS.store.FleetAwaitingMerge}.
     */
    static mergeRows(snapshot) {
        if (!snapshot || snapshot.state === 'unavailable') return [];

        return (snapshot.awaitingMerge ?? []).map(({ci, draft, mergeable, number, observedAt, repo, stale, title}) => (
            {id: `${repo}#${number}`, ci, draft, mergeable, number, observedAt, repo, stale, title}
        ))
    }

    /**
     * @summary Project the held answer onto the surfaces that show it: the provider's `openWork` block
     * (the read's state for the fleet head), the provider's merge queue Store, and each roster record's
     * held open work ({@link AgentOS.util.OpenWorkSeat#summarize}). Every record, the ones a view filter
     * hides included, so a card that reappears never shows an older answer. The roster's last live
     * snapshot is re-stamped too, so a source-precedence re-apply carries this answer and not the one
     * the roster landed with. A bare mount without the provider's stores projects what it can.
     * @param {AgentOS.view.fleet.cockpit.Controller} owner The cockpit controller.
     */
    static project(owner) {
        const
            snapshot = owner.openWorkSnapshot,
            provider = owner.component?.getStateProvider?.(),
            store    = name => {
                try {
                    return provider?.getStore(name) ?? null
                } catch {
                    return null
                }
            },
            queue    = store('fleetAwaitingMerge'),
            roster   = store('fleetRoster');

        provider?.setData('openWork', {
            coverage  : snapshot?.coverage   ?? null,
            observedAt: snapshot?.observedAt ?? null,
            reason    : snapshot?.reason     ?? null,
            state     : snapshot?.state      ?? null
        });

        queue && (queue.data = OpenWorkRead.mergeRows(snapshot));

        roster && (roster.allItems ?? roster).items.forEach(record => {
            record.set(OpenWorkRead.seatOpenWork(owner, record.githubUsername))
        });

        if (Array.isArray(owner.lastLiveRows)) {
            owner.lastLiveRows = owner.lastLiveRows.map(row => ({...row, ...OpenWorkRead.seatOpenWork(owner, row.githubUsername)}))
        }
    }

    /**
     * @summary One seat's open-work fields for its roster record, from the owner's held answer, by the
     * seat's GitHub login: the card chip's summary ({@link AgentOS.util.OpenWorkSeat#summarize}) and the
     * Agent Detail's rows ({@link AgentOS.util.OpenWorkSeat#held}). One answer feeds both in one write.
     * @param {AgentOS.view.fleet.cockpit.Controller} owner The cockpit controller.
     * @param {String|null} githubUsername The seat's login; none claims nothing.
     * @returns {{openWork: Object|null, openWorkHeld: Object|null}}
     */
    static seatOpenWork(owner, githubUsername) {
        const seat = githubUsername ? `@${githubUsername}` : null;

        return {
            openWork    : OpenWorkSeat.summarize(owner.openWorkSnapshot, seat),
            openWorkHeld: OpenWorkSeat.held(owner.openWorkSnapshot, seat)
        }
    }

    /**
     * @summary Read the open work through the owner's bridge and admit the answer if no newer read
     * started meanwhile.
     * @param {AgentOS.view.fleet.cockpit.Controller} owner The cockpit controller.
     * @param {Object} [params] `{seat}` narrows the answer to one seat.
     * @returns {Promise<Object>} The envelope `{state, observedAt, coverage, reason, seats, awaitingMerge}`.
     */
    static async load(owner, params = {}) {
        const
            {bridge}   = owner,
            profileId  = bridge?.profileId ?? null,
            generation = ++owner.openWorkReadGeneration;

        let snapshot;

        TargetBinding.retireOpenWork(owner, {profileId}) && OpenWorkRead.project(owner);
        owner.openWorkReadInFlight++;

        try {
            if (typeof bridge?.fleetOpenWork !== 'function') {
                snapshot = OpenWorkRead.unavailable('fleet open-work verb not wired', 'not-wired')
            } else {
                try {
                    snapshot = await bridge.fleetOpenWork(params)
                } catch (error) {
                    snapshot = OpenWorkRead.unavailable('fleet open-work read failed', 'unanswered')
                }
            }
        } finally {
            owner.openWorkReadInFlight--
        }

        if (generation === owner.openWorkReadGeneration && !owner.isDestroyed) {
            OpenWorkRead.admit(owner, snapshot, profileId)
        }

        return snapshot
    }

    /**
     * @summary Admit one answer as the owner-held snapshot, with the profile that answered it. Advancing
     * the read generation prevents a read already in flight from replacing it.
     * @param {AgentOS.view.fleet.cockpit.Controller} owner The cockpit controller.
     * @param {Object|null} snapshot One `fleetOpenWork` envelope or the unobserved state.
     * @param {String|null} profileId The profile the answering bridge is bound to.
     */
    static admit(owner, snapshot, profileId) {
        owner.openWorkReadGeneration++;
        owner.openWorkSnapshot  = snapshot;
        owner.openWorkProfileId = profileId;

        OpenWorkRead.project(owner)
    }
}

export default Neo.setupClass(OpenWorkRead);
