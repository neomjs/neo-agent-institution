import Base from '../../../node_modules/neo.mjs/src/main/addon/Base.mjs';

/**
 * @summary Forwards one setup call to the shell, or answers the no-shell envelope: every setup
 * channel replies in the same `{ok, reason}` shape, so a browser reads one honest refusal. A
 * module function, so the remotes read no instance state.
 * @param {String} name The preload key (`setupEvaluate`, …)
 * @param {Object} request
 * @returns {Promise<Object>}
 */
function forwardSetup(name, request) {
    return globalThis.neoShell?.[name]
        ? globalThis.neoShell[name](request)
        : Promise.resolve({ok: false, reason: 'no-shell'})
}

/**
 * @summary The cockpit's reach into the packaged shell's main-process brokers: the plane-attach broker
 * and the first-run setup channels.
 *
 * The shell's preload answers every call in Electron main. Main prompts for a credential itself, or
 * probes the stored one, so no call from here carries one, and no answer returns one — a credential
 * answer is the path of the file main kept. In a browser there is no shell: each call answers "not
 * available" instead of failing, and the setup card then shows the CLI's command.
 * @class Neo.main.addon.ShellPlane
 * @extends Neo.main.addon.Base
 */
class ShellPlane extends Base {
    static config = {
        /**
         * @member {String} className='Neo.main.addon.ShellPlane'
         * @protected
         */
        className: 'Neo.main.addon.ShellPlane',
        /**
         * Remote method access for other workers
         * @member {Object} remote={app: [//...]}
         * @protected
         * @reactive
         */
        remote: {
            app: [
                'attachPlane',
                'planeStatus',
                'setupAnswer',
                'setupCredential',
                'setupEffect',
                'setupEvaluate',
                'setupPresets',
                'setupProbe',
                'verifyPlane'
            ]
        }
    }

    /**
     * @summary Asks the shell to attach a plane. Only the plane base crosses; main prompts for the PAT.
     * @param {Object} data
     * @param {String} data.planeBase
     * @returns {Promise<{ok: Boolean, reason: String|null, relaunching: Boolean}>}
     */
    attachPlane({planeBase}) {
        return globalThis.neoShell?.attachPlane
            ? globalThis.neoShell.attachPlane({planeBase})
            : Promise.resolve({ok: false, reason: 'no-shell', relaunching: false})
    }

    /**
     * @summary Reads whether this shell is packaged and has a plane configured and attached.
     * @returns {Promise<Object>} `{available: false}` without a shell; otherwise the shell's answer with
     * `available: true`.
     */
    async planeStatus() {
        return globalThis.neoShell?.planeStatus
            ? {available: true, ...await globalThis.neoShell.planeStatus()}
            : {available: false}
    }

    /**
     * @summary Records a consent for one question. A credential answer is the path main produced;
     * a value is refused by main, never recorded.
     * @param {Object} data
     * @param {String} data.stepId
     * @param {String} data.answer
     * @returns {Promise<Object>} `{ok, evaluation}`, or `{ok: false, reason}`
     */
    setupAnswer({answer, stepId}) {
        return forwardSetup('setupAnswer', {answer, stepId})
    }

    /**
     * @summary Opens main's credential window for one credential question; the reply names the
     * kept file's path only, beside the re-evaluated steps.
     * @param {Object} data
     * @param {String} data.stepId
     * @returns {Promise<Object>}
     */
    setupCredential({stepId}) {
        return forwardSetup('setupCredential', {stepId})
    }

    /**
     * @summary Consents to one host effect; main runs it through the host-effect module and answers
     * the re-evaluated steps.
     * @param {Object} data
     * @param {String} data.effectId
     * @param {Boolean} [data.newAttempt] `true` consents to writing the witness again; it crosses only as `true`
     * @returns {Promise<Object>}
     */
    setupEffect({effectId, newAttempt}) {
        return forwardSetup('setupEffect', newAttempt === true ? {effectId, newAttempt: true} : {effectId})
    }

    /**
     * @summary Evaluates the recipe for the bound target — the CLI's `--json` shape.
     * @param {Object} [data]
     * @param {Object} [data.target] `{planeId, dataRoot, endpoint}`, each optional
     * @returns {Promise<Object>}
     */
    setupEvaluate(data = {}) {
        return forwardSetup('setupEvaluate', {target: data.target ?? null})
    }

    /**
     * @summary The preset table, as main holds it.
     * @returns {Promise<Object>}
     */
    setupPresets() {
        return forwardSetup('setupPresets', {})
    }

    /**
     * @summary The placement probe's JSON for this machine.
     * @returns {Promise<Object>}
     */
    setupProbe() {
        return forwardSetup('setupProbe', {})
    }

    /**
     * @summary Asks the shell whether the plane still admits the PAT this shell launched with.
     * @returns {Promise<{cause: String|null}>} `{cause: null}` without a shell.
     */
    async verifyPlane() {
        return globalThis.neoShell?.verifyPlane
            ? globalThis.neoShell.verifyPlane()
            : {cause: null}
    }
}

export default Neo.setupClass(ShellPlane);
