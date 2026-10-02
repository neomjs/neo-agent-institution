import Base from '../../../node_modules/neo.mjs/src/main/addon/Base.mjs';

/**
 * @summary The cockpit's reach into the packaged shell's plane-attach broker.
 *
 * The shell's preload answers every call in Electron main. Main prompts for the credential itself, or
 * probes the stored one, so no call from here carries one, and no answer returns one. In a browser there
 * is no shell: each call answers "not available" instead of failing.
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
