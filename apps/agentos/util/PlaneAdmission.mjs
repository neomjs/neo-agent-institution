import Base from '../../../node_modules/neo.mjs/src/core/Base.mjs';

const UNRESOLVED_LINE = 'cannot own seats yet · register-forge';
const UNKNOWN_LINE    = 'plane admission unknown';

const EMPTY_ADMISSION = Object.freeze({
    commands       : null,
    fleetDataDir   : null,
    line           : '',
    pid            : null,
    reason         : null,
    resolutionState: null,
    startedAt      : null,
    state          : null,
    status         : null
});

/**
 * @summary Pure helpers and cockpit state loader for Brain `/fleet/probe` plane-admission reads.
 *
 * Inspects `GET /fleet/probe` (`identity.ownerPrincipal` vs `identity.ownerResolution`) so the
 * cockpit header and the Add-agent form share one vocabulary (`cannot own seats yet · register-forge`
 * when unresolved, hidden when admitted, `plane admission unknown` when unreachable) and the Add
 * form stops before the token sheet with the plane's reason and copyable setup commands.
 *
 * @class AgentOS.util.PlaneAdmission
 * @extends Neo.core.Base
 */
class PlaneAdmission extends Base {
    static config = {
        /**
         * @member {String} className='AgentOS.util.PlaneAdmission'
         * @protected
         */
        className: 'AgentOS.util.PlaneAdmission'
    }

    /**
     * @returns {Object}
     */
    static emptyState() {
        return {...EMPTY_ADMISSION};
    }

    /**
     * @param {Object|null} bridge
     * @returns {Boolean}
     */
    static hasProbe(bridge) {
        return typeof bridge?.probePlane === 'function' || typeof bridge?.fleetProbe === 'function';
    }

    /**
     * Builds the two copyable `forgeConnections.mjs` host commands (`init` + `register`) from the
     * plane's own probe envelope and the canonical `local-agent-os` compose invocation.
     *
     * @param {Object|null} [probe=null]
     * @returns {String[]}
     */
    static commandsFor(probe=null) {
        const body     = probe?.result ?? probe ?? null;
        const identity = body?.identity ?? body ?? null;
        const project  = typeof body?.composeProject === 'string' && body.composeProject.trim()
            ? `-p ${body.composeProject.trim()} `
            : '';
        const service  = typeof body?.composeService === 'string' && body.composeService.trim()
            ? body.composeService.trim()
            : 'fleet-server';
        const provider = typeof identity?.authProvider === 'string' && identity.authProvider.trim()
            ? identity.authProvider.trim()
            : 'github';
        const endpoint = typeof identity?.providerBaseUrl === 'string' && identity.providerBaseUrl.trim()
            ? identity.providerBaseUrl.trim()
            : (provider === 'gitlab' ? 'https://gitlab.com' : 'https://api.github.com');
        const prefix   = `docker compose ${project}--env-file .env -f deploy/cloud/docker-compose.yml -f deploy/cloud/docker-compose.local-agent-os.yml --profile fleet exec ${service} node ai/scripts/fleet/forgeConnections.mjs`;

        return [
            `${prefix} init --apply`,
            `${prefix} register --provider ${provider} --endpoint ${endpoint} --apply`
        ];
    }

    /**
     * Formats the Add-agent status line copy when the plane reports `ownerResolution`.
     *
     * @param {String} reason
     * @returns {String}
     */
    static statusReasonFor(reason) {
        return `This plane cannot own seats yet — ${reason}. On the plane host: init, then register (the setup step 'register-forge'); then Add again.`;
    }

