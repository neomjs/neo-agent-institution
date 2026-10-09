import Base from '../../../node_modules/neo.mjs/src/core/Base.mjs';

/**
 * @summary C2 adapter for Fleet cockpit lifecycle intents: consume a per-card
 * `lifecycleIntent`, call the existing registry bridge lifecycle verb, and write the honest
 * round-trip state onto the card's roster record.
 *
 * The B4 control surface owns intent emission + rendering. This helper owns the transport-adapter
 * half only: no Node-side imports, no bespoke bridge path, and no optimistic success state. The
 * record contract is the two-field seam consumed by the B4 control renderer
 * ({@link AgentOS.model.FleetAgent} fields): `pendingAction:String|null` and
 * `controlReason:{action,kind,reason}|null` — written via `record.set()`, so the store's
 * `recordChange` re-renders the card.
 * @module apps/agentos/util/FleetLifecycleIntentAdapter
 */

const DEFAULT_LIFECYCLE_TIMEOUT_MS = 30_000;

const LIFECYCLE_ACTION_METHODS = Object.freeze({
    restart: 'restartAgent',
    start  : 'startAgent',
    stop   : 'stopAgent'
});

const SECRET_PATTERNS = [
    /\b(?:github_pat|ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]+/gi,
    // a labelled value (`PAT: …`, `token=…`), never the bare word: the Fleet's own refusals say "no GitHub PAT stored"
    /\b(PAT|token|credential|secret)\b\s*[:=]\s*[^\s,;]+/gi
];

/**
 * Static Fleet lifecycle-intent bridge and record-state utilities.
 * @class AgentOS.util.FleetLifecycleIntentAdapter
 * @extends Neo.core.Base
 */
class FleetLifecycleIntentAdapter extends Base {
    /** @type {WeakMap<Object, Object>} Latest intent per roster record, including locally refused intents. */
    static #attempts = new WeakMap()

    static DEFAULT_LIFECYCLE_TIMEOUT_MS = DEFAULT_LIFECYCLE_TIMEOUT_MS
    static LIFECYCLE_ACTION_METHODS     = LIFECYCLE_ACTION_METHODS

    static config = {
        /**
         * @member {String} className='AgentOS.util.FleetLifecycleIntentAdapter'
         * @protected
         */
        className: 'AgentOS.util.FleetLifecycleIntentAdapter'
    }

    /**
     * @summary Resolve the injected pane-facing Fleet registry bridge.
     * @returns {Object|null}
     */
    static getFleetRegistryBridge() {
        return globalThis.AgentOS?.fleet?.registryBridge || null
    }

    /**
     * @summary Redact secret-shaped material before a bridge error becomes UI/record state.
     * @param {*} value
     * @param {String} fallback
     * @returns {String}
     */
    static sanitizeControlReason(value, fallback='Lifecycle request failed') {
        let reason = String(value || '').trim() || fallback;

        SECRET_PATTERNS.forEach(pattern => {
            reason = reason.replace(pattern, '[redacted]')
        });

        return reason
    }

    /**
     * @summary Build the terminal non-success control-reason payload.
     * @param {String} action
     * @param {'rejected'|'unauthorized'|'timeout'} kind
     * @param {*} reason
     * @returns {{action:String, kind:String, reason:String}}
     */
    static createControlReason(action, kind, reason) {
        return {
            action,
            kind,
            reason: FleetLifecycleIntentAdapter.sanitizeControlReason(reason, `${action || 'lifecycle'} request ${kind}`)
        }
    }

    /**
     * @summary Whether a settled round-trip can have changed what the roster reads: a lifecycle change, or a refusal
     * the Fleet answered, which may record its cause on the seat. Never a timeout, whose outcome is unknown, nor a
     * rejection that never left this cockpit. A re-poll keeps the card's own reason: the roster rows carry none.
     * @param {Object|null} result A {@link handleFleetLifecycleIntent} answer
     * @returns {Boolean}
     */
    static rosterMayRead(result) {
        return Boolean((!result?.isCurrent || result.isCurrent()) &&
            (result?.ok || (result?.accepted && result.status === 'rejected')))
    }

