import Base from '../../../node_modules/neo.mjs/src/core/Base.mjs';

/**
 * @module apps/agentos/util/PlaneCredentialCheck
 * @summary Asks the shell, once per failed roster-read episode, whether the plane still admits the PAT
 * this shell launched with — lifted beside the cockpit's liveness owner the way `BrainHealthRead` is.
 *
 * A PAT that expires mid-session makes every roster read fail upstream, and the read cannot tell why:
 * the plane's refusal reaches the cockpit as a sanitized failure. Only the shell holds the stored
 * credential and the probe that names the cause, so the answer it gives becomes `planeCause`, which
 * the spine banner speaks with the connect card's words and Connect. A read that answers again ends
 * the episode and clears the cause.
 */

/**
 * The roster read failures a refused credential can produce. A timeout or an unreachable transport is
 * a different story with its own words.
 * @type {String[]}
 */
const askingStates = Object.freeze(['failed-upstream', 'refused']);

class PlaneCredentialCheck extends Base {
    static config = {
        /**
         * @member {String} className='AgentOS.util.PlaneCredentialCheck'
         * @protected
         */
        className: 'AgentOS.util.PlaneCredentialCheck'
    }

    /**
     * @summary Asks once for a failed roster read's episode, then publishes the shell's answer.
     * @param {AgentOS.view.fleet.cockpit.LivenessController} owner The liveness owner.
     * @param {String|null} connectionState The failed read's `fleetConnectionState`.
     * @returns {Promise<void>}
     */
    static async ask(owner, connectionState) {
        if (!askingStates.includes(connectionState) || owner.planeCheckEpisode) return;

        const episode = owner.planeCheckEpisode = Symbol('planeCheckEpisode');

        const reply = await Promise.resolve(
            Neo.main?.addon?.ShellPlane?.verifyPlane({windowId: owner.component.windowId})
        ).catch(() => null);

        // Only the episode that asked may answer: a read that answered since ended it, and a failure after
        // that opened another episode, whose own answer is the newer one.
        if (owner.isDestroyed || owner.planeCheckEpisode !== episode) return;

        owner.component.getStateProvider()?.setData('planeCause', typeof reply?.cause === 'string' ? reply.cause : null)
    }

    /**
     * @summary Ends the episode on a roster read that answered, and clears its cause.
     * @param {AgentOS.view.fleet.cockpit.LivenessController} owner The liveness owner.
     */
    static settle(owner) {
        owner.planeCheckEpisode = null;
        owner.component.getStateProvider()?.setData('planeCause', null)
    }
}

export default Neo.setupClass(PlaneCredentialCheck);