    /**
     * Normalizes a raw `/fleet/probe` response or an already-inspected snapshot into
     * `{state: 'admitted'|'unresolved'|'unknown', line, reason, status, commands, pid, startedAt, fleetDataDir}`.
     *
     * @param {Object|null} answer
     * @returns {Object}
     */
    static inspect(answer) {
        if (answer && (answer.state === 'admitted' || answer.state === 'unresolved' || answer.state === 'unknown')) {
            if (answer.state === 'admitted') {
                return {
                    commands       : null,
                    fleetDataDir   : answer.fleetDataDir ?? null,
                    line           : '',
                    pid            : answer.pid ?? null,
                    reason         : null,
                    resolutionState: null,
                    startedAt      : answer.startedAt ?? null,
                    state          : 'admitted',
                    status         : null
                };
            }

            if (answer.state === 'unresolved') {
                const reason = (typeof answer.reason === 'string' && answer.reason.trim())
                    || 'forge owner resolution is not ready';

                return {
                    commands       : Array.isArray(answer.commands) && answer.commands.length === 2
                        ? answer.commands
                        : PlaneAdmission.commandsFor(answer),
                    fleetDataDir   : answer.fleetDataDir ?? null,
                    line           : UNRESOLVED_LINE,
                    pid            : answer.pid ?? null,
                    reason,
                    resolutionState: answer.resolutionState ?? null,
                    startedAt      : answer.startedAt ?? null,
                    state          : 'unresolved',
                    status         : answer.status || PlaneAdmission.statusReasonFor(reason)
                };
            }

            return {
                commands       : null,
                fleetDataDir   : null,
                line           : UNKNOWN_LINE,
                pid            : null,
                reason         : null,
                resolutionState: null,
                startedAt      : null,
                state          : 'unknown',
                status         : null
            };
        }

        const body         = answer?.ok === false ? null : (answer?.result ?? answer ?? null);
        const identity     = body?.identity ?? (body?.ownerPrincipal || body?.ownerResolution ? body : null);
        const pid          = body?.pid ?? null;
        const startedAt    = body?.startedAt ?? null;
        const fleetDataDir = body?.fleetDataDir ?? null;

        if (identity?.ownerPrincipal && typeof identity.ownerPrincipal === 'object') {
            return {
                commands       : null,
                fleetDataDir,
                line           : '',
                pid,
                reason         : null,
                resolutionState: null,
                startedAt,
                state          : 'admitted',
                status         : null
            };
        }

        if (identity?.ownerResolution && typeof identity.ownerResolution === 'object') {
            const reason = (typeof identity.ownerResolution.reason === 'string' && identity.ownerResolution.reason.trim())
                || identity.ownerResolution.state
                || 'forge owner resolution is not ready';

            return {
                commands       : PlaneAdmission.commandsFor(body),
                fleetDataDir,
                line           : UNRESOLVED_LINE,
                pid,
                reason,
                resolutionState: identity.ownerResolution.state ?? null,
                startedAt,
                state          : 'unresolved',
                status         : PlaneAdmission.statusReasonFor(reason)
            };
        }

        return {
            commands       : null,
            fleetDataDir   : null,
            line           : UNKNOWN_LINE,
            pid            : null,
            reason         : null,
            resolutionState: null,
            startedAt      : null,
            state          : 'unknown',
            status         : null
        };
    }

    /**
     * Resolves the plane-state line presentation (`{state, line, hidden}`) for a bound value.
     * Returns `{state: null, line: '', hidden: true}` when no probe has been read yet.
     *
     * @param {Object|null} value
     * @returns {{state: String|null, line: String, hidden: Boolean}}
     */
    static lineFor(value) {
        if (!value || (typeof value === 'object' && value.state === null && !value.identity && !value.ownerPrincipal && !value.ownerResolution)) {
            return {state: null, line: '', hidden: true};
        }

        const inspected = PlaneAdmission.inspect(value);

        if (inspected.state === 'admitted') {
            return {state: 'admitted', line: '', hidden: true};
        }

        if (inspected.state === 'unresolved') {
            return {state: 'unresolved', line: UNRESOLVED_LINE, hidden: false};
        }

        return {state: 'unknown', line: UNKNOWN_LINE, hidden: false};
    }

    /**
     * Reads `/fleet/probe` from the bridge or an explicit probe function and normalizes it.
     *
     * @param {Object} [options={}]
     * @param {Object|null} [options.bridge=null]
     * @param {Function|null} [options.bridgeResolver=null]
     * @param {Function|null} [options.probe=null]
     * @returns {Promise<Object>}
     */
    static async read({bridge=null, bridgeResolver=null, probe=null}={}) {
        const resolvedBridge = bridge ?? (bridgeResolver ? bridgeResolver() : globalThis.AgentOS?.fleet?.registryBridge) ?? null;
        const reader         = typeof probe === 'function'
            ? probe
            : (typeof resolvedBridge?.probePlane === 'function'
                ? () => resolvedBridge.probePlane()
                : (typeof resolvedBridge?.fleetProbe === 'function'
                    ? () => resolvedBridge.fleetProbe()
                    : null));

        if (!reader) {
            return PlaneAdmission.inspect(null);
        }

        try {
            const raw = await reader();
            return PlaneAdmission.inspect(raw);
        } catch {
            return PlaneAdmission.inspect(null);
        }
    }

    /**
     * Reads `/fleet/probe` for the cockpit controller when the active bridge exposes a probe verb.
     *
     * @param {Neo.controller.Component} owner
     * @returns {Promise<void>}
     */
    static async load(owner) {
        const component = owner?.component;

        if (!component || component.isDestroyed) {
            return;
        }

        const bridge = owner.bridge;

        if (!PlaneAdmission.hasProbe(bridge)) {
            return;
        }

        const generation = (owner.planeAdmissionReadGeneration || 0) + 1;
        const profileId  = owner.currentProfileId ?? null;

        owner.planeAdmissionReadGeneration = generation;
        owner.planeAdmissionReadInFlight   = true;

        try {
            const snapshot = await PlaneAdmission.read({bridge});

            if (owner.planeAdmissionReadGeneration !== generation || component.isDestroyed) {
                return;
            }

            PlaneAdmission.apply(owner, snapshot, profileId);
        } finally {
            if (owner.planeAdmissionReadGeneration === generation) {
                owner.planeAdmissionReadInFlight = false;
            }
        }
    }

