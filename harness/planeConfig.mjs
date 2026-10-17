import crypto from 'node:crypto';
import fs     from 'node:fs';
import path   from 'node:path';

/**
 * @module harness/planeConfig
 * @summary The packaged shell's own record of the plane it attaches to. `plane.json` under Electron's
 * `userData` names the plane base and the identity the plane named for the viewer's PAT; the PAT sits
 * beside it, encrypted by `safeStorage` (the OS keychain). Only main reads or writes either file: the
 * renderer and the App worker learn whether a plane is configured, never the credential.
 *
 * At boot the record becomes the env fragment the launcher used to export — `NEO_FLEET_PLANE_BASE`,
 * `NEO_FLEET_PLANE_BEARER`, and the bearer's `NEO_AGENT_IDENTITY` — and a plane variable already set in
 * the process env wins, so checkout runs and the launcher keep working unchanged. The record applies as
 * a unit: its bearer never travels to a plane base that came from somewhere else, and its identity
 * travels with its bearer, because the plane admits the fleet child only when the claimed identity is
 * the bearer's subject.
 *
 * The record also keeps the plane's verdict on the bearer's class: the `authSource` its `/fleet/probe`
 * answered at attach. It is no secret, so it sits in `plane.json`, and it travels only with its bearer. A
 * forge PAT's class lets the fleet child present that one bearer to the plane's `/fleet` surface as well
 * (`NEO_FLEET_PLANE_BEARER_CLASS`). The shell never infers the class from the bytes.
 *
 * `plane.json` names the exact encrypted bearer it was written with (`bearerSha256`, the digest of those
 * bytes). A record whose bearer file is gone or was replaced without it, by a write that failed halfway,
 * reads as unconfigured. So the plane, identity and class are never read with another bearer.
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
 * @summary A viewer identity in the canonical `@login` form the Brain's `normalizeAgentIdentityNodeId`
 * produces, or `null`. A namespaced id (`AGENT:*`) or a value with whitespace names no viewer. The
 * shell keeps its own copy of the rule: it imports no Brain code.
 * @param {*} value
 * @returns {String|null}
 */
export function canonicalIdentity(value) {
    const bare = typeof value === 'string' ? value.trim().replace(/^@+/, '') : '';

    return bare && !/[\s:]/.test(bare) ? `@${bare}` : null
}

/**
 * @summary A bearer class as the plane names it (`github-pat`, `gitlab-pat`, …), or `null`. Only a plain
 * token passes, because it travels on into an env variable.
 * @param {*} value
 * @returns {String|null}
 */
function authSourceOf(value) {
    return typeof value === 'string' && /^[a-z0-9][a-z0-9-]*$/.test(value) ? value : null
}

/**
 * @summary Reads the configured plane. A missing or unreadable record reads as unconfigured, and so does
 * one whose bearer file is not the one it was written with. A bearer that no longer decrypts (a reset
 * keychain, another user) reads as absent instead of failing the boot. A record stored before the identity
 * was recorded reads `null` for it. A class only travels with the bearer it was recorded for: a record that
 * names no bearer (stored before the binding) carries none.
 * @param {Object} options
 * @param {String} options.dir Directory holding the record (Electron `userData`).
 * @param {Object} options.safeStorage Electron `safeStorage`.
 * @param {Object} [options.fsModule=fs]
 * @returns {{planeBase: String|null, bearer: String|null, identity: String|null, authSource: String|null}}
 */
export function readPlaneConfig({dir, safeStorage, fsModule = fs}) {
    const unconfigured = {planeBase: null, bearer: null, identity: null, authSource: null};
    let record, planeBase, identity, sealed = null, bearer = null;

    try {
        record    = JSON.parse(fsModule.readFileSync(path.join(dir, PLANE_CONFIG_FILE), 'utf8'));
        planeBase = normalizePlaneBase(record.planeBase);
        identity  = canonicalIdentity(record.identity)
    } catch {
        return unconfigured
    }

    try {
        sealed = fsModule.readFileSync(path.join(dir, PLANE_BEARER_FILE))
    } catch {}

    const bound = typeof record.bearerSha256 === 'string';

    if (bound && (!sealed || sha256(sealed) !== record.bearerSha256)) return unconfigured;

    try {
        if (sealed && safeStorage.isEncryptionAvailable()) {
            bearer = safeStorage.decryptString(sealed) || null
        }
    } catch {
        bearer = null
    }

    return {planeBase, bearer, identity, authSource: bound ? authSourceOf(record.authSource) : null}
}

