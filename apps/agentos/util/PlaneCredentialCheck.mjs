import Base from '../../../node_modules/neo.mjs/src/core/Base.mjs';

/**
 * @module apps/agentos/util/PlaneCredentialCheck
 * @summary Asks the shell whether the plane still admits the PAT this shell launched with, and publishes the
 * answer as `planeCause` — lifted beside the cockpit's liveness owner the way `BrainHealthRead` is.
 *
 * Only the shell holds the stored credential and the probe that names the cause, so its answer is the one
 * writer of `planeCause`, which the spine banner speaks with the connect card's words and Connect. A PAT the
 * plane stops admitting mid-session rarely fails the roster read itself: the roster resolves and its plane
 * presence read degrades, and a PAT the plane now admits as another account fails no read at all. So the
 * shell is asked when an episode opens (a roster read that fails upstream, or an answer whose presence read
 * is degraded), when a wired read ends it, and on a periodic re-check from the liveness tick. A read that
 * answers proves the transport, never the credential, so it asks rather than clears: a restored PAT clears
 * on the shell's answer, not on the next re-check.
 *
 * The state lives on the owner as `planeCheck`: `{episode, question, at}` — the open episode's token, the
 * latest question's token (only its answer publishes) and when the shell was last asked (epoch ms).
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
     * @summary Asks once for a failed roster read's episode.
     * @param {AgentOS.view.fleet.cockpit.LivenessController} owner The liveness owner.
     * @param {String|null} connectionState The failed read's `fleetConnectionState`.
     * @returns {Promise<void>}
     */
    static async ask(owner, connectionState) {
        if (!askingStates.includes(connectionState)) return;

        return PlaneCredentialCheck.openEpisode(owner)
    }

    /**
     * @summary Reads an admitted roster answer: a degraded presence read opens an episode and asks; a wired
     * one ends an open episode and asks once more, so the shell's answer clears a cause the recovery
     * resolved, and the next failure asks again.
     * @param {AgentOS.view.fleet.cockpit.LivenessController} owner The liveness owner.
     * @param {Object|null} capabilities The answer's capabilities envelope.
     * @returns {Promise<void>}
     */
    static async observe(owner, capabilities) {
        if (capabilities?.presence?.state === 'degraded') {
            return PlaneCredentialCheck.openEpisode(owner)
        }

        const state = PlaneCredentialCheck.stateOf(owner);

        if (!state.episode) return;

        state.episode = null;

        return PlaneCredentialCheck.query(owner, Date.now())
    }

    /**
     * @summary The liveness tick's periodic re-check, due once per the cockpit's
     * `planeCredentialRecheckInterval`: finds a revoked PAT once the plane's 300 s validation cache expires
     * (even when an episode opened before expiry or every read stays wired) and a PAT the plane now admits as
     * another account. A missing or non-positive interval disables it.
     * @param {AgentOS.view.fleet.cockpit.LivenessController} owner The liveness owner.
     * @param {Number} now Epoch ms of the tick.
     * @returns {Promise<void>}
     */
    static async recheck(owner, now) {
        const interval = owner.component.planeCredentialRecheckInterval;

        if (!(interval > 0) || now - (PlaneCredentialCheck.stateOf(owner).at ?? 0) < interval) return;

        return PlaneCredentialCheck.query(owner, now)
    }

    /**
     * @summary Opens an episode and asks, unless one is already open.
     * @param {AgentOS.view.fleet.cockpit.LivenessController} owner The liveness owner.
     * @returns {Promise<void>}
     * @protected
     */
    static async openEpisode(owner) {
        const state = PlaneCredentialCheck.stateOf(owner);

        if (state.episode) return;

        state.episode = Symbol('planeCheckEpisode');

        return PlaneCredentialCheck.query(owner, Date.now())
    }

    /**
     * @summary Asks the shell and publishes its answer, unless a newer question was asked meanwhile.
     * @param {AgentOS.view.fleet.cockpit.LivenessController} owner The liveness owner.
     * @param {Number} now Epoch ms the question is asked at.
     * @returns {Promise<void>}
     * @protected
     */
    static async query(owner, now) {
        const
            state    = PlaneCredentialCheck.stateOf(owner),
            question = state.question = Symbol('planeCheckQuestion');

        state.at = now;

        const reply = await Promise.resolve(
            Neo.main?.addon?.ShellPlane?.verifyPlane({windowId: owner.component.windowId})
        ).catch(() => null);

        if (owner.isDestroyed || state.question !== question) return;

        owner.component.getStateProvider()?.setData('planeCause', typeof reply?.cause === 'string' ? reply.cause : null)
    }

    /**
     * @summary The owner's check state, created on first use.
     * @param {AgentOS.view.fleet.cockpit.LivenessController} owner The liveness owner.
     * @returns {{episode: Symbol|null, question: Symbol|null, at: Number|null}}
     * @protected
     */
    static stateOf(owner) {
        return owner.planeCheck ??= {episode: null, question: null, at: null}
    }
}

export default Neo.setupClass(PlaneCredentialCheck);
