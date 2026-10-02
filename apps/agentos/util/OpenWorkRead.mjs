import Base          from '../../../node_modules/neo.mjs/src/core/Base.mjs';
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
 * `openWorkSnapshot`, `openWorkProfileId`); this class reads and writes it.
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
     * @returns {Object} `{state: 'unavailable', observedAt, coverage, reason, seats, awaitingMerge}`.
     */
    static unavailable(reason) {
        return {state: 'unavailable', observedAt: null, coverage: 'unavailable', reason, seats: {}, awaitingMerge: []}
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

        TargetBinding.retireOpenWork(owner, {profileId});
        owner.openWorkReadInFlight++;

        try {
            if (typeof bridge?.fleetOpenWork !== 'function') {
                snapshot = OpenWorkRead.unavailable('fleet open-work verb not wired')
            } else {
                try {
                    snapshot = await bridge.fleetOpenWork(params)
                } catch (error) {
                    snapshot = OpenWorkRead.unavailable('fleet open-work read failed')
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
        owner.openWorkProfileId = profileId
    }
}

export default Neo.setupClass(OpenWorkRead);
