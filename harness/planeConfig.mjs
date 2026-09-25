import fs   from 'node:fs';
import path from 'node:path';

/**
 * @module harness/planeConfig
 * @summary The packaged shell's own record of the plane it attaches to. `plane.json` under Electron's
 * `userData` names the plane base; the viewer's PAT sits beside it, encrypted by `safeStorage` (the OS
 * keychain). Only main reads or writes either file: the renderer and the App worker learn whether a
 * plane is configured, never the credential.
 *
 * At boot the record becomes the env fragment the launcher used to export — `NEO_FLEET_PLANE_BASE` and
 * `NEO_FLEET_PLANE_BEARER` — and a variable already set in the process env wins, so checkout runs and
 * the launcher keep working unchanged. The record applies as a unit: its bearer never travels to a
 * plane base that came from somewhere else.
 */

/**
 * @type {String}
 */
export const PLANE_CONFIG_FILE = 'plane.json';

/**
 * @type {String}
 */
export const PLANE_BEARER_FILE = 'plane-bearer.bin';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

/**
 * @summary Validates and normalizes a plane base URL. Plain HTTP is accepted for loopback only — the
 * same loopback-or-TLS rule the Brain's plane client enforces — so a PAT never crosses a network in
 * clear text, and a URL carrying credentials is refused outright.
 * @param {String} value
 * @returns {String} The origin plus path, without a trailing slash.
 * @throws {TypeError} When the value is not an acceptable plane base.
 */
export function normalizePlaneBase(value) {
    let url;

    try {
        url = new URL(String(value ?? '').trim())
    } catch {
        throw new TypeError('plane base must be an absolute http(s) URL')
    }

    if (url.username || url.password) {
        throw new TypeError('plane base must not carry credentials')
    }

    if (url.protocol === 'http:' && !LOOPBACK_HOSTS.has(url.hostname)) {
        throw new TypeError('plane base must use https unless it is a loopback address')
    }

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new TypeError('plane base must be an absolute http(s) URL')
    }

    return `${url.origin}${url.pathname}`.replace(/\/+$/, '')
}

/**
 * @summary Reads the configured plane. A missing or unreadable record reads as unconfigured, and a
 * bearer that no longer decrypts (a reset keychain, another user) reads as absent instead of failing
 * the boot.
 * @param {Object} options
 * @param {String} options.dir Directory holding the record (Electron `userData`).
 * @param {Object} options.safeStorage Electron `safeStorage`.
 * @param {Object} [options.fsModule=fs]
 * @returns {{planeBase: String|null, bearer: String|null}}
 */
export function readPlaneConfig({dir, safeStorage, fsModule = fs}) {
    let planeBase, bearer = null;

    try {
        planeBase = normalizePlaneBase(JSON.parse(fsModule.readFileSync(path.join(dir, PLANE_CONFIG_FILE), 'utf8')).planeBase)
    } catch {
        return {planeBase: null, bearer: null}
    }

    try {
        if (safeStorage.isEncryptionAvailable()) {
            bearer = safeStorage.decryptString(fsModule.readFileSync(path.join(dir, PLANE_BEARER_FILE))) || null
        }
    } catch {
        bearer = null
    }

    return {planeBase, bearer}
}

/**
 * @summary Stores the plane record. Refuses when the OS cannot encrypt: a plain-text PAT under
 * `userData` is the launcher's stopgap, not the product. The bearer is written first, so `plane.json`
 * — the file that marks the shell as configured — never points at a credential that is missing.
 * @param {Object} options
 * @param {String} options.dir
 * @param {Object} options.safeStorage
 * @param {String} options.planeBase
 * @param {String} options.bearer
 * @param {Object} [options.fsModule=fs]
 * @returns {{planeBase: String}}
 * @throws {Error} When encryption is unavailable, or on an invalid plane base or an empty bearer.
 */
export function writePlaneConfig({dir, safeStorage, planeBase, bearer, fsModule = fs}) {
    const base = normalizePlaneBase(planeBase);

    if (typeof bearer !== 'string' || !bearer.trim()) {
        throw new TypeError('plane bearer must be a non-empty string')
    }

    if (!safeStorage.isEncryptionAvailable()) {
        throw new Error('the OS cannot encrypt credentials for this user, so the plane credential was not stored')
    }

    fsModule.mkdirSync(dir, {recursive: true});
    fsModule.writeFileSync(path.join(dir, PLANE_BEARER_FILE), safeStorage.encryptString(bearer.trim()), {mode: 0o600});
    fsModule.writeFileSync(path.join(dir, PLANE_CONFIG_FILE), JSON.stringify({planeBase: base}, null, 4) + '\n', {mode: 0o600});

    return {planeBase: base}
}

/**
 * @summary Removes the plane record, bearer included. Absent files are not an error.
 * @param {Object} options
 * @param {String} options.dir
 * @param {Object} [options.fsModule=fs]
 */
export function forgetPlaneConfig({dir, fsModule = fs}) {
    fsModule.rmSync(path.join(dir, PLANE_CONFIG_FILE), {force: true});
    fsModule.rmSync(path.join(dir, PLANE_BEARER_FILE), {force: true})
}

