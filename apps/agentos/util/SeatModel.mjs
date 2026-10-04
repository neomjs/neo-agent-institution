import Base                         from '../../../node_modules/neo.mjs/src/core/Base.mjs';
import {resolveHarnessSeatSettings} from '../../../node_modules/neo-agent-brain/src/fleet/contract/index.mjs';

/**
 * @summary What the Seat group in Agent Detail › Configuration says about a seat's model and reasoning effort, in
 * the design read's words: the declared value beside what the harness is configured to, never one hiding the other.
 * @class AgentOS.util.SeatModel
 * @extends Neo.core.Base
 */
class SeatModel extends Base {
    static config = {
        /**
         * @member {String} className='AgentOS.util.SeatModel'
         * @protected
         */
        className: 'AgentOS.util.SeatModel'
    }

    /**
     * @summary Whether Fleet can declare a model and effort for a harness family: the shared harness catalog's
     * `seatSettings`, the same fact the Brain refuses a declaration by.
     * @param {String|null} harnessType
     * @returns {Boolean}
     */
    static declarable(harnessType) {
        return resolveHarnessSeatSettings(harnessType) !== null
    }

    /**
     * @summary One row of the Seat group.
     *
     * - A family Fleet cannot declare for: the value its seat reported, `set per session in the app`, or `not read back
     *   yet` before one, with no action.
     * - Nothing declared: `derived · reads <value> (configured on disk)` where the config was read, else `derived from
     *   the harness default`, with Change.
     * - Declared and configured alike, or the config not read: `declared <value>`, with Change.
     * - Declared against a different configured value: both, with `applies at next start` while the seat is stopped,
     *   and on a running seat Re-apply and Adopt.
     * @param {Object}      facts
     * @param {String}      facts.field       `model` or `reasoningEffort`
     * @param {String|null} facts.harnessType The seat's harness family
     * @param {String|null} facts.declared    The declared value
     * @param {Object|null} facts.configured  `{model, reasoningEffort}` the harness's config is set to, `null` unread
     * @param {String|null} [facts.observed]  What a seat that cannot be declared reported, when it did
     * @param {Boolean}     [facts.running]
     * @returns {{text: String, actions: String[]}} `actions` among `change`, `reapply`, `adopt`
     */
    static row({field, harnessType, declared, configured, observed = null, running = false}) {
        if (!SeatModel.declarable(harnessType)) {
            return {actions: [], text: observed ? `${observed} · set per session in the app` : 'not read back yet'}
        }

        const reads = configured ? configured[field] ?? null : undefined;

        if (!declared) {
            return {actions: ['change'], text: reads ? `derived · reads ${reads} (configured on disk)` : 'derived from the harness default'}
        }

        if (!reads || reads === declared) {
            return {actions: ['change'], text: `declared ${declared}`}
        }

        return running
            ? {actions: ['reapply', 'adopt'], text: `declared ${declared} · now reads ${reads} (configured on disk)`}
            : {actions: ['change'], text: `declared ${declared} · reads ${reads} (configured on disk) · applies at next start`}
    }

    /**
     * @summary What a seat's harness offers to declare, read through the Fleet. A bridge without the verb, or a read
     * that throws, answers its state and reason, never an empty catalog.
     * @param {Object|null} bridge  The cockpit's Fleet bridge
     * @param {String}      agentId
     * @returns {Promise<Object>} `{state, models, efforts?, reason}`
     */
    static async readCatalog(bridge, agentId) {
        if (typeof bridge?.fleetSeatModelCatalog !== 'function') {
            return {state: 'unavailable', models: [], reason: 'this Fleet cannot list what the harness offers yet'}
        }

        try {
            return await bridge.fleetSeatModelCatalog({id: agentId})
        } catch (error) {
            return {state: 'unavailable', models: [], reason: 'the Fleet could not read what the harness offers'}
        }
    }

    /**
     * @summary The roster card's one line about a refused start, or `null`: it speaks only when Start refused the
     * declared model.
     * @param {Object|null} seatModel The roster record's `seatModel`
     * @returns {String|null}
     */
    static refusal(seatModel) {
        return seatModel?.state === 'refused' ? `start refused: ${seatModel.reason} — change it in Detail › Configuration` : null
    }
}

export default Neo.setupClass(SeatModel);
