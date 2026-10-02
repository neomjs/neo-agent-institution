import Base from '../../../node_modules/neo.mjs/src/core/Base.mjs';

/**
 * @summary The add-agent flow logic — the pure, mount-independent half of the S5 define-agent
 * surface: payload validation, the fail-closed bridge round-trip, and the canonical
 * readback guard, expressed as one typed outcome vocabulary.
 *
 * The flow's honest-lifecycle contract (design SSOT Lane D1): a submission is only ever in one of
 * the states below, the **readback is the sole success truth** — the roster renders from
 * the Brain's canonical response, never from an optimistic insert — and an absent bridge is a
 * first-class `gated` outcome — disabled-with-reason at the surface, never a fake success and
 * never browser-side persistence.
 *
 * Credential boundary (the fleet credential matrix): a direct-browser bridge receives the PAT in
 * the submit payload, while a shell-owned credential ingress receives only the public definition
 * intent and resolves its credential outside the App Worker. A direct PAT is referenced after the
 * submit ONLY to reject an accidental echo in the readback. It is never stored, logged, or included
 * in any outcome object — outcomes carry public definition fields and operator-facing reasons
 * exclusively.
 *
 * @see apps/agentos/view/fleet/instances/AddAgentForm.mjs — the rendering consumer, mounted by the
 *     cockpit rail and the Accounts view
 */

/**
 * The flow's complete state vocabulary. `idle → validating → submitting` are surface-driven;
 * `readback-confirmed | gated | rejected` are the three terminal outcomes a submission resolves to.
 * @member {String[]} ADD_AGENT_STATES
 */
const ADD_AGENT_STATES = ['idle', 'validating', 'submitting', 'readback-confirmed', 'gated', 'rejected'];

/**
 * Top-level keys whose presence in a readback marks it as leaking secret material — the Brain's
 * canonical public definition is credential-free by contract (AgentDefinition's shape).
 * @member {String[]} SECRET_KEYS
 */
const SECRET_KEYS = ['authorization', 'credential', 'password', 'pat', 'token'];

/**
 * The repository a new GitHub seat works in unless the operator names another.
 * @member {String} DEFAULT_REPO_SLUG
 */
const DEFAULT_REPO_SLUG = 'neomjs/neo';

/**
 * The slug shape per forge: GitHub reads exactly `owner/repo`, GitLab `group/…/project`. Slugs are
 * lowercased first, and the Fleet judges the rest.
 * @member {Object} REPO_SLUG_SHAPES
 */
const REPO_SLUG_SHAPES = Object.freeze({
    github: /^[a-z0-9-]+\/[a-z0-9._-]+$/,
    gitlab: /^[a-z0-9._-]+(\/[a-z0-9._-]+)+$/
});

/**
 * The `gated` reason: no Fleet Registry bridge answers, so nothing can be added yet.
 * @member {String} FLEET_OFFLINE_REASON
 */
const FLEET_OFFLINE_REASON = 'The fleet is not running. Start it, then add the agent.';

/**
 * Static validation and bridge-round-trip utilities for defining an AgentOS resident.
 * @class AgentOS.util.AddAgentFlow
 * @extends Neo.core.Base
 */
class AddAgentFlow extends Base {
    static ADD_AGENT_STATES     = ADD_AGENT_STATES
    static DEFAULT_REPO_SLUG    = DEFAULT_REPO_SLUG
    static FLEET_OFFLINE_REASON = FLEET_OFFLINE_REASON

    static config = {
        /**
         * @member {String} className='AgentOS.util.AddAgentFlow'
         * @protected
         */
        className: 'AgentOS.util.AddAgentFlow'
    }

    /**
     * @summary Validate the define-agent payload before any bridge contact. Pure + synchronous: the
     * surface renders `validating` around this call and never submits an incomplete definition.
     * @param {Object} payload
     * @param {String} [payload.credential]   The PAT in direct-browser mode (write-only — validated for
     *     presence, never inspected further).
     * @param {String} [payload.forge]        `gitlab` for a GitLab seat, which then needs its instance.
     * @param {String} [payload.forgeHost]    The GitLab instance's origin; the Fleet judges its shape.
     * @param {String} payload.githubUsername
     * @param {String} payload.harnessType
     * @param {Object}  [options]
     * @param {Boolean} [options.credentialRequired=true] Whether this ingress owns credential entry.
     * @returns {{valid: Boolean, reason: String}} Operator-facing reason when invalid.
     */
    static validateDefinePayload(
        {credential, forge, forgeHost, githubUsername, harnessType}={},
        {credentialRequired=true}={}
    ) {
        const gitlab = forge === 'gitlab';

        if (!githubUsername?.trim() || (gitlab && !forgeHost?.trim()) || !harnessType || (credentialRequired && !credential)) {
            const needs = ['Username', ...(gitlab ? ['GitLab instance'] : []), 'harness', ...(credentialRequired ? ['personal access token'] : [])];

            return {valid: false, reason: `${needs.slice(0, -1).join(', ')} and ${needs.at(-1)} are required.`}
        }

        return {valid: true, reason: ''}
    }