/**
 * @summary Stores the plane record. Refuses when the OS cannot encrypt: a plain-text PAT under
 * `userData` is the launcher's stopgap, not the product. Each file is replaced whole (a temp file renamed
 * over it). `plane.json` is written first and names the digest of the encrypted bearer written after it.
 * A failure before it lands leaves the old record whole. A failure after it leaves a record whose bearer
 * does not match, which reads as unconfigured; that holds even over a record from before the binding. So
 * the new bearer is never paired with the old plane, identity or class. The
 * identity is the one the plane named for this bearer, and the class the one its fleet surface named;
 * neither is a secret, so both sit in `plane.json`. A class the plane didn't name is not recorded.
 * @param {Object} options
 * @param {String} options.dir
 * @param {Object} options.safeStorage
 * @param {String} options.planeBase
 * @param {String} options.bearer
 * @param {String} options.identity The bearer's canonical `@login`, from {@link probePlaneCredential}.
 * @param {String|null} [options.authSource=null] The bearer's class, from {@link probePlaneBearerClass}.
 * @param {Object} [options.fsModule=fs]
 * @returns {{planeBase: String, identity: String}}
 * @throws {Error} When encryption is unavailable, or on an invalid plane base, an empty bearer, or an
 * identity that names no viewer.
 */
export function writePlaneConfig({dir, safeStorage, planeBase, bearer, identity, authSource = null, fsModule = fs}) {
    const
        base   = normalizePlaneBase(planeBase),
        viewer = canonicalIdentity(identity),
        source = authSourceOf(authSource);

    if (typeof bearer !== 'string' || !bearer.trim()) {
        throw new TypeError('plane bearer must be a non-empty string')
    }

    if (!viewer) {
        throw new TypeError('plane identity must be a canonical @login')
    }

    if (!safeStorage.isEncryptionAvailable()) {
        throw new Error('the OS cannot encrypt credentials for this user, so the plane credential was not stored')
    }

    const
        sealed = safeStorage.encryptString(bearer.trim()),
        record = {...(source && {authSource: source}), bearerSha256: sha256(sealed), identity: viewer, planeBase: base};

    fsModule.mkdirSync(dir, {recursive: true});
    replaceFile({file: path.join(dir, PLANE_CONFIG_FILE), data: JSON.stringify(record, null, 4) + '\n', fsModule});
    replaceFile({file: path.join(dir, PLANE_BEARER_FILE), data: sealed, fsModule});

    return {identity: viewer, planeBase: base}
}

/**
 * @summary Replaces a file whole: a temp file beside it, owner-only, renamed over it.
 * @param {Object} options
 * @param {String} options.file
 * @param {String|Buffer} options.data
 * @param {Object} options.fsModule
 * @private
 */
function replaceFile({file, data, fsModule}) {
    const temp = `${file}.${process.pid}.tmp`;

    fsModule.writeFileSync(temp, data, {mode: 0o600});

    try {
        fsModule.renameSync(temp, file)
    } catch (error) {
        fsModule.rmSync(temp, {force: true});
        throw error
    }
}

/**
 * @summary The hex sha256 of an encrypted bearer's bytes: what binds `plane.json` to them.
 * @param {Buffer} bytes
 * @returns {String}
 * @private
 */