    /**
     * Applies a normalized plane-admission snapshot (or clears it on `null`) into the cockpit state provider.
     *
     * @param {Neo.controller.Component} owner
     * @param {Object|null} snapshot
     * @param {String|null} [profileId=owner?.currentProfileId ?? null]
     */
    static apply(owner, snapshot, profileId=owner?.currentProfileId ?? null) {
        const component = owner?.component;

        if (!component || component.isDestroyed) {
            return;
        }

        const inspected = snapshot === null ? null : PlaneAdmission.inspect(snapshot);

        owner.planeAdmissionProfileId   = profileId;
        owner.planeAdmissionInstanceKey = inspected?.pid || inspected?.startedAt
            ? `${inspected.pid ?? ''}:${inspected.startedAt ?? ''}`
            : null;

        component.getStateProvider()?.setData({
            planeAdmission: inspected
                ? {
                    commands       : inspected.commands,
                    fleetDataDir   : inspected.fleetDataDir,
                    line           : inspected.line,
                    pid            : inspected.pid,
                    reason         : inspected.reason,
                    resolutionState: inspected.resolutionState ?? null,
                    startedAt      : inspected.startedAt,
                    state          : inspected.state,
                    status         : inspected.status
                }
                : PlaneAdmission.emptyState()
        });
    }

    /**
     * Retires any held plane-admission snapshot across a target/profile switch so admission is
     * never cached across a plane change.
     *
     * @param {Neo.controller.Component} owner
     * @param {Object} [options={}]
     * @param {String|null} [options.profileId=null]
     */
    static retire(owner, {profileId=null}={}) {
        if (!owner) {
            return;
        }

        owner.planeAdmissionReadGeneration = (owner.planeAdmissionReadGeneration || 0) + 1;
        owner.planeAdmissionReadInFlight   = false;

        PlaneAdmission.apply(owner, null, profileId);
    }

    /**
     * Renders the plane-state line beneath the destination on an `AddAgentForm` instance.
     *
     * @param {Neo.component.Base} form
     * @param {Object|null} [value=form?.planeAdmission]
     */
    static applyToForm(form, value=form?.planeAdmission) {
        const
            {hidden, line, state} = PlaneAdmission.lineFor(value),
            row                   = form?.getReference?.('plane-admission-line');

        row?.set({
            cls   : ['fm-add-plane-admission', ...(state && !hidden ? [`is-${state}`] : [])],
            hidden,
            text  : line
        });
    }

    /**
     * Syncs the two-command disclosure on an `AddAgentForm` instance from `flowStatus`.
     *
     * @param {Neo.component.Base} form
     * @param {Object|null} value
     */
    static syncFormCommands(form, value) {
        const
            commands = form?.getReference?.('plane-commands'),
            pair     = Array.isArray(value?.commands) && value.commands.length === 2 ? value.commands : null;

        if (commands) {
            commands.vdom.cn[1].cn[0].text = pair ? pair[0] : '';
            commands.vdom.cn[2].cn[0].text = pair ? pair[1] : '';
            commands.hidden                = !pair;
            commands.update();
        }
    }

    /**
     * Reads `/fleet/probe` for an `AddAgentForm` instance, fenced by `form.planeRequest`.
     *
     * @param {Neo.component.Base} form
     * @param {Object|null} bridge
     * @returns {Promise<Object|null>}
     */
    static async readForForm(form, bridge) {
        const request = form.planeRequest = (form.planeRequest || 0) + 1;

        if (!PlaneAdmission.hasProbe(bridge)) {
            return form.planeAdmission ? PlaneAdmission.inspect(form.planeAdmission) : null;
        }

        const outcome = await PlaneAdmission.read({bridge});

        if (request === form.planeRequest && !form.isDestroyed) {
            form.planeAdmission = outcome;
        }

        return outcome;
    }

    /**
     * Clears any cached plane-admission read on an `AddAgentForm` when the target plane changes.
     *
     * @param {Neo.component.Base} form
     * @param {Object|null} bridge
     */
    static onFormTargetChange(form, bridge) {
        form.updateDestinationLine();

        if (PlaneAdmission.hasProbe(bridge)) {
            form.planeAdmission = null;
            form.mounted && form.readPlaneAdmission();
        }
    }
}

export {UNRESOLVED_LINE, UNKNOWN_LINE};
export default Neo.setupClass(PlaneAdmission);