    /**
     * @summary Whether the bridge offers the Fleet's Skip verb, `skipAgentDependencies`. Its methods come from the
     * pinned Brain's wire list, so an older pin has none, and the pane then offers no Skip at all.
     * @param {Object|null} [bridge=getFleetRegistryBridge()]
     * @returns {Boolean}
     */
    static canSkip(bridge=FleetLifecycleIntentAdapter.getFleetRegistryBridge()) {
        return typeof bridge?.skipAgentDependencies === 'function'
    }

    /**
     * @summary Ask the Fleet to skip a pending Start's remaining dependency installs. This is a side request, not
     * a lifecycle round-trip: it never claims the record's pending verb, so the Start it serves keeps its own
     * attempt, and that Start's late answer still settles the card. The Fleet answers `{id, skippedStarts}`;
     * `0` means no install was left to skip. A bridge without the verb, or a Fleet that refuses it, reads as
     * unavailable; no answer within the timeout reads as unanswered, since its outcome is unknown.
     * @param {Object} intent
     * @param {String} intent.agentId Durable fleet agent id.
     * @param {Object} [options]
     * @param {Object|null} [options.bridge=getFleetRegistryBridge()] Test seam or injected registry bridge.
     * @param {Number} [options.timeoutMs=30000]
     * @returns {Promise<{reason: String|null, state: 'requested'|'none'|'unavailable'|'unanswered'}>}
     */
    static async handleSkipIntent({agentId}={}, options={}) {
        options ||= {};

        const bridge = Object.hasOwn(options, 'bridge') ? options.bridge : FleetLifecycleIntentAdapter.getFleetRegistryBridge();

        if (!agentId || !FleetLifecycleIntentAdapter.canSkip(bridge)) {
            return {reason: 'this Fleet does not offer Skip', state: 'unavailable'}
        }

        try {
            const result = await FleetLifecycleIntentAdapter.#withTimeout(Promise.resolve().then(() => bridge.skipAgentDependencies(agentId)), 'skip', options);

            return result?.skippedStarts > 0
                ? {reason: null, state: 'requested'}
                : {reason: 'no install was still running', state: 'none'}
        } catch (error) {
            return error?.isFleetLifecycleTimeout
                ? {reason: 'the Fleet has not answered yet', state: 'unanswered'}
                : {reason: FleetLifecycleIntentAdapter.sanitizeControlReason(error?.message, 'the Fleet did not accept Skip'), state: 'unavailable'}
        }
    }

    /**
     * @summary Write one or more lifecycle-control fields onto a card's record.
     * @param {Object} record An AgentOS.model.FleetAgent record (or any record-like exposing `set()`),
     *     or a plain field bag (dock-blueprint snapshot / test double) mutated in place.
     * @param {Object} values
     */
    static writeLifecycleControlState(record, values) {
        if (typeof record?.set === 'function') {
            record.set(values);
            return
        }

        if (record && typeof record === 'object') {
            Object.assign(record, values);
            return
        }

        throw new Error('fleet lifecycle intent adapter requires a card record')
    }

