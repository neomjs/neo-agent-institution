import Base from '../../../node_modules/neo.mjs/src/core/Base.mjs';
import {
    LAUNCH_ADMISSION_CREDENTIALS as CREDENTIALS,
    LAUNCH_ADMISSION_OUTCOMES   as OUTCOMES,
    LAUNCH_ADMISSION_REASONS    as REASONS,
    LAUNCH_ADMISSION_REFUSALS   as REFUSALS,
    LAUNCH_ADMISSION_STATES     as STATES,
    MCP_SERVERS,
    isLaunchAdmissionProofReason,
    mcpCatalogFor,
    resolveMcpMatrix
} from '../../../node_modules/neo-agent-brain/src/fleet/contract/index.mjs';

const
    VALID_STATES       = new Set(Object.values(STATES)),
    VALID_OUTCOMES     = new Set(Object.values(OUTCOMES)),
    CREDENTIAL_REFUSAL = new Set([REFUSALS.CREDENTIAL_MISSING, REFUSALS.CREDENTIAL_UNPROVEN]),
    // the refusals the card words: the two credential verdicts, and a proof the plane did not answer
    WORDED_REFUSAL     = new Set([...CREDENTIAL_REFUSAL, REFUSALS.PROOF_UNAVAILABLE]),
    CREDENTIAL_KINDS   = new Set(Object.values(CREDENTIALS)),
    SERVER_LABELS      = new Map(MCP_SERVERS.map(({key, label}) => [key, label]));

/**
 * @summary The credential a refusal entry names, in the card's words.
 * @param {*} kind A `LAUNCH_ADMISSION_CREDENTIALS` value, or anything else.
 * @returns {String}
 */
