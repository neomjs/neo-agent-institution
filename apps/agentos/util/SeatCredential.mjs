import Base                        from '../../../node_modules/neo.mjs/src/core/Base.mjs';
import FleetLifecycleIntentAdapter from './FleetLifecycleIntentAdapter.mjs';

const
    ACTION_LABEL                = 'Replace token',
    EXPIRING_SOON_MS            = 7 * 86_400_000,
    INCOMPLETE_REPLACEMENT_CODE = 'FLEET_SEAT_CREDENTIAL_REPLACEMENT_INCOMPLETE',
    SCOPES                      = Object.freeze(['forge', 'forge-and-bound-plane']),
    SCOPE_OPTIONS               = Object.freeze([
        {scope: 'forge',                 label: 'GitHub only'},
        {scope: 'forge-and-bound-plane', label: 'GitHub and the connected Agent OS'}
    ]);

/**
 * @summary Pure domain contract for replacing a stopped seat's GitHub token, reading
 * `getAgent(id).planeCredential`, classifying `"Replace token"` next steps across Start refusals,
 * open-work refusals, and incomplete replacement receipts, and flagging tokens expiring within 7 days.
 *
 * Credential bytes never pass through this helper or any Body component: `replace()` forwards only
 * `{id, scope}` to the shell-owned `replaceSeatCredential` ingress.
 *
 * @class AgentOS.util.SeatCredential
 * @extends Neo.core.Base
 */
class SeatCredential extends Base {
    static ACTION_LABEL                = ACTION_LABEL
    static EXPIRING_SOON_MS            = EXPIRING_SOON_MS
    static INCOMPLETE_REPLACEMENT_CODE = INCOMPLETE_REPLACEMENT_CODE
    static SCOPES                      = SCOPES
    static SCOPE_OPTIONS               = SCOPE_OPTIONS

    static config = {
        /**
         * @member {String} className='AgentOS.util.SeatCredential'
         * @protected
         */
        className: 'AgentOS.util.SeatCredential'
    }

    /**
     * @summary Whether `"Replace token"` may be offered for `record`. Only a stopped seat (`state === 'off'`
     * with no in-flight Start/Restart) can rotate its credential; a running seat reports `cause: 'seat-running'`.
     * @param {Object|null} record
     * @returns {{canReplace: Boolean, cause: String|null, reason: String|null}}
     */
    static availability(record) {
        const agentId = typeof record?.agentId === 'string' ? record.agentId.trim() : '';

        if (!agentId) {
            return {canReplace: false, cause: null, reason: null}
        }

        const running = (record.state ?? 'off') !== 'off' || ['start', 'restart'].includes(record.pendingAction);

        if (running) {
            return {
                canReplace: false,
                cause     : 'seat-running',
                reason    : 'Token replacement is unavailable while this seat is running (seat-running). Stop the seat before replacing its token.'
            }
        }

        return {canReplace: true, cause: null, reason: null}
    }

    /**
     * @summary Read `getAgent(id).planeCredential` (`'none' | 'same-as-forge' | 'distinct' | 'unreadable'`)
     * when `"Replace token"` is clicked. Only `'same-as-forge'` and `'distinct'` open the two-scope choice
     * (with nothing pre-selected); `'none'`, `'unreadable'`, and failed reads replace for GitHub only
     * (`scope: 'forge'`), carrying the reason when the Agent OS choice is missing.
     * @param {Object|null} bridge
     * @param {String}      agentId
     * @returns {Promise<{planeCredential: String, failed: Boolean, needsChoice: Boolean, autoScope: String|null, reason: String|null, note: String|null}>}
     */
    static async readPlaneCredential(bridge, agentId) {
        if (typeof bridge?.getAgent !== 'function') {
            const reason = 'this Fleet cannot read the seat definition';

            return {
                planeCredential: 'unreadable',
                failed         : true,
                needsChoice    : false,
                autoScope      : 'forge',
                reason,
                note           : `The connected Agent OS credential could not be read (${reason}), so the Agent OS choice is unavailable and only the GitHub token is replaced.`
            }
        }

        let agent;
        try {
            agent = await bridge.getAgent(agentId)
        } catch (error) {
            const reason = FleetLifecycleIntentAdapter.sanitizeControlReason(error?.message, 'seat read failed');

            return {
                planeCredential: 'unreadable',
                failed         : true,
                needsChoice    : false,
                autoScope      : 'forge',
                reason,
                note           : `The connected Agent OS credential could not be read (${reason}), so the Agent OS choice is unavailable and only the GitHub token is replaced.`
            }
        }

        if (!agent || typeof agent !== 'object') {
            const reason = 'seat definition not found';

            return {
                planeCredential: 'unreadable',
                failed         : true,
                needsChoice    : false,
                autoScope      : 'forge',
                reason,
                note           : `The connected Agent OS credential could not be read (${reason}), so the Agent OS choice is unavailable and only the GitHub token is replaced.`
            }
        }

        if (agent.planeCredential === 'none') {
            return {
                planeCredential: 'none',
                failed         : false,
                needsChoice    : false,
                autoScope      : 'forge',
                reason         : null,
                note           : null
            }
        }

        if (agent.planeCredential === 'same-as-forge') {
            return {
                planeCredential: 'same-as-forge',
                failed         : false,
                needsChoice    : true,
                autoScope      : null,
                reason         : null,
                note           : 'The connected Agent OS uses this same token today. Choose whether to replace the GitHub token only or both.'
            }
        }

        if (agent.planeCredential === 'distinct') {
            return {
                planeCredential: 'distinct',
                failed         : false,
                needsChoice    : true,
                autoScope      : null,
                reason         : null,
                note           : 'The connected Agent OS uses a different token today; choosing GitHub and the connected Agent OS will overwrite it.'
            }
        }

        return {
            planeCredential: 'unreadable',
            failed         : false,
            needsChoice    : false,
            autoScope      : 'forge',
            reason         : agent.planeCredential === 'unreadable' ? null : 'Agent OS credential state was not reported',
            note           : 'The connected Agent OS credential store could not be read, so the Agent OS choice is unavailable and only the GitHub token is replaced.'
        }
    }