    /**
     * @summary Create the adapter-local timeout sentinel error.
     * @param {String} action
     * @param {Number} timeoutMs
     * @returns {Error}
     */
    static #createTimeoutError(action, timeoutMs) {
        const error = new Error(`${action} timed out after ${timeoutMs}ms`);
        error.isFleetLifecycleTimeout = true;
        return error
    }

    /**
     * @summary Race a bridge operation against the lifecycle honesty timeout.
     * @param {Promise} promise
     * @param {String} action
     * @param {Object} options
     * @returns {Promise}
     */
    static #withTimeout(promise, action, {
        clearTimeoutFn = clearTimeout,
        setTimeoutFn   = setTimeout,
        timeoutMs      = DEFAULT_LIFECYCLE_TIMEOUT_MS
    } = {}) {
        if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
            return promise
        }

        let timeoutId;

        const timeout = new Promise((resolve, reject) => {
            timeoutId = setTimeoutFn(() => reject(FleetLifecycleIntentAdapter.#createTimeoutError(action, timeoutMs)), timeoutMs)
        });

        return Promise.race([promise, timeout]).finally(() => clearTimeoutFn(timeoutId))
    }

    /**
     * @summary Consume one per-card lifecycle intent and write honest record state for B4 to render.
     * A refusal the Fleet answers as data (`{status: 'rejected', reason}`, the bridge's domain outcome)
     * ends `rejected` like a throw, never `settled`.
     * Late reconciliation needs the live promise. Reloaded cockpits recreate this transient record
     * overlay from their roster read; they do not persist or resume a previous timeout's promise.
     * @param {Object} intent
     * @param {'start'|'stop'|'restart'} intent.action
     * @param {String} intent.agentId Durable fleet agent id.
     * @param {Object} record The target card's roster record (see writeLifecycleControlState).
     * @param {Object} [options]
     * @param {Object|null} [options.bridge=getFleetRegistryBridge()] Test seam or injected registry bridge.
     * @param {Number} [options.timeoutMs=30000] Timeout for settle-or-reject honesty.
     * @param {Function} [options.isCurrent] Whether the caller still owns this record's target.
     * @returns {Promise<Object>} Local result metadata, with an `isCurrent()` fence. A timeout also
     *     carries `settlement`: the actual answer, still observed and applied if current. Neither the
     *     deadline nor a later intent cancels the bridge operation; superseded answers write nothing.
     */
    static async handleFleetLifecycleIntent(intent={}, record, options={}) {
        options ||= {};

        const
            {action, agentId} = intent,
            method            = FleetLifecycleIntentAdapter.LIFECYCLE_ACTION_METHODS[action],
            bridge            = Object.hasOwn(options, 'bridge') ? options.bridge : FleetLifecycleIntentAdapter.getFleetRegistryBridge(),
            attempt           = {},
            isCurrent         = () => !record.isDestroyed && FleetLifecycleIntentAdapter.#attempts.get(record) === attempt &&
                (!options.isCurrent || options.isCurrent());

        FleetLifecycleIntentAdapter.#attempts.set(record, attempt);

        if (!method) {
            const controlReason = FleetLifecycleIntentAdapter.createControlReason(action, 'rejected', `Unsupported lifecycle action '${action}'`);

            FleetLifecycleIntentAdapter.writeLifecycleControlState(record, {pendingAction: null, controlReason});

            return {accepted: false, action, method: null, ok: false, status: 'rejected', controlReason, isCurrent}
        }

        if (!agentId) {
            const controlReason = FleetLifecycleIntentAdapter.createControlReason(action, 'rejected', 'Lifecycle intent is missing agentId');

            FleetLifecycleIntentAdapter.writeLifecycleControlState(record, {pendingAction: null, controlReason});

            return {accepted: false, action, method, ok: false, status: 'rejected', controlReason, isCurrent}
        }

        if (typeof bridge?.[method] !== 'function') {
            const controlReason = FleetLifecycleIntentAdapter.createControlReason(action, 'unauthorized', 'Fleet Registry bridge unavailable');

            FleetLifecycleIntentAdapter.writeLifecycleControlState(record, {pendingAction: null, controlReason});

            return {accepted: false, action, method, ok: false, status: 'unauthorized', controlReason, isCurrent}
        }

        FleetLifecycleIntentAdapter.writeLifecycleControlState(record, {
            controlReason: null,
            pendingAction: action
        });

        const complete = (result, controlReason=null) => {
            if (!isCurrent()) {
                return {accepted: true, action, method, ok: false, status: 'superseded', isCurrent}
            }

            FleetLifecycleIntentAdapter.writeLifecycleControlState(record, {controlReason, pendingAction: null});

            return controlReason
                ? {accepted: true, action, method, ok: false, status: controlReason.kind, controlReason, isCurrent}
                : {accepted: true, action, method, ok: true, status: 'settled', result, isCurrent}
        };

        let answer;

        // Observe the operation itself: Promise.race only bounds how long the caller waits.
        const settlement = Promise.resolve().then(() => bridge[method](agentId)).then(
            result => answer = complete(result, result?.status === 'rejected'
                ? FleetLifecycleIntentAdapter.createControlReason(action, 'rejected', result.reason) : null),
            error => answer = complete(null, FleetLifecycleIntentAdapter.createControlReason(action, 'rejected', error?.message))
        );

        try {
            return await FleetLifecycleIntentAdapter.#withTimeout(settlement, action, options)
        } catch (error) {
            if (!error?.isFleetLifecycleTimeout) throw error;

            return answer || {...complete(null, FleetLifecycleIntentAdapter.createControlReason(action, 'timeout', error.message)), settlement}
        }
    }
}

export default Neo.setupClass(FleetLifecycleIntentAdapter);
