import Base from '../../../node_modules/neo.mjs/src/core/Base.mjs';

/**
 * @module apps/agentos/util/BrainHealthRead
 * @summary The daemon surface's read owner over the shell's `brainHealth` lifecycle answer, lifted
 * beside the cockpit's liveness owner (which holds the size bar) the way `DeploymentStateRead` is.
 * Pull, never push, on the owner's fences and capacity bound: a fault arriving after mount still
 * surfaces and a recovery still clears. A transport failure reaches the apply step as `null` and
 * moves nothing — only the lifecycle owner's own answer moves this surface.
 */

/**
 * The recognized Brain daemon states — anything else (a transport envelope, a rejection mapped to
 * null, a malformed payload) renders NOTHING rather than a fabricated verdict.
 * @type {String[]}
 */
const brainHealthStates = Object.freeze(['running', 'degraded', 'stopped']);

class BrainHealthRead extends Base {
    static config = {
        /**
         * @member {String} className='AgentOS.util.BrainHealthRead'
         * @protected
         */
        className: 'AgentOS.util.BrainHealthRead'
    }

    /**
     * @summary Apply one Brain-health wire answer onto the provider-held daemon surface. An
     * unrecognized state renders NOTHING (transport trouble is the transport surface's story) —
     * and never ERASES a last-known fault. The shell transport fact is its own truth, valid on
     * payloads whose daemon state never validates and dropped when the pull failed.
     * @param {AgentOS.view.fleet.cockpit.LivenessController} owner The liveness owner.
     * @param {Object|null} response The lifecycle owner's `{state, cause, transport?}` payload.
     */
    static apply(owner, response) {
        const
            provider = owner.component.getStateProvider(),
            state    = brainHealthStates.includes(response?.state) ? response.state : null;

        if (owner.isDestroyed || !provider) return;

        provider.setData('shellTransport', Neo.isObject(response?.transport) ? response.transport : null);

        if (!state) {
            return
        }

        const cause = state !== 'running' ? response.cause : null;

        provider.setData({
            daemonCause         : cause?.source || null,
            daemonState         : state,
            daemonDegradedReason: cause ? (cause.detail || cause.source || null) : null
        })
    }

    /**
     * @summary Pull whole-Brain health from the shell's lifecycle owner once, on the owner's
     * generation fence and in-flight bound. The answer — `null` on failure — reaches the owner's
     * `applyBrainHealth`, which the fixtures and the banner pipeline hold as their handle.
     * @param {AgentOS.view.fleet.cockpit.LivenessController} owner The liveness owner.
     * @returns {Promise<void>}
     */
    static async load(owner) {
        const generation = ++owner.brainHealthReadGeneration;

        try {
            owner.brainHealthReadInFlight++;

            const response = await owner.boundedRead(
                Promise.resolve().then(() => Neo.Main.brainHealth()),
                () => { owner.brainHealthReadInFlight-- }
            );

            if (generation !== owner.brainHealthReadGeneration || owner.isDestroyed) return;

            owner.applyBrainHealth(response)
        } catch (error) {
            if (generation !== owner.brainHealthReadGeneration || owner.isDestroyed) return;

            owner.applyBrainHealth(null)
        }
    }
}

export default Neo.setupClass(BrainHealthRead);