    /**
     * @summary Dispatch the public `{id, scope}` replacement intent through the shell credential ingress.
     * @param {Object|null} bridge
     * @param {Object}      intent
     * @param {String}      intent.id
     * @param {'forge'|'forge-and-bound-plane'} intent.scope
     * @returns {Promise<{ok: Boolean, status: String, cause: String|null, reason: String|null, receipt: Object|null, scope: String|null}>}
     */
    static async replace(bridge, {id, scope} = {}) {
        const agentId = typeof id === 'string' ? id.trim() : '';

        if (!agentId || !SCOPES.includes(scope)) {
            return {
                ok     : false,
                status : 'rejected',
                cause  : 'indeterminate',
                reason : 'Select which token bindings to replace first.',
                receipt: null,
                scope  : SCOPES.includes(scope) ? scope : null
            }
        }

        if (typeof bridge?.replaceSeatCredential !== 'function') {
            return {
                ok     : false,
                status : 'rejected',
                cause  : 'indeterminate',
                reason : 'This Fleet does not support replacing seat tokens yet. Nothing was changed.',
                receipt: null,
                scope
            }
        }

        if (bridge.credentialIngress !== 'shell') {
            return {
                ok     : false,
                status : 'rejected',
                cause  : 'indeterminate',
                reason : 'Replace the token from the installed Fleet Manager. Nothing was changed.',
                receipt: null,
                scope
            }
        }

        try {
            const
                outcome       = await bridge.replaceSeatCredential({id: agentId, scope}),
                receipt       = outcome?.receipt && typeof outcome.receipt === 'object' ? outcome.receipt : null,
                resolvedScope = SCOPES.includes(receipt?.scope) ? receipt.scope : scope;

            if (outcome?.status === 'replaced') {
                return {
                    ok    : true,
                    status: 'replaced',
                    cause : null,
                    reason: null,
                    receipt,
                    scope : resolvedScope
                }
            }

            return {
                ok    : false,
                status: outcome?.status ?? 'rejected',
                cause : typeof outcome?.cause === 'string' ? outcome.cause : null,
                reason: FleetLifecycleIntentAdapter.sanitizeControlReason(outcome?.reason, 'The token was not replaced.'),
                receipt,
                scope : resolvedScope
            }
        } catch {
            return {
                ok     : false,
                status : 'rejected',
                cause  : 'indeterminate',
                reason : 'The token was not replaced.',
                receipt: null,
                scope
            }
        }
    }

    /**
     * @summary Whether a Start/Restart `controlReason` requires `"Replace token"` as its next step
     * (`credentialRefusal` `{surface: 'forge', verdict: 'refused'}` or `code: 'FLEET_SEAT_CREDENTIAL_REPLACEMENT_INCOMPLETE'`).
     * @param {Object|null} controlReason
     * @returns {Boolean}
     */
    static isStartCredentialRefusal(controlReason) {
        if (!controlReason || controlReason.kind !== 'rejected') {
            return false
        }

        const refusal = controlReason.credentialRefusal;

        return (refusal?.surface === 'forge' && refusal?.verdict === 'refused') ||
            controlReason.code === INCOMPLETE_REPLACEMENT_CODE
    }

    /**
     * @summary Whether `fleetOpenWork.seats[id].credentialRefusal` carries a forge refusal (`verdict: 'refused'`).
     * @param {Object|null} refusal
     * @returns {Boolean}
     */
    static isOpenWorkCredentialRefusal(refusal) {
        return Boolean(refusal && refusal.surface === 'forge' && refusal.verdict === 'refused')
    }

