import Base                        from '../../../node_modules/neo.mjs/src/core/Base.mjs';
import {resolveHarnessSeatSetting} from '../../../node_modules/neo-agent-brain/src/fleet/contract/index.mjs';

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
     * @summary Whether Fleet can declare one field for a harness family, using the same capability
     * the Brain validates. Supporting effort does not imply model support.
     * @param {String|null} harnessType
     * @param {'model'|'reasoningEffort'} field
     * @returns {Boolean}
     */
    static declarable(harnessType, field) {
        return resolveHarnessSeatSetting(harnessType, field) !== null
    }

    /**
     * @summary One row of the Seat group.
     *
     * - A family Fleet cannot declare for: the value its seat reported and `set per session in the app`, or before
     *   one `set per session in the app · not read back yet`, with no action.
     * - A start refused for the declared value: `declared <value> · start refused: <the Fleet's reason>`, with Change.
     * - Desktop effort: the declaration or `app default`, with Change, even before the first Start.
     *   This is declaration readback, not an observation of the running session's effort.
     * - Nothing declared: `derived · reads <value> (configured on disk)` where the config was read, else `derived from
     *   the harness default`, with Change.
     * - Declared and configured alike, or the config not read: `declared <value>`, with Change.
     * - Declared against a different configured value: both, and `applies at next start`, because a harness reads its
     *   config when it launches, running or not. Change, and Adopt to declare the configured value instead.
     * @param {Object}      facts
     * @param {String}      facts.field       `model` or `reasoningEffort`
     * @param {String|null} facts.harnessType The seat's harness family
     * @param {String|null} facts.declared    The declared value
     * @param {Object|null} facts.configured  `{model, reasoningEffort}` the harness's config is set to, `null` unread
     * @param {String|null} [facts.observed]  What a seat that cannot be declared reported, when it did
     * @param {String|null} [facts.refused]   The reason the Fleet refused the latest start for this declaration
     * @returns {{text: String, actions: String[]}} `actions` among `change` and `adopt`
     */
    static row({field, harnessType, declared, configured, observed = null, refused = null}) {
        if (!SeatModel.declarable(harnessType, field)) {
            return {actions: [], text: observed ? `${observed} · set per session in the app` : 'set per session in the app · not read back yet'}
        }

        if (declared && refused) {
            return {actions: ['change'], text: `declared ${declared} · start refused: ${refused}`}
        }

        if (harnessType === 'claude-desktop') {
            return {actions: ['change'], text: declared ? `declared ${declared}` : 'app default'}
        }

        const reads = configured ? configured[field] ?? null : undefined;

        if (!declared) {
            return {actions: ['change'], text: reads ? `derived · reads ${reads} (configured on disk)` : 'derived from the harness default'}
        }

        if (!reads || reads === declared) {
            return {actions: ['change'], text: `declared ${declared}`}
        }

        return {actions: ['change', 'adopt'], text: `declared ${declared} · reads ${reads} (configured on disk) · applies at next start`}
    }

    /**
     * @summary Why the Fleet refused the seat's latest start, when it refused the declaration the seat holds now;
     * `null` otherwise. A refusal names the declaration it was given, so one for a declaration changed since says
     * nothing about the current one.
     * @param {Object|null} seatModel The roster record's `seatModel`, `{state, model, reasoningEffort, reason}`
     * @param {Object|null} seat      The seat's definition, read for `model` and `reasoningEffort`
     * @returns {String|null}
     */
    static refusedReason(seatModel, seat) {
        const refusesThis = seatModel?.state === 'refused' &&
            (seatModel.model ?? null) === (seat?.model ?? null) && (seatModel.reasoningEffort ?? null) === (seat?.reasoningEffort ?? null);

        return refusesThis ? seatModel.reason ?? null : null
    }

    /**
     * @summary The catalog entry a model value names, by its `id` or its `slug`, the way the Brain's own refusal check
     * reads a declaration.
     * @param {Object|null} catalog A `fleetSeatModelCatalog` answer
     * @param {String|null} value   A declared or configured model
     * @returns {Object|null}
     */
    static findModel(catalog, value) {
        return value ? catalog?.models?.find(entry => entry.id === value || entry.slug === value) ?? null : null
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
     * @summary The roster card's one line about a start refused for the declared model, or `null`. It speaks only when
     * the Fleet recorded that refusal and this cockpit's own latest outcome, if it has one, is the same refusal: a newer
     * local rejection for another cause keeps its own words until the roster reads the seat again. The line is the
     * reason alone, so it never ends mid-instruction at roster width; the title adds where to change it.
     * @param {Object|null} seatModel       The roster record's `seatModel`
     * @param {Object|null} [controlReason] The card's `{action, kind, reason}` from this cockpit's last control
     * @returns {{text: String, title: String}|null}
     */
    static refusal(seatModel, controlReason = null) {
        const agrees = !controlReason || (controlReason.kind === 'rejected' && controlReason.reason?.includes(seatModel?.reason));

        if (seatModel?.state !== 'refused' || !agrees) return null;

        const text = `start refused: ${seatModel.reason}`;

        return {text, title: `${text} — change it in Detail › Configuration`}
    }
}

export default Neo.setupClass(SeatModel);