function credentialWords(kind) {
    return kind === CREDENTIALS.SEAT_PAT
        ? "the seat's repository credential"
        : kind === CREDENTIALS.PLANE_BEARER
            ? "the seat's plane credential"
            : 'the tool credential'
}

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
     * How long a seat's own launcher keeps retrying an unanswered credential proof after it starts:
     * the launcher's fixed protocol budget (`ai/mcp/client/fleetMcpLauncher.mjs`, `STARTUP_BUDGET_MS`),
     * not a setting. The launcher starts before its first proof is answered, so a run of unanswered
     * proofs whose first entry is older than this is past the budget for certain.
     * @member {Number} LAUNCH_STARTUP_BUDGET_MS=60000
     * @static
     */
    static LAUNCH_STARTUP_BUDGET_MS = 60000

    /**
     * @summary The compact card guidance for one launch-admission snapshot, or null when it has no
     * current operator-facing message. The roster and runtime gates prevent retained or inferred facts
     * from being phrased as a live refusal. A line whose words change on their own names that instant
     * as `until`, so the card can re-render then without a record change.
     * @param {Object|null} snapshot The roster row's Brain-owned `launchAdmission` value.
     * @param {Object} [options]
     * @param {String} options.rosterState Current grid source state.
     * @param {Object} options.runtime Normalized `SourceHealth` runtime fact.
     * @param {Object|null} [options.mcpSettings=null] Current public definition from the same roster row.
     * @param {Boolean} [options.canRestart=false] The existing lifecycle controls' restart verdict.
     * @param {Number} [options.now=Date.now()] The clock an unanswered proof's age is read against.
     * @returns {{text:String, title:String, restart:Boolean, until:(Number|undefined)}|null}
     */
    static cardLine(snapshot, {rosterState, runtime, mcpSettings=null, canRestart=false, now=Date.now()} = {}) {
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

        // The issuer returns FIFO audit rows. Keep only each server's newest valid row, so an admitted
        // redemption clears that server's older warning, and the first row of the server's current run
        // of unanswered proofs: the launcher's retry budget dates from the run's start, never from its
        // latest answer.
        const latestByServer = new Map();

        snapshot.recent.forEach((entry, index) => {
            if (!isObject(entry) || typeof entry.server !== 'string' || !entry.server.trim() ||
                !VALID_OUTCOMES.has(entry.outcome)) {
                return
            }

            const at = Date.parse(entry.at);

            if (!Number.isFinite(at) || at < since) return;

            const
                unanswered = entry.outcome === OUTCOMES.REFUSED && entry.code === REFUSALS.PROOF_UNAVAILABLE,
                prior      = latestByServer.get(entry.server);

            latestByServer.set(entry.server, {entry, index, first: unanswered ? prior?.first ?? entry : null})
        });

        const enabled = SeatLaunchAdmission.enabledServers(mcpSettings);
        let latestFailure = null;

        for (const row of latestByServer.values()) {
            const {entry, index} = row;

            if (enabled?.[entry.server] !== false && entry.outcome === OUTCOMES.REFUSED && WORDED_REFUSAL.has(entry.code) &&
                (!latestFailure || index > latestFailure.index)) {
                latestFailure = row
            }
        }

        if (!latestFailure) return SeatLaunchAdmission.serverLine(snapshot, enabled, canRestart);

        const
            {entry, first} = latestFailure,
            server         = SERVER_LABELS.get(entry.server) ?? 'MCP tool';

        if (entry.code === REFUSALS.PROOF_UNAVAILABLE) {
            return SeatLaunchAdmission.waitingLine(entry, first, server, {canRestart, now})
        }

        const
            credential = credentialWords(entry.reason),
            problem    = entry.code === REFUSALS.CREDENTIAL_MISSING ? 'is missing' : 'could not be verified';

        return {
            restart: false,
            text   : `New ${server} connection refused`,
            title  : `${credential[0].toUpperCase()}${credential.slice(1)} ${problem} for ${server}. Existing tools may still work. Credential repair is not available in this cockpit; restarting will not repair it.`
        }
    }

    /**
     * @summary The words for a run of proofs the plane did not answer (`proof-unavailable`). The run's
     * first entry dates the launcher's fixed retry budget: a run younger than the budget reads as waiting
     * and names the instant that changes; an older one reads as not admitted, with a restart hint when the
     * lifecycle controls allow one. The entry's `reason` is the issuer's: the credential's kind, named, or
     * one of the contract's public proof diagnostics, printed as it is; anything else is omitted. Neither
     * phase claims what the launcher or the seat's tools are doing now.
     * @param {Object} entry The run's latest audit entry, `{at, server, outcome, code, reason}`.
     * @param {Object} first The run's first audit entry.
     * @param {String} server The server's label.
     * @param {Object} options
     * @param {Boolean} options.canRestart
     * @param {Number} options.now
     * @returns {{text:String, title:String, restart:Boolean, until:(Number|undefined)}}
     * @protected
     */
    static waitingLine(entry, first, server, {canRestart, now}) {
        const
            named      = CREDENTIAL_KINDS.has(entry.reason),
            credential = credentialWords(named ? entry.reason : null),
            diagnostic = isLaunchAdmissionProofReason(entry.reason) ? ` (${entry.reason})` : '',
            until      = Date.parse(first.at) + SeatLaunchAdmission.LAUNCH_STARTUP_BUDGET_MS,
            gaveUp     = now >= until,
            restart    = gaveUp && canRestart === true,
            proof      = `${credential[0].toUpperCase()}${credential.slice(1)} proof for ${server} went unanswered${diagnostic}`;

        return gaveUp
            ? {
                restart,
                text : `New ${server} connection not admitted`,
                title: `${proof} for longer than the seat's launcher retries, about a minute, so it no longer retries this connection. Existing tools may still work.${restart ? ' Restart this seat to try the connection again.' : ''}`
            }
            : {
                restart: false,
                until,
                text   : `New ${server} connection waiting`,
                title  : `${proof}. The seat's launcher retries an unanswered proof for about a minute after it starts. Existing tools may still work.`
            }
    }

    /**
     * @summary Resolve the same roster row's current intent through the shared forge-aware catalog.
     * Missing or malformed intent stays unknown; grant state never supplies enablement.
     * @param {Object|null} settings The public definition's forge and sparse MCP overrides.
     * @returns {Object|null}
     */
    static enabledServers(settings) {
        if (!isObject(settings) || (settings.mcpServers !== null && !isObject(settings.mcpServers))) return null;

        try {
            return resolveMcpMatrix(settings.mcpServers, mcpCatalogFor(settings.forge))
        } catch {
            return null
        }
    }

    /**
     * @summary Explain a revoked grant only when the current definition still enables that server.
     * @param {Object} snapshot Issuer snapshot for the running seat.
     * @param {Object|null} enabled Current resolved server intent.
     * @param {Boolean} canRestart The existing Restart control's verdict.
     * @returns {{text:String, title:String, restart:Boolean}|null}
     */
    static serverLine(snapshot, enabled, canRestart) {
        if (!enabled || !Array.isArray(snapshot.servers)) return null;
        const server = snapshot.servers.find(item => item?.state === STATES.REVOKED &&
            enabled[item.key] === true && [REASONS.SERVER_DISABLED, REASONS.PLAN_CHANGED, REASONS.CREDENTIAL_MISSING].includes(item.reason));
        if (!server) return null;
        const label = SERVER_LABELS.get(server.key);
        if (server.reason === REASONS.CREDENTIAL_MISSING) {
            return {
                restart: false,
                text: `${label} startup credential missing`,
                title: `${label} lacked a required credential at launch. This cockpit cannot repair that credential; restarting alone will not repair it. Existing tools may still work.`
            }
        }
        const restart = canRestart === true;
        return {
            restart,
            text: `New ${label} connections are blocked`,
            title: `${label} is enabled now, but its grant was withdrawn during this launch. Existing tools may still work.${restart ? ' Restart this seat to allow new tool connections.' : ''}`
        }
    }
}

export default Neo.setupClass(SeatLaunchAdmission);