    /**
     * @summary The canonical-readback guard: a definition is only trustworthy when it carries the
     * required public identity fields, serializes cleanly, exposes no top-level secret key, and does
     * not echo the submitted credential anywhere in its serialized form. Anything else fails closed.
     * @param {Object} definition          The bridge response claiming to be a public agent definition.
     * @param {String} submittedCredential Ephemeral — used solely for the echo check.
     * @returns {{valid: Boolean, reason: String}}
     */
    static validateReadback(definition, submittedCredential) {
        let serialized;

        try {
            serialized = JSON.stringify(definition)
        } catch {/* circular / non-serializable → invalid */}

        const
            hasIdentity = Boolean(definition?.id && definition.githubUsername && definition.harnessType),
            hasSecret   = Boolean(definition) && SECRET_KEYS.some(key => Object.hasOwn(definition, key)),
            echoes      = Boolean(submittedCredential && serialized?.includes(submittedCredential));

        if (!hasIdentity || !serialized || hasSecret || echoes) {
            return {valid: false, reason: 'Fleet Registry returned an invalid public agent definition. Nothing was changed.'}
        }

        return {valid: true, reason: ''}
    }

    /**
     * @summary A seat's working repository from the form's slug, so a provisioned Start runs the
     * harness in the seat's own checkout. Only the slug crosses: the Fleet composes the clone URL on the
     * seat's own forge. A blank entry means the default on GitHub, while a GitLab seat names its own;
     * a slug outside its forge's shape is `null`. The slug is lowercased, since the Fleet names the
     * checkout path in lowercase only.
     * @param {String} [repoSlug]
     * @param {String} [forge='github']
     * @returns {{repoSlug: String}|null}
     */
    static repoOf(repoSlug, forge='github') {
        const
            gitlab = forge === 'gitlab',
            slug   = String(repoSlug ?? '').trim().toLowerCase() || (gitlab ? '' : DEFAULT_REPO_SLUG);

        return REPO_SLUG_SHAPES[gitlab ? 'gitlab' : 'github'].test(slug) ? {repoSlug: slug} : null
    }

    /**
     * @summary Resolve the Fleet Registry bridge from its injected seam. The Body never constructs a
     * bridge — an Agent OS shell injects one; its absence is the `gated` state, not an error.
     * @param {Function|null} [resolver] Optional injected resolver (the DI seam for owners and tests).
     * @returns {Object|null} The bridge, or null when none is injected.
     */
    static resolveRegistryBridge(resolver=null) {
        if (resolver) {
            return resolver() ?? null
        }

        return globalThis.AgentOS?.fleet?.registryBridge ?? null
    }

    /**
     * @summary Whether credential entry belongs to the native shell rather than the App Worker.
     * The explicit bridge marker is the authority; an absent/unknown marker preserves the existing
     * direct-browser contract.
     * @param {Object|null} bridge
     * @returns {Boolean}
     */
    static isShellCredentialIngress(bridge) {
        return bridge?.credentialIngress === 'shell'
    }

    /**
     * @summary Project a form payload onto the exact define-agent request allowed across the bridge.
     * Shell mode carries public intent only; direct-browser mode preserves the credential-bearing
     * request. Explicit projection prevents unrelated form or caller fields from crossing either mode.
     * A seat added here is born fleet-launched: this cockpit is its only launcher, so its first Start
     * can come from here. Every other registration stays `external` until the operator adopts it. A
     * GitLab seat adds its forge and instance; a GitHub intent carries neither, as the Fleet requires.
     * @param {Object}      payload
     * @param {Object|null} bridge
     * @returns {Object}
     */
    static createDefineAgentIntent(payload={}, bridge=null) {
        const intent = {
            githubUsername: payload.githubUsername?.trim(),
            harnessType   : payload.harnessType,
            launchOwner   : 'fleet',
            ...(payload.forge === 'gitlab' ? {forge: 'gitlab', forgeHost: payload.forgeHost?.trim()} : {})
        };

        if (!AddAgentFlow.isShellCredentialIngress(bridge)) {
            intent.credential = payload.credential
        }

        return intent
    }