/**
 * @summary The Brain children's env fragment for a stored record. Returns nothing when the process env
 * already names a plane base: the stored bearer belongs to the stored plane, so it must not follow a
 * base set elsewhere. A bearer set in the env still wins over the stored one.
 * @param {Object} options
 * @param {{planeBase: String|null, bearer: String|null}} options.planeConfig
 * @param {Object} options.env The process env.
 * @returns {Object}
 */
export function planeEnvFragment({planeConfig, env}) {
    if (!planeConfig?.planeBase || env.NEO_FLEET_PLANE_BASE !== undefined) {
        return {}
    }

    return {
        NEO_FLEET_PLANE_BASE: planeConfig.planeBase,
        ...(planeConfig.bearer && env.NEO_FLEET_PLANE_BEARER === undefined && {NEO_FLEET_PLANE_BEARER: planeConfig.bearer})
    }
}

/**
 * @summary Asks the plane whether it admits a credential, with one authenticated `GET` on its MCP route.
 * The Memory Core installs its bearer check in front of every route, so a refused PAT answers a bare
 * 401, and any other HTTP status means the credential got past it. The body is never read. Whether the
 * credential's subject is the viewer is proven later, by the plane client at boot.
 * @param {Object} options
 * @param {String} options.planeBase A normalized plane base.
 * @param {String} options.bearer
 * @param {Function} [options.fetchFn=fetch]
 * @param {Number} [options.timeoutMs=8000]
 * @returns {Promise<'accepted'|'rejected'|'unreachable'>}
 */
export async function probePlaneCredential({planeBase, bearer, fetchFn = fetch, timeoutMs = 8000}) {
    let response;

    try {
        response = await fetchFn(`${planeBase}/mc/mcp`, {
            headers: {Accept: 'text/event-stream', Authorization: `Bearer ${bearer}`},
            method : 'GET',
            signal : AbortSignal.timeout(timeoutMs)
        })
    } catch {
        return 'unreachable'
    }

    response.body?.cancel?.().catch?.(() => {});

    return response.status === 401 || response.status === 403 ? 'rejected' : 'accepted'
}

/**
 * @summary The main-process handlers behind the preload's `planeStatus()` and `attachPlane()` (ADR 0034
 * §2.3.8). Both refuse an untrusted sender, and neither reply ever carries the credential: the PAT
 * exists only between the credential prompt, the probe, and the encrypted write.
 * @param {Object} options
 * @param {String} options.dir Directory holding the record (Electron `userData`).
 * @param {Function} options.getTransportFact Returns the settled boot fact (`{mode, up}`) or `null`.
 * @param {Function} options.isTrustedSender `(event) => Boolean`, the §2.3.4 check.
 * @param {Boolean} options.packaged Only a packaged boot reads the record, so only it may attach.
 * @param {Function} options.promptCredential `({event, method}) => Promise<String|null>` in main custody.
 * @param {Function} options.relaunch Restarts the shell after the reply is sent.
 * @param {Object} options.safeStorage Electron `safeStorage`.
 * @param {Function} [options.fetchFn=fetch]
 * @param {Object} [options.fsModule=fs]
 * @returns {{status: Function, attach: Function}}
 */
export function createPlaneBroker({dir, getTransportFact, isTrustedSender, packaged, promptCredential, relaunch, safeStorage, fetchFn = fetch, fsModule = fs}) {
    const refuse = reason => ({ok: false, reason, relaunching: false});

    return {
        /**
         * @param {Electron.IpcMainInvokeEvent} event
         * @returns {{packaged: Boolean, configured: Boolean, planeBase: String|null, attached: Boolean}}
         */
        status(event) {
            if (!isTrustedSender(event)) {
                throw new Error('shell-plane-status: untrusted sender')
            }

            const
                {planeBase} = readPlaneConfig({dir, safeStorage, fsModule}),
                fact        = getTransportFact();

            return {
                attached  : fact?.mode === 'plane-attach' && fact.up === true,
                configured: planeBase !== null,
                packaged,
                planeBase
            }
        },

        /**
         * @param {Electron.IpcMainInvokeEvent} event
         * @param {{planeBase: String}} request
         * @returns {Promise<{ok: Boolean, reason: String|null, relaunching: Boolean}>}
         */
        async attach(event, request) {
            if (!isTrustedSender(event)) {
                throw new Error('shell-plane-attach: untrusted sender')
            }

            if (!packaged) {
                return refuse('not-packaged')
            }

            let planeBase;

            try {
                planeBase = normalizePlaneBase(request?.planeBase)
            } catch {
                return refuse('invalid-plane-base')
            }

            if (!safeStorage.isEncryptionAvailable()) {
                return refuse('encryption-unavailable')
            }

            const bearer = await promptCredential({event, method: 'plane-attach'});

            if (!bearer) {
                return refuse('canceled')
            }

            const verdict = await probePlaneCredential({planeBase, bearer, fetchFn});

            if (verdict !== 'accepted') {
                return refuse(verdict)
            }

            writePlaneConfig({bearer, dir, fsModule, planeBase, safeStorage});
            relaunch();

            return {ok: true, reason: null, relaunching: true}
        }
    }
}
