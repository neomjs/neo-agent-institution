import Base from '../../../node_modules/neo.mjs/src/core/Base.mjs';
import {
    LAUNCH_ADMISSION_CREDENTIALS as CREDENTIALS,
    LAUNCH_ADMISSION_OUTCOMES   as OUTCOMES,
    LAUNCH_ADMISSION_REASONS    as REASONS,
    LAUNCH_ADMISSION_REFUSALS   as REFUSALS,
    LAUNCH_ADMISSION_STATES     as STATES,
    MCP_SERVERS
} from '../../../node_modules/neo-agent-brain/src/fleet/contract/index.mjs';

const
    VALID_STATES       = new Set(Object.values(STATES)),
    VALID_OUTCOMES     = new Set(Object.values(OUTCOMES)),
    CREDENTIAL_REFUSAL = new Set([REFUSALS.CREDENTIAL_MISSING, REFUSALS.CREDENTIAL_UNPROVEN]),
    SERVER_LABELS      = new Map(MCP_SERVERS.map(({key, label}) => [key, label]));

/** @summary Whether a wire value is a non-array object. @param {*} value @returns {Boolean} */
function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * @class AgentOS.util.SeatLaunchAdmission
 * @extends Neo.core.Base
 * @summary Resolve one current roster admission snapshot into the card's existing status line.
 * The issuer owns its generation and audit; this utility only words a validated observation and never
 * mutates lifecycle state or invents connectivity.
 */
class SeatLaunchAdmission extends Base {
    static config = {
        /** @member {String} className='AgentOS.util.SeatLaunchAdmission' @protected */
        className: 'AgentOS.util.SeatLaunchAdmission'
    }

    /**
     * @summary The compact card guidance for one launch-admission snapshot, or null when it has no
     * current operator-facing message. The roster and runtime gates prevent retained or inferred facts
     * from being phrased as a live refusal.
     * @param {Object|null} snapshot The roster row's Brain-owned `launchAdmission` value.
     * @param {Object} [options]
     * @param {String} options.rosterState Current grid source state.
     * @param {Object} options.runtime Normalized `SourceHealth` runtime fact.
     * @param {Boolean} [options.canRestart=false] The existing lifecycle controls' restart verdict.
     * @returns {{text:String, title:String, restart:Boolean}|null}
     */
    static cardLine(snapshot, {rosterState, runtime, canRestart=false} = {}) {
        if (rosterState !== 'live' || runtime?.state !== 'wired' || runtime?.confidence !== 'observed') {
            return null
        }

        if (!isObject(snapshot) || !VALID_STATES.has(snapshot.state)) return null;

        if (snapshot.state === STATES.NONE) return null;

        if (snapshot.state === STATES.RESERVED) {
            return {
                restart: false,
                text   : 'Preparing tool access',
                title  : 'Fleet is preparing new tool connections. This does not show whether the tools are connected.'
            }
        }

        if (snapshot.state === STATES.STALE || snapshot.state === STATES.REVOKED) {
            const restart = canRestart === true,
                  reason = {
                      [REASONS.ISSUER_REPLACED]: 'Fleet no longer holds this launch',
                      [REASONS.STOP_REQUESTED]: 'Stop withdrew this launch',
                      [REASONS.START_FAILED]: 'the managed launch failed',
                      [REASONS.LEASE_FAILED]: 'Fleet could not retain this launch',
                      [REASONS.PROCESS_EXITED]: 'the launch ended',
                      [REASONS.PLAN_CHANGED]: 'the launch settings changed',
                      [REASONS.REPLACED]: 'a newer launch replaced this one'
                  }[snapshot.reason] ?? 'this launch no longer admits new connections';

            return {
                restart,
                text : 'New tool connections are blocked',
                title: `New tool connections are blocked because ${reason}; already-running tools may still work.${restart ? ' Restart this seat to allow new tool connections.' : ''}`
            }
        }

        if (snapshot.state !== STATES.ACTIVE || typeof snapshot.generation !== 'string' || !snapshot.generation.trim()) {
            return null
        }

        const since = Date.parse(snapshot.since);

        if (!Number.isFinite(since) || !Array.isArray(snapshot.recent)) return null;

        // The issuer returns FIFO audit rows. Keep only each server's newest valid row so an
        // admitted redemption clears that server's older credential warning.
        const latestByServer = new Map();

        snapshot.recent.forEach((entry, index) => {
            if (!isObject(entry) || typeof entry.server !== 'string' || !entry.server.trim() ||
                !VALID_OUTCOMES.has(entry.outcome)) {
                return
            }

            const at = Date.parse(entry.at);

            if (!Number.isFinite(at) || at < since) return;

            latestByServer.set(entry.server, {entry, index})
        });

        let latestFailure = null;

        for (const row of latestByServer.values()) {
            const {entry, index} = row;

            if (entry.outcome === OUTCOMES.REFUSED && CREDENTIAL_REFUSAL.has(entry.code) &&
                (!latestFailure || index > latestFailure.index)) {
                latestFailure = row
            }
        }

        if (!latestFailure) return null;

        const
            server       = SERVER_LABELS.get(latestFailure.entry.server) ?? 'MCP tool',
            credential   = latestFailure.entry.reason === CREDENTIALS.SEAT_PAT
                ? "the seat's repository credential"
                : latestFailure.entry.reason === CREDENTIALS.PLANE_BEARER
                    ? "the seat's plane credential"
                    : 'the tool credential',
            problem      = latestFailure.entry.code === REFUSALS.CREDENTIAL_MISSING ? 'is missing' : 'could not be verified';

        return {
            restart: false,
            text   : `New ${server} connection refused`,
            title  : `${credential[0].toUpperCase()}${credential.slice(1)} ${problem} for ${server}. Existing tools may still work. Credential repair is not available in this cockpit; restarting will not repair it.`
        }
    }
}

export default Neo.setupClass(SeatLaunchAdmission);