    /**
     * @summary The full submit round-trip as one typed outcome — the flow's only async step.
     *
     * Outcome shapes (state ∈ the terminal vocabulary):
     * - `{state: 'gated',              reason}`             — no bridge, or the bridge lacks `defineAgent`; fail-closed, nothing attempted.
     * - `{state: 'rejected',           reason}`             — payload invalid, controlled domain rejection, invalid readback, or transport error (reason is sanitized; never echoes credential bytes).
     * - `{state: 'readback-confirmed', definition, reason}` — the validated canonical public definition; the ONLY success shape.
     *   A readback-confirmed outcome with a `reason` is a defined seat whose working repo could not be set.
     *
     * The seat's working repo is set right after the define, so its first Start provisions its own
     * checkout; without one, Start launches the harness in the Fleet process's own directory.
     *
     * @param {Object}        config
     * @param {Function|null} [config.bridgeResolver] Injected bridge resolver (defaults to the global seam).
     * @param {Object}        config.payload          `{credential, forge, forgeHost, githubUsername, harnessType, repoSlug}`.
     * @returns {Promise<Object>} One terminal outcome — this function never throws.
     */
    static async submitDefineAgent({bridgeResolver=null, payload}) {
        const
            bridge     = AddAgentFlow.resolveRegistryBridge(bridgeResolver),
            shellOwned = AddAgentFlow.isShellCredentialIngress(bridge),
            request    = AddAgentFlow.createDefineAgentIntent(payload, bridge),
            repo       = AddAgentFlow.repoOf(payload?.repoSlug, request.forge),
            validation = AddAgentFlow.validateDefinePayload(request, {credentialRequired: !shellOwned});

        if (!validation.valid) {
            return {state: 'rejected', reason: validation.reason}
        }

        if (!repo) {
            return {state: 'rejected', reason: request.forge === 'gitlab'
                ? 'The working repository reads group/project, e.g. group/sub/project.'
                : 'The working repository reads owner/repo, e.g. neomjs/neo.'}
        }

        if (!bridge?.defineAgent) {
            return {state: 'gated', reason: FLEET_OFFLINE_REASON}
        }

        let outcome;

        try {
            outcome = await bridge.defineAgent(request)
        } catch (error) {
            // transport failure: the reason stays generic — an error message assembled elsewhere is
            // not a surface we allow to carry credential bytes into the DOM
            return {state: 'rejected', reason: 'Could not reach the fleet. Nothing was saved.'}
        }

        if (outcome?.status === 'rejected') {
            return {state: 'rejected', reason: outcome.reason || 'Agent definition was rejected. Nothing was changed.'}
        }

        const readback = AddAgentFlow.validateReadback(outcome, request.credential);

        if (!readback.valid) {
            return {state: 'rejected', reason: readback.reason}
        }

        return {state: 'readback-confirmed', ...await AddAgentFlow.assignRepo(bridge, outcome, repo, request.credential)}
    }

    /**
     * @summary Set a newly defined seat's working repo through the bridge. The define stands either
     * way; a repo that could not be set comes back as the reason, so the operator sets it before the
     * seat's first Start. The Fleet answers like `configureAgent`, so a refusal carries the Fleet's
     * own reason.
     * @param {Object} bridge
     * @param {Object} definition The confirmed public definition.
     * @param {{repoSlug: String}} repo
     * @param {String} [credential] Ephemeral — used solely for the readback's echo check.
     * @returns {Promise<{definition: Object, reason: String}>}
     */
    static async assignRepo(bridge, definition, repo, credential) {
        const unset = (reason = `set ${repo.repoSlug} before starting it.`) => ({
            definition,
            reason: `Agent added, but its working repository is not set: ${reason}`
        });

        if (!bridge?.setRepo) {
            return unset()
        }

        let outcome;

        try {
            outcome = await bridge.setRepo({id: definition.id, ...repo})
        } catch {
            return unset()
        }

        if (outcome?.status === 'rejected') {
            return unset(outcome.reason || undefined)
        }

        const withRepo = outcome?.status === 'accepted' ? outcome.agent : null;

        return withRepo && AddAgentFlow.validateReadback(withRepo, credential).valid
            ? {definition: withRepo, reason: ''}
            : unset()
    }
}

export default Neo.setupClass(AddAgentFlow);