    /**
     * @summary Describe `tokenExpiresAt` for Agent Detail and the 7-day cockpit warning flag. Returns `null`
     * when `tokenExpiresAt` is `null` or invalid so tokens without an expiry show nothing.
     * @param {String|null} tokenExpiresAt
     * @param {Number}      [now=Date.now()]
     * @returns {{tokenExpiresAt: String, expiresMs: Number, remainingMs: Number, expired: Boolean, expiringSoon: Boolean, windowText: String, detailText: String, cardClause: String}|null}
     */
    static describeExpiry(tokenExpiresAt, now = Date.now()) {
        if (typeof tokenExpiresAt !== 'string' || !tokenExpiresAt.trim()) {
            return null
        }

        const
            dateIso   = tokenExpiresAt.trim(),
            expiresMs = Date.parse(dateIso);

        if (!Number.isFinite(expiresMs)) {
            return null
        }

        const
            clockMs      = Number.isFinite(now) ? now : Date.now(),
            remainingMs  = expiresMs - clockMs,
            expired      = remainingMs <= 0,
            expiringSoon = remainingMs <= EXPIRING_SOON_MS,
            windowText   = expired
                ? 'expired'
                : remainingMs < 3_600_000
                    ? 'in <1h'
                    : remainingMs < 86_400_000
                        ? `in ${Math.ceil(remainingMs / 3_600_000)}h`
                        : `in ${Math.ceil(remainingMs / 86_400_000)}d`,
            cardClause   = expired ? 'GitHub token expired' : `GitHub token expires ${windowText}`,
            detailText   = expired
                ? `GitHub token expired (${dateIso}) · ${ACTION_LABEL}`
                : expiringSoon
                    ? `GitHub token expires ${windowText} (${dateIso}) · ${ACTION_LABEL}`
                    : `GitHub token expires ${dateIso}`;

        return {
            tokenExpiresAt: dateIso,
            expiresMs,
            remainingMs,
            expired,
            expiringSoon,
            windowText,
            detailText,
            cardClause
        }
    }

    /**
     * @summary Resolve any active `"Replace token"` next step for `record` and the latest replacement
     * `receipt`. Returns `null` for all other refusals so non-matching refusals keep their existing wording.
     * @param {Object|null} record
     * @param {Object}      [options={}]
     * @param {Object|null} [options.receipt=null]
     * @param {String|null} [options.reason=null]
     * @returns {{kind: String, actionLabel: String, retryScope: String|null, reason: String}|null}
     */
    static nextStep(record, {receipt = null, reason = null} = {}) {
        if (receipt?.nextStep === 'replace-seat-credential') {
            return {
                kind       : 'incomplete-receipt',
                actionLabel: ACTION_LABEL,
                retryScope : SCOPES.includes(receipt.scope) ? receipt.scope : null,
                reason     : reason || 'Credential replacement is incomplete; run Replace token again to reconcile the selected stores.'
            }
        }

        if (SeatCredential.isStartCredentialRefusal(record?.controlReason)) {
            return {
                kind       : 'start-refused',
                actionLabel: ACTION_LABEL,
                retryScope : null,
                reason     : record.controlReason.reason
            }
        }

        if (SeatCredential.isOpenWorkCredentialRefusal(record?.openWorkCredentialRefusal)) {
            const detail = record.openWorkCredentialRefusal.reason
                ? FleetLifecycleIntentAdapter.sanitizeControlReason(record.openWorkCredentialRefusal.reason, '')
                : '';

            return {
                kind       : 'open-work-refused',
                actionLabel: ACTION_LABEL,
                retryScope : null,
                reason     : detail || 'GitHub rejected this seat’s token during the open-work read.'
            }
        }

        return null
    }

    /**
     * @summary Compose the cockpit roster card's status line when a Start credential refusal, open-work
     * credential refusal, or 7-day `tokenExpiresAt` window applies; `null` otherwise.
     * @param {Object|null} record
     * @param {Object}      [options={}]
     * @param {Number}      [options.now=Date.now()]
     * @returns {{kind: String, state: 'refused'|'expiring', text: String, title: String}|null}
     */
    static cardLine(record, {now = Date.now()} = {}) {
        if (!record) {
            return null
        }

        if (SeatCredential.isStartCredentialRefusal(record.controlReason)) {
            const head = `⚠ ${record.controlReason.kind}: ${record.controlReason.reason}`;

            return {
                kind : 'start-refused',
                state: 'refused',
                text : `${head} · ${ACTION_LABEL}`,
                title: `${head} — ${ACTION_LABEL} in Detail › Configuration`
            }
        }

        if (!record.controlReason && SeatCredential.isOpenWorkCredentialRefusal(record.openWorkCredentialRefusal)) {
            const
                detail = record.openWorkCredentialRefusal.reason
                    ? `: ${FleetLifecycleIntentAdapter.sanitizeControlReason(record.openWorkCredentialRefusal.reason, '')}`
                    : '',
                head   = `⚠ GitHub token refused${detail}`;

            return {
                kind : 'open-work-refused',
                state: 'refused',
                text : `${head} · ${ACTION_LABEL}`,
                title: `${head} — ${ACTION_LABEL} in Detail › Configuration`
            }
        }

        const expiry = !record.controlReason ? SeatCredential.describeExpiry(record.tokenExpiresAt, now) : null;

        if (expiry?.expiringSoon) {
            const head = `⚠ ${expiry.cardClause}`;

            return {
                kind : 'token-expiring',
                state: 'expiring',
                text : `${head} · ${ACTION_LABEL}`,
                title: `${expiry.detailText} in Detail › Configuration`
            }
        }

        return null
    }
}

export default Neo.setupClass(SeatCredential);