function sha256(bytes) {
    return crypto.createHash('sha256').update(bytes).digest('hex')
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
 * base set elsewhere. A bearer set in the env still wins over the stored one, and a record whose bearer
 * no longer decrypts is no record at all unless the env supplies one: the shell boots on its own rather
 * than attaching without a credential.
 *
 * The stored bearer brings its identity as `NEO_AGENT_IDENTITY`, over any inherited value: the fleet
 * child claims that identity and the plane admits it only as the bearer's subject, so an identity the
 * launch left behind — none from Finder, a peer's when an agent session started the app — can only be
 * refused. A stored bearer without its identity (a record from before the identity was recorded) is
 * therefore no record either: the shell boots on its own, and the plane card offers to attach again.
 * An env bearer keeps the env's identity.
 *
 * The stored bearer brings its recorded class the same way, `''` when none was recorded, with both
 * admission variables empty: the Brain derives the fleet-surface credential from a bearer whose class
 * is a forge PAT, so an admission credential the launch left behind cannot reach the record's plane.
 * @param {Object} options
 * @param {{planeBase: String|null, bearer: String|null, identity: String|null, authSource: String|null}} options.planeConfig
 * @param {Object} options.env The process env.
 * @returns {Object}
 */
export function planeEnvFragment({planeConfig, env}) {
    if (!planeConfig?.planeBase || env.NEO_FLEET_PLANE_BASE !== undefined) {
        return {}
    }

    if (env.NEO_FLEET_PLANE_BEARER !== undefined) {
        return {NEO_FLEET_PLANE_BASE: planeConfig.planeBase}
    }

    return planeConfig.bearer && planeConfig.identity ? {
        NEO_AGENT_IDENTITY                   : planeConfig.identity,
        NEO_FLEET_PLANE_ADMISSION_BEARER     : '',
        NEO_FLEET_PLANE_ADMISSION_BEARER_FILE: '',
        NEO_FLEET_PLANE_BASE                 : planeConfig.planeBase,
        NEO_FLEET_PLANE_BEARER               : planeConfig.bearer,
        NEO_FLEET_PLANE_BEARER_CLASS         : planeConfig.authSource ?? ''
    } : {}
}

/**
 * @summary The stored record, when it alone supplied a launch: {@link planeEnvFragment} gave the fleet child
 * the record's base and bearer. An inherited base or bearer means the child spoke to another plane or with
 * another credential, so nothing the record says describes that launch, and `null` is returned.
 * @param {{planeBase: String|null, bearer: String|null, identity: String|null}|null} planeConfig
 * @param {Object} fragment What {@link planeEnvFragment} returned for the launch.
 * @returns {Object|null}
 */
export function launchedPlaneRecord(planeConfig, fragment) {
    return planeConfig?.bearer &&
        fragment?.NEO_FLEET_PLANE_BEARER === planeConfig.bearer &&
        fragment.NEO_FLEET_PLANE_BASE === planeConfig.planeBase ? planeConfig : null
}

/**
 * The name the Memory Core's MCP server gives itself in its `initialize` answer — the positive proof
 * that a plane admitted the credential. A status alone proves nothing: a stranger's host answers 404 or
 * 405, never 401, and "not refused" is not "admitted".
 * @type {String}
 */
export const PLANE_MCP_SERVER_NAME = 'neo-memory-core';

const
    INITIALIZE       = {
        id     : 1,
        jsonrpc: '2.0',
        method : 'initialize',
        params : {capabilities: {}, clientInfo: {name: 'neo-harness-plane-probe', version: '1'}, protocolVersion: '2025-03-26'}
    },
    INITIALIZED      = {jsonrpc: '2.0', method: 'notifications/initialized'},
    LIST_PERMISSIONS = {id: 2, jsonrpc: '2.0', method: 'tools/call', params: {arguments: {}, name: 'list_permissions'}};

/**
 * @summary Reads the JSON-RPC message from an MCP answer, which the transport sends either as JSON or
 * as an SSE `data:` line.
 * @param {String} text
 * @returns {Object|null}
 */
function parseMcpAnswer(text) {
    const data = text.trimStart().startsWith('{') ? text : text.split('\n').find(line => line.startsWith('data:'))?.slice(5);

    try {
        return data ? JSON.parse(data) : null
    } catch {
        return null
    }
}

/**
 * @summary Reads a tool call's payload the way the Brain's plane client does: structured content when
 * present, else the JSON of the text item. An error result has none.
 * @param {Object|null} result The `result` of a `tools/call` answer.
 * @returns {Object|null}
 */
function readToolPayload(result) {
    if (!result || result.isError) return null;

    if (result.structuredContent && typeof result.structuredContent === 'object') {
        return result.structuredContent
    }

    try {
        return JSON.parse(result.content?.find?.(item => item?.type === 'text')?.text)
    } catch {
        return null
    }
}

/**
 * @summary Asks the plane whether it admits a credential, and whose it is, on its MCP route. The first
 * `initialize` carries no credential: a plane answers with a bearer challenge (401 +
 * `WWW-Authenticate: Bearer`), and any other answer ends the probe before the PAT leaves this process.
 * The second carries the PAT and counts only when the Memory Core names itself. In that session the
 * probe then calls `list_permissions`, whose `identity` is the bearer's subject as the plane resolves
 * it — the identity the fleet child must claim for the plane to admit it. The session is closed again
 * however the probe ends.
 * @param {Object} options
 * @param {String} options.planeBase A normalized plane base.
 * @param {String} options.bearer
 * @param {Function} [options.fetchFn=fetch]
 * @param {Number} [options.timeoutMs=8000]
 * @returns {Promise<{verdict: 'accepted'|'rejected'|'not-a-plane'|'no-identity'|'unreachable', identity: String|null}>}
 *     `identity` is the canonical `@login` when the verdict is `accepted`, else `null`.
 */
export async function probePlaneCredential({planeBase, bearer, fetchFn = fetch, timeoutMs = 8000}) {
    const
        url           = `${planeBase}/mc/mcp`,
        authorization = `Bearer ${bearer}`,
        refuse        = verdict => ({identity: null, verdict}),
        post          = (message, headers = {}) => fetchFn(url, {
            body   : JSON.stringify(message),
            headers: {Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json', ...headers},
            method : 'POST',
            signal : AbortSignal.timeout(timeoutMs)
        });

    let answer, response;

    try {
        response = await post(INITIALIZE);
        await response.text().catch(() => '');

        if (response.status !== 401 || !/^Bearer\b/i.test(response.headers.get('www-authenticate') ?? '')) {
            return refuse('not-a-plane')
        }

        response = await post(INITIALIZE, {Authorization: authorization});
        answer   = await response.text().catch(() => '')
    } catch {
        return refuse('unreachable')
    }

    if (response.status === 401 || response.status === 403) {
        return refuse('rejected')
    }

    const
        session     = response.headers.get('mcp-session-id'),
        initialized = response.status === 200 ? parseMcpAnswer(answer)?.result : null;

    try {
        if (initialized?.serverInfo?.name !== PLANE_MCP_SERVER_NAME) {
            return refuse('not-a-plane')
        }

        const headers = {
            Authorization: authorization,
            ...(session                    && {'mcp-session-id': session}),
            ...(initialized.protocolVersion && {'mcp-protocol-version': initialized.protocolVersion})
        };

        try {
            await (await post(INITIALIZED, headers)).text().catch(() => '');
            answer = await (await post(LIST_PERMISSIONS, headers)).text().catch(() => '')
        } catch {
            return refuse('unreachable')
        }

        const identity = canonicalIdentity(readToolPayload(parseMcpAnswer(answer)?.result)?.identity);

        return identity ? {identity, verdict: 'accepted'} : refuse('no-identity')
    } finally {
        session && Promise.resolve(fetchFn(url, {
            headers: {Authorization: authorization, 'mcp-session-id': session},
            method : 'DELETE',
            signal : AbortSignal.timeout(timeoutMs)
        })).catch(() => {})
    }
}

/**
 * @summary Asks the plane's fleet surface which class it admitted a bearer as. `/fleet/probe` answers the
 * admission context, whose `authSource` names a forge PAT (`github-pat`, `gitlab-pat`) or another source.
 * A refusal, a plane without a fleet surface, or any other answer reads as `null`: the class is never
 * guessed.
 * @param {Object} options
 * @param {String} options.planeBase A normalized plane base.
 * @param {String} options.bearer
 * @param {Function} [options.fetchFn=fetch]
 * @param {Number} [options.timeoutMs=8000]
 * @returns {Promise<String|null>}
 */
export async function probePlaneBearerClass({planeBase, bearer, fetchFn = fetch, timeoutMs = 8000}) {
    try {
        const response = await fetchFn(`${planeBase}/fleet/probe`, {
            headers: {Accept: 'application/json', Authorization: `Bearer ${bearer}`},
            method : 'GET',
            signal : AbortSignal.timeout(timeoutMs)
        });

        if (response.status !== 200) {
            await response.text().catch(() => '');
            return null
        }

        const answer = await response.json();

        return answer?.ok === true ? authSourceOf(answer.result?.identity?.authSource) : null
    } catch {
        return null
    }
}

/**
 * @summary The main-process handlers behind the preload's `planeStatus()`, `attachPlane()` and
 * `verifyPlane()`. Each refuses an untrusted sender, and no reply ever carries the credential: the PAT
 * exists only between the credential prompt or the stored record, the probe, and the encrypted write.
 * @param {Object} options
 * @param {Function} options.causeOf `(answer, storedIdentity) => String|null`: the runtime cause a probe
 *     answer names (`runtimePlaneCause`).
 * @param {String} options.dir Directory holding the record (Electron `userData`).
 * @param {Function} options.getLaunchedPlane Returns the stored record this shell launched its fleet
 *     child with (`launchedPlaneRecord`), or `null` when the launch took its plane from elsewhere.
 * @param {Function} options.getTransportFact Returns the settled boot fact (`{mode, up}`) or `null`.
 * @param {Function} options.isTrustedSender `(event) => Boolean`, the §2.3.4 check.
 * @param {Boolean} options.packaged Only a packaged boot reads the record, so only it may attach.
 * @param {Function} options.promptCredential `({event, method}) => Promise<String|null>` in main custody.
 * @param {Function} options.relaunch Restarts the shell after the reply is sent.
 * @param {Object} options.safeStorage Electron `safeStorage`.
 * @param {Function} [options.fetchFn=fetch]
 * @param {Object} [options.fsModule=fs]
 * @returns {{status: Function, attach: Function, verify: Function}}
 */
export function createPlaneBroker({causeOf, dir, getLaunchedPlane, getTransportFact, isTrustedSender, packaged, promptCredential, relaunch, safeStorage, fetchFn = fetch, fsModule = fs}) {
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
                {bearer, identity, planeBase} = readPlaneConfig({dir, safeStorage, fsModule}),
                fact                          = getTransportFact();

            return {
                attached  : fact?.mode === 'plane-attach' && fact.up === true,
                // a record whose bearer no longer decrypts, or that predates the identity, cannot attach,
                // so the card offers to reconnect
                configured: planeBase !== null && bearer !== null && identity !== null,
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

            const {identity, verdict} = await probePlaneCredential({planeBase, bearer, fetchFn});

            if (verdict !== 'accepted') {
                return refuse(verdict)
            }

            const authSource = await probePlaneBearerClass({planeBase, bearer, fetchFn});

            writePlaneConfig({authSource, bearer, dir, fsModule, identity, planeBase, safeStorage});
            relaunch();

            return {ok: true, reason: null, relaunching: true}
        },

        /**
         * @summary Asks the plane whether it still admits the PAT this shell launched with, so a
         * credential that expires mid-session reads as the credential it is. Only the launched record
         * is probed: a plane or PAT the environment supplied is not this shell's to judge.
         * @param {Electron.IpcMainInvokeEvent} event
         * @returns {Promise<{cause: String|null}>}
         */
        async verify(event) {
            if (!isTrustedSender(event)) {
                throw new Error('shell-plane-verify: untrusted sender')
            }

            const record = getLaunchedPlane();

            if (!record?.bearer || !record.planeBase) {
                return {cause: null}
            }

            const answer = await probePlaneCredential({bearer: record.bearer, fetchFn, planeBase: record.planeBase}).catch(() => null);

            return {cause: causeOf(answer, record.identity)}
        }
    }
}
